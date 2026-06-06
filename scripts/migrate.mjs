import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL)

// Check if constraint already exists before adding
const existing = await sql`
  SELECT 1 FROM pg_constraint
  WHERE conname = 'articles_url_unique'
`
if (existing.length > 0) {
  console.log('✓ articles_url_unique already exists, skipping')
} else {
  await sql`ALTER TABLE articles ADD CONSTRAINT articles_url_unique UNIQUE (url)`
  console.log('✓ articles_url_unique constraint added')
}
