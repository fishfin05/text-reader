import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { eq } from 'drizzle-orm'
import { articles } from './schema'
import type { Chunk } from './types'

const sql = neon(process.env.DATABASE_URL!)
const db = drizzle(sql)

export async function getArticleByUrl(url: string) {
  const rows = await db.select().from(articles).where(eq(articles.url, url)).limit(1)
  return rows[0] ?? null
}

export async function getArticleById(id: string) {
  const rows = await db.select().from(articles).where(eq(articles.id, id)).limit(1)
  return rows[0] ?? null
}

export async function createArticle(
  url: string,
  title: string,
  byline: string | null,
  chunks: Chunk[],
) {
  const rows = await db.insert(articles).values({ url, title, byline, chunks }).returning()
  return rows[0]
}

export async function updateArticleChunks(id: string, chunks: Chunk[]) {
  await db.update(articles).set({ chunks }).where(eq(articles.id, id))
}
