import { neon } from '@neondatabase/serverless';
import type { Chunk } from './types';

function getSQL() {
  return neon(process.env.DATABASE_URL!);
}

export async function getArticleByUrl(url: string) {
  const sql = getSQL();
  const rows = await sql`SELECT * FROM articles WHERE url = ${url} LIMIT 1`;
  return rows[0] ?? null;
}

export async function getArticleById(id: string) {
  const sql = getSQL();
  const rows = await sql`SELECT * FROM articles WHERE id = ${id} LIMIT 1`;
  return rows[0] ?? null;
}

export async function createArticle(
  url: string,
  title: string,
  byline: string | null,
  chunks: Chunk[]
) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO articles (url, title, byline, chunks)
    VALUES (${url}, ${title}, ${byline}, ${JSON.stringify(chunks)}::jsonb)
    RETURNING *
  `;
  return rows[0];
}

export async function updateArticleChunks(id: string, chunks: Chunk[]) {
  const sql = getSQL();
  await sql`
    UPDATE articles SET chunks = ${JSON.stringify(chunks)}::jsonb WHERE id = ${id}
  `;
}
