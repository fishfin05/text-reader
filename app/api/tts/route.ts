import { NextRequest } from 'next/server';
import { put } from '@vercel/blob';
import { getArticleById, updateArticleChunks } from '@/lib/db';
import type { Chunk, WordTimestamp } from '@/lib/types';

const TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY!;
const TTS_VOICE = process.env.GOOGLE_TTS_VOICE || 'en-US-Neural2-J';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSSML(words: string[]): string {
  return `<speak>${words.map((w, i) => `<mark name="w${i}"/>${escapeXml(w)}`).join(' ')}</speak>`;
}

export async function POST(request: NextRequest) {
  try {
    const { articleId, chunkIndex } = await request.json();
    if (!articleId || chunkIndex === undefined) {
      return Response.json({ error: 'articleId and chunkIndex required' }, { status: 400 });
    }

    const article = await getArticleById(articleId);
    if (!article) return Response.json({ error: 'Article not found' }, { status: 404 });

    const chunks: Chunk[] = article.chunks;
    const chunk = chunks[chunkIndex];
    if (!chunk) return Response.json({ error: 'Chunk not found' }, { status: 404 });

    // Return cached audio if already generated
    if (chunk.audioUrl) {
      return Response.json({ audioUrl: chunk.audioUrl, wordTimestamps: chunk.wordTimestamps });
    }

    const words = chunk.text.split(/\s+/).filter(Boolean);
    const ssml = buildSSML(words);

    const ttsRes = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${TTS_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { ssml },
          voice: { languageCode: 'en-US', name: TTS_VOICE },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 },
          enableTimePointing: ['SSML_MARK'],
        }),
      }
    );

    if (!ttsRes.ok) throw new Error(`TTS API error ${ttsRes.status}: ${await ttsRes.text()}`);

    const ttsData = await ttsRes.json();
    const audioBytes = Buffer.from(ttsData.audioContent, 'base64');
    const timepoints: Array<{ markName: string; timeSeconds: number }> = ttsData.timepoints ?? [];

    const wordTimestamps: WordTimestamp[] = words.map((word, i) => ({
      word,
      startTime: timepoints.find(t => t.markName === `w${i}`)?.timeSeconds ?? 0,
    }));

    // Upload to Vercel Blob
    const blob = await put(`${articleId}/${chunkIndex}.mp3`, audioBytes, {
      access: 'public',
      contentType: 'audio/mpeg',
    });

    chunks[chunkIndex] = { ...chunk, wordTimestamps, audioUrl: blob.url };
    await updateArticleChunks(articleId, chunks);

    return Response.json({ audioUrl: blob.url, wordTimestamps });
  } catch (err) {
    console.error('TTS error:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'TTS generation failed' },
      { status: 500 }
    );
  }
}
