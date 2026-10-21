import { deepStrictEqual, equal, throws } from 'node:assert/strict'
import postgres from 'postgres'
import { databaseConnectionOptions, databaseConnectionUrl, textArrayLiteral } from './database.ts'

const hostedUrl = 'postgres://test:placeholder@pooler.example:6543/postgres'
const ca = 'test-only-ca-placeholder'

Deno.test('hosted connections pass the supplied CA with strict verification to Postgres.js', async () => {
  const url = `${hostedUrl}?sslmode=disable`
  const options = databaseConnectionOptions(url, `\n${ca}\n`)
  deepStrictEqual(options.ssl, { ca, rejectUnauthorized: true })
  // No socket opens until a query is executed.
  const sql = postgres(url, options)
  try {
    deepStrictEqual(sql.options.ssl, { ca, rejectUnauthorized: true })
    equal(options.prepare, false)
    equal(options.max, 1)
  } finally {
    await sql.end()
  }
})

Deno.test('without a custom CA hosted connections still require verify-full', () => {
  for (const value of [undefined, '', ' \n ']) {
    equal(databaseConnectionOptions(hostedUrl, value).ssl, 'verify-full')
  }
})

Deno.test('only explicit local database hosts keep the existing non-TLS behavior', () => {
  for (const host of ['127.0.0.1', 'localhost', 'host.docker.internal', 'db']) {
    equal(databaseConnectionOptions(`postgres://test:placeholder@${host}:5432/postgres`, ca).ssl, false)
  }
  deepStrictEqual(databaseConnectionOptions('postgres://test@localhost.example/postgres', ca).ssl,
    { ca, rejectUnauthorized: true })
})

Deno.test('invalid database protocols fail without exposing credentials', () => {
  throws(() => databaseConnectionOptions('https://pooler.example', ca),
    /PREBI_DATABASE_URL must be a PostgreSQL connection URL/)
})

Deno.test('URL supplied to Postgres.js excludes libpq SSL parameters and retains strict TLS', async () => {
  for (const query of ['sslmode=disable', 'ssl=false', 'sslmode=require&sslrootcert=system',
    'sslrootcert=placeholder-file&sslcert=placeholder-client&sslkey=placeholder-key']) {
    for (const certificate of [undefined, ca]) {
      const url = `${hostedUrl}?${query}`
      const options = databaseConnectionOptions(url, certificate)
      const suppliedUrl = databaseConnectionUrl(url)
      for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
        equal(new URL(suppliedUrl).searchParams.has(key), false)
      }
      const sql = postgres(suppliedUrl, options)
      try {
        deepStrictEqual(sql.options.ssl, certificate ? { ca, rejectUnauthorized: true } : 'verify-full')
        for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
          equal(key in sql.options.connection, false)
        }
      } finally {
        await sql.end()
      }
    }
  }
})

Deno.test('URL filtering preserves encoded credentials, host, port, database and other parameters', async () => {
  const original = new URL('postgresql://test%40project:p%40ss%3Aword%2F%25@pooler.example:6543/db%20name'
    + '?sslmode=require&application_name=prebi%20test&sslrootcert=path&sslcert=cert'
    + '&sslkey=key&sslmode=disable&connect_timeout=7&options=-c%20statement_timeout%3D1000'
    + '&custom=value%2Bwith%26characters&custom=second&ssl=false')
  const filtered = new URL(databaseConnectionUrl(original.toString()))
  for (const key of ['protocol', 'hostname', 'port', 'username', 'password', 'pathname'] as const) {
    equal(filtered[key], original[key])
  }
  deepStrictEqual([...filtered.searchParams], [...original.searchParams].filter(([key]) =>
    !['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].includes(key)))
  const options = databaseConnectionOptions(filtered.toString(), ca)
  const sql = postgres(filtered.toString(), options)
  const baseline = postgres(original.toString(), databaseConnectionOptions(original.toString(), ca))
  try {
    for (const key of ['host', 'port', 'user', 'pass', 'database'] as const) {
      deepStrictEqual(sql.options[key], baseline.options[key])
    }
    equal(sql.options.connection.application_name, 'prebi test')
    equal(sql.options.connection.options, '-c statement_timeout=1000')
    equal(sql.options.connection.custom, 'second')
    deepStrictEqual(sql.options.ssl, { ca, rejectUnauthorized: true })
  } finally {
    await sql.end()
    await baseline.end()
  }
})

Deno.test('array parameters are sent as quoted text[] literals and unsafe elements are refused', () => {
  equal(textArrayLiteral([]), '{}')
  equal(textArrayLiteral(['eigene-rolle', 'clear']), '{"eigene-rolle","clear"}')
  for (const unsafe of ['a,b', 'a"b', 'a\\b', '{x}', '', 'A']) {
    throws(() => textArrayLiteral([unsafe]))
  }
})
