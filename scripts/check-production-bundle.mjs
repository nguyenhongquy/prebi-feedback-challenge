import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

if (!process.argv.includes('--check-only')) {
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
    env: {
      ...process.env,
      VITE_API_MODE: 'supabase',
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_build_check',
    },
    stdio: 'inherit',
  })
}
const scripts = readdirSync('dist/assets').filter((name) => name.endsWith('.js'))
if (!scripts.some((name) => name.startsWith('supabaseChallengeApi-'))) {
  throw new Error('Production bundle must include the Supabase adapter.')
}
for (const name of scripts) {
  const source = readFileSync(`dist/assets/${name}`, 'utf8')
  if (name.includes('mockChallengeApi') || source.includes('seminar-gespraech')
    || source.includes('Du nimmst gut wahr') || source.includes('humanFeedback:')) {
    throw new Error(`Production bundle exposes synthetic case/answer data: ${name}`)
  }
}
const base = '/prebi-feedback-challenge/'
const html = readFileSync('dist/index.html', 'utf8')
const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1])
if (!assets.length || assets.some((asset) =>
  !asset.startsWith(`${base}assets/`) || !existsSync(`dist/${asset.slice(base.length)}`))) {
  throw new Error('Production HTML must reference existing assets under the GitHub Pages base path.')
}
for (const name of readdirSync('dist/assets').filter((file) => file.endsWith('.css'))) {
  const css = readFileSync(`dist/assets/${name}`, 'utf8')
  for (const [, asset] of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    if (!asset.startsWith('data:') && (!asset.startsWith(`${base}assets/`)
      || !existsSync(`dist/${asset.slice(base.length)}`))) {
      throw new Error('Production CSS must reference existing assets under the GitHub Pages base path.')
    }
  }
}
function checkNoEnvironmentFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.env' || entry.name.startsWith('.env.') || entry.name.endsWith('.local')) {
      throw new Error('Deployment artifact must not contain environment/local files.')
    }
    if (entry.isDirectory()) checkNoEnvironmentFiles(`${directory}/${entry.name}`)
  }
}
checkNoEnvironmentFiles('dist')
console.log('Production bundle uses Supabase, excludes mock answers/environment files, and has valid Pages asset paths.')
