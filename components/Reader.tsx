'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Article, Chunk, WordTimestamp } from '@/lib/types';

interface ReaderProps {
  article: Article;
}

type ChunkState = 'idle' | 'loading' | 'ready' | 'error';

export default function Reader({ article }: ReaderProps) {
  const [chunks, setChunks] = useState<Chunk[]>(article.chunks);
  const [chunkStates, setChunkStates] = useState<ChunkState[]>(
    () => article.chunks.map(c => (c.audioUrl ? 'ready' : 'idle'))
  );
  const [currentChunk, setCurrentChunk] = useState(0);
  const [currentWord, setCurrentWord] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const preloadRef = useRef<HTMLAudioElement | null>(null);

  // Generate TTS for a chunk
  const generateChunk = useCallback(async (index: number): Promise<Chunk | null> => {
    setChunkStates(prev => {
      const next = [...prev];
      next[index] = 'loading';
      return next;
    });

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId: article.id, chunkIndex: index }),
      });

      if (!res.ok) throw new Error(await res.text());

      const { audioUrl, wordTimestamps } = await res.json();

      const updated: Chunk = { ...chunks[index], audioUrl, wordTimestamps };

      setChunks(prev => {
        const next = [...prev];
        next[index] = updated;
        return next;
      });

      setChunkStates(prev => {
        const next = [...prev];
        next[index] = 'ready';
        return next;
      });

      return updated;
    } catch {
      setChunkStates(prev => {
        const next = [...prev];
        next[index] = 'error';
        return next;
      });
      return null;
    }
  }, [article.id, chunks]);

  // Start or resume playback
  const play = useCallback(async (chunkIndex: number, seekTime?: number) => {
    let chunk = chunks[chunkIndex];

    if (!chunk.audioUrl) {
      const generated = await generateChunk(chunkIndex);
      if (!generated) return;
      chunk = generated;
    }

    const audio = audioRef.current;
    if (!audio) return;

    if (audio.src !== chunk.audioUrl) {
      audio.src = chunk.audioUrl!;
      audio.load();
    }

    audio.playbackRate = playbackRate;

    if (seekTime !== undefined) {
      audio.currentTime = seekTime;
    }

    await audio.play();
    setIsPlaying(true);
    setCurrentChunk(chunkIndex);

    // Preload next chunk in background
    const nextIdx = chunkIndex + 1;
    if (nextIdx < chunks.length && !chunks[nextIdx].audioUrl && chunkStates[nextIdx] === 'idle') {
      generateChunk(nextIdx);
    }
  }, [chunks, chunkStates, playbackRate, generateChunk]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(async () => {
    if (isPlaying) {
      pause();
    } else {
      await play(currentChunk);
    }
  }, [isPlaying, pause, play, currentChunk]);

  // Seek by clicking a word
  const seekToWord = useCallback(async (chunkIdx: number, wordIdx: number) => {
    const chunk = chunks[chunkIdx];
    const ts = chunk.wordTimestamps[wordIdx]?.startTime ?? 0;

    if (chunkIdx !== currentChunk) {
      setCurrentChunk(chunkIdx);
      await play(chunkIdx, ts);
    } else {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = ts;
        if (!isPlaying) await audio.play().then(() => setIsPlaying(true));
      }
    }
  }, [chunks, currentChunk, isPlaying, play]);

  // Update highlighted word on timeupdate
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      const t = audio.currentTime;
      setCurrentTime(t);
      const wts: WordTimestamp[] = chunks[currentChunk]?.wordTimestamps ?? [];
      let idx = -1;
      for (let i = 0; i < wts.length; i++) {
        if (wts[i].startTime <= t) idx = i;
        else break;
      }
      setCurrentWord(idx);
    };

    const onEnded = async () => {
      const nextIdx = currentChunk + 1;
      if (nextIdx < chunks.length) {
        await play(nextIdx, 0);
      } else {
        setIsPlaying(false);
        setCurrentWord(-1);
      }
    };

    const onLoadedMetadata = () => setDuration(audio.duration);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [chunks, currentChunk, play]);

  // Sync playback rate
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  // Auto-scroll to highlighted word
  useEffect(() => {
    if (currentWord < 0) return;
    const key = `${currentChunk}-${currentWord}`;
    const el = wordRefs.current[parseInt(key.replace('-', ''), 10)];
    // We use a flat index approach below
  }, [currentChunk, currentWord]);

  // Flat word index for ref array
  let flatWordIndex = 0;
  const chunkWordOffsets: number[] = [];
  for (const chunk of chunks) {
    chunkWordOffsets.push(flatWordIndex);
    flatWordIndex += chunk.wordTimestamps.length || chunk.text.split(/\s+/).filter(Boolean).length;
  }

  const currentFlatWord =
    currentWord >= 0 ? chunkWordOffsets[currentChunk] + currentWord : -1;

  useEffect(() => {
    if (currentFlatWord < 0) return;
    const el = wordRefs.current[currentFlatWord];
    el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }, [currentFlatWord]);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  const seekToProgress = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const audio = audioRef.current;
    if (audio && duration > 0) {
      audio.currentTime = pct * duration;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-gray-900 leading-tight line-clamp-2">
          {article.title}
        </h1>
        {article.byline && (
          <p className="text-sm text-gray-500 mt-0.5">{article.byline}</p>
        )}
      </div>

      {/* Article text */}
      <main className="flex-1 overflow-y-auto px-4 py-6 pb-36">
        <div className="max-w-2xl mx-auto text-[17px] leading-relaxed text-gray-800 space-y-4">
          {chunks.map((chunk, ci) => {
            const words = chunk.wordTimestamps.length > 0
              ? chunk.wordTimestamps.map(wt => wt.word)
              : chunk.text.split(/\s+/).filter(Boolean);
            const offset = chunkWordOffsets[ci];

            return (
              <p key={ci}>
                {words.map((word, wi) => {
                  const flatIdx = offset + wi;
                  const isCurrent = ci === currentChunk && wi === currentWord;
                  const isPast =
                    ci < currentChunk ||
                    (ci === currentChunk && wi < currentWord);

                  return (
                    <span
                      key={wi}
                      ref={el => { wordRefs.current[flatIdx] = el; }}
                      onClick={() => seekToWord(ci, wi)}
                      className={[
                        'cursor-pointer rounded px-[1px] transition-colors',
                        isCurrent
                          ? 'bg-yellow-300 text-gray-900'
                          : isPast
                          ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                          : 'hover:bg-gray-100',
                      ].join(' ')}
                    >
                      {word}
                    </span>
                  );
                }).reduce<React.ReactNode[]>((acc, el, i) => {
                  if (i > 0) acc.push(' ');
                  acc.push(el);
                  return acc;
                }, [])}
              </p>
            );
          })}
        </div>
      </main>

      {/* Player */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg px-4 py-3 space-y-2">
        {/* Progress bar */}
        <div
          className="w-full h-1.5 bg-gray-200 rounded-full cursor-pointer"
          onClick={seekToProgress}
        >
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between">
          {/* Chunk indicator */}
          <span className="text-xs text-gray-400 w-20">
            {currentChunk + 1} / {chunks.length}
          </span>

          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            disabled={chunkStates[currentChunk] === 'loading'}
            className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center disabled:opacity-50 hover:bg-blue-700 transition-colors"
          >
            {chunkStates[currentChunk] === 'loading' ? (
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : isPlaying ? (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg className="w-5 h-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Speed control */}
          <div className="flex items-center gap-1 w-20 justify-end">
            {[0.75, 1, 1.25, 1.5, 2].map(rate => (
              <button
                key={rate}
                onClick={() => setPlaybackRate(rate)}
                className={[
                  'text-xs px-1.5 py-0.5 rounded font-mono transition-colors',
                  playbackRate === rate
                    ? 'bg-blue-100 text-blue-700 font-bold'
                    : 'text-gray-400 hover:text-gray-700',
                ].join(' ')}
              >
                {rate}×
              </button>
            ))}
          </div>
        </div>
      </div>

      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
