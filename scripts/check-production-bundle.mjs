import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'

execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  env: {
    ...process.env,
    VITE_API_MODE: 'supabase',
    VITE_SUPABASE_URL: 'https://example.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_build_check',
  },
  stdio: 'inherit',
})
const scripts = readdirSync('dist/assets').filter((name) => name.endsWith('.js'))
for (const name of scripts) {
  const source = readFileSync(`dist/assets/${name}`, 'utf8')
  if (name.includes('mockChallengeApi') || source.includes('seminar-gespraech')
    || source.includes('Du nimmst gut wahr') || source.includes('humanFeedback:')) {
    throw new Error(`Production bundle exposes synthetic case/answer data: ${name}`)
  }
}
console.log('Production build contains no mock adapter or synthetic case/answer data.')
