import { NextRequest } from 'next/server';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { getArticleByUrl, createArticle } from '@/lib/db';
import type { Chunk } from '@/lib/types';

function splitIntoChunks(paragraphs: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let index = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    const sentences = trimmed.match(/[^.!?]+[.!?]+[\s]*/g) || [trimmed];
    let current = '';

    for (const sentence of sentences) {
      if (current.length + sentence.length > 800 && current.length > 0) {
        chunks.push(makeChunk(index++, current.trim()));
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) chunks.push(makeChunk(index++, current.trim()));
  }

  return chunks;
}

function makeChunk(index: number, text: string): Chunk {
  return {
    index,
    text,
    wordTimestamps: text.split(/\s+/).filter(Boolean).map(w => ({ word: w, startTime: 0 })),
    audioUrl: null,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { url, text, title } = await request.json();

    // ── paste-text mode ──────────────────────────────────────────────────────
    if (text) {
      const paragraphs = (text as string)
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 20);
      const chunks = splitIntoChunks(paragraphs.length > 0 ? paragraphs : [text]);
      const fakeUrl = `text:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const data = await createArticle(fakeUrl, (title as string) || 'Untitled', null, chunks);
      return Response.json({ id: data.id, url: data.url, title: data.title, byline: null, chunks: data.chunks, createdAt: data.createdAt });
    }

    if (!url) return Response.json({ error: 'URL or text required' }, { status: 400 });

    const existing = await getArticleByUrl(url);
    if (existing) {
      return Response.json({
        id: existing.id,
        url: existing.url,
        title: existing.title,
        byline: existing.byline,
        chunks: existing.chunks,
        createdAt: existing.createdAt,
      });
    }

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TextReader/1.0)' },
    });
    if (!res.ok) throw new Error(`Failed to fetch article: ${res.status}`);

    const html = await res.text();
    const { document } = parseHTML(html);

    // linkedom doesn't set document.baseURI so patch location manually
    try { (document as unknown as { _URL: string })._URL = url; } catch { /* ignore */ }

    const reader = new Readability(document as unknown as Document);
    const parsed = reader.parse();

    if (!parsed) throw new Error('Could not extract article content');

    const { document: contentDoc } = parseHTML(parsed.content ?? '');
    let paragraphs = Array.from(
      contentDoc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li')
    )
      .map(el => el.textContent?.trim() ?? '')
      .filter(t => t.length > 20);

    if (paragraphs.length === 0) {
      paragraphs = parsed.textContent?.split('\n').filter(l => l.trim().length > 20) ?? [];
    }

    const chunks = splitIntoChunks(paragraphs);
    const data = await createArticle(url, parsed.title || 'Untitled', parsed.byline || null, chunks);

    return Response.json({
      id: data.id,
      url: data.url,
      title: data.title,
      byline: data.byline,
      chunks: data.chunks,
      createdAt: data.createdAt,
    });
  } catch (err) {
    console.error('Extract error:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to extract article' },
      { status: 500 }
    );
  }
}
