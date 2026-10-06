// FF-092: issue a partner API key. Run locally. Keys are issued by Meridian, not self-serve.
//
//   node scripts/issue-partner-key.mjs <partner-slug> "<label>"
//
// Prints the raw key ONCE, and the SQL that stores only its SHA-256 hash. Paste the SQL into the
// Supabase SQL editor (or ask for it to be applied). The raw key is never written to a file or a log
// here: give it to the partner over a secure channel, then discard it.
import { randomBytes, createHash } from 'crypto'

const [slug, label = ''] = process.argv.slice(2)
if (!slug || !/^[a-z0-9-]{2,40}$/.test(slug)) {
  console.error('usage: node scripts/issue-partner-key.mjs <partner-slug> "<label>"')
  process.exit(1)
}

const key = `mrd_${randomBytes(32).toString('base64url')}`
const hash = createHash('sha256').update(key, 'utf8').digest('hex')
const prefix = key.slice(0, 8)
const safeLabel = label.replace(/'/g, "''")

console.log('Raw key (shown once, give it to the partner, do not store it):')
console.log(key)
console.log('')
console.log('SQL (stores the hash only):')
console.log(
  `INSERT INTO partner_api_keys (partner_id, key_hash, key_prefix, label)
SELECT id, '${hash}', '${prefix}', '${safeLabel}' FROM partners WHERE slug = '${slug}';`,
)
