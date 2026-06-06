'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type { Article, Chunk, WordTimestamp } from '@/lib/types';

const VOICES = [
  { id: 'en-US-Neural2-J', label: 'James',  gender: 'Male'   },
  { id: 'en-US-Neural2-D', label: 'David',  gender: 'Male'   },
  { id: 'en-US-Neural2-I', label: 'Ivan',   gender: 'Male'   },
  { id: 'en-US-Neural2-A', label: 'Amy',    gender: 'Female' },
  { id: 'en-US-Neural2-C', label: 'Clara',  gender: 'Female' },
  { id: 'en-US-Neural2-E', label: 'Emily',  gender: 'Female' },
  { id: 'en-US-Neural2-F', label: 'Fiona',  gender: 'Female' },
  { id: 'en-US-Neural2-G', label: 'Grace',  gender: 'Female' },
  { id: 'en-US-Neural2-H', label: 'Hannah', gender: 'Female' },
];

// Average TTS words per second at 1× speed (used to estimate unloaded chunks)
const WORDS_PER_SEC = 2.5;

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type ChunkState = 'idle' | 'loading' | 'ready' | 'error';

export default function Reader({ article }: { article: Article }) {
  const [chunks, setChunks]           = useState<Chunk[]>(article.chunks);
  const [chunkStates, setChunkStates] = useState<ChunkState[]>(
    () => article.chunks.map(c => (c.audioUrl ? 'ready' : 'idle'))
  );
  const [currentChunk, setCurrentChunk] = useState(0);
  const [currentWord,  setCurrentWord]  = useState(-1);
  const [isPlaying,    setIsPlaying]    = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [ttsError,     setTtsError]     = useState('');
  const [showVoice,    setShowVoice]    = useState(false);
  const [voice, setVoice] = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('tts-voice') || 'en-US-Neural2-J') : 'en-US-Neural2-J'
  );
  // measured durations per chunk index (in media seconds at 1×)
  const [chunkDurations, setChunkDurations] = useState<Record<number, number>>({});
  const [audioTime, setAudioTime] = useState(0);

  const audioRef        = useRef<HTMLAudioElement>(null);
  const progressRef     = useRef<HTMLDivElement>(null);
  const wordRefs        = useRef<Map<string, HTMLSpanElement>>(new Map());
  const isDragging      = useRef(false);
  // Sync refs — updated immediately (not waiting for React re-render)
  const currentChunkRef = useRef(0);
  const voiceRef        = useRef(voice);
  const playRef         = useRef<(ci: number, t?: number) => Promise<void>>(async () => {});
  const chunksRef       = useRef(chunks);

  useEffect(() => { voiceRef.current  = voice;  }, [voice]);
  useEffect(() => { chunksRef.current = chunks; }, [chunks]);

  // ── derived word counts / offsets ──────────────────────────────────────────
  const wordCounts = chunks.map(c =>
    c.wordTimestamps.length > 0
      ? c.wordTimestamps.length
      : c.text.split(/\s+/).filter(Boolean).length
  );
  const chunkWordOffsets = wordCounts.reduce<number[]>((acc, _, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + wordCounts[i - 1]);
    return acc;
  }, []);
  const totalWords = wordCounts.reduce((a, b) => a + b, 0);

  // ── time estimates ─────────────────────────────────────────────────────────
  const estimateChunkDuration = (ci: number) => wordCounts[ci] / WORDS_PER_SEC;

  const totalDurationAtNormal = chunks.reduce((sum, _, ci) =>
    sum + (chunkDurations[ci] ?? estimateChunkDuration(ci)), 0
  );
  const totalDuration = totalDurationAtNormal / playbackRate;

  const elapsedAtNormal =
    Object.entries(chunkDurations)
      .filter(([ci]) => Number(ci) < currentChunk)
      .reduce((sum, [, d]) => sum + d, 0) +
    // uncompleted past chunks we don't have real durations for
    Array.from({ length: currentChunk }, (_, ci) =>
      chunkDurations[ci] !== undefined ? 0 : estimateChunkDuration(ci)
    ).reduce((a, b) => a + b, 0) +
    audioTime;
  const elapsed = elapsedAtNormal / playbackRate;

  const remaining = totalDuration - elapsed;

  // global progress based on word position (responsive even before durations load)
  const currentGlobalWord =
    currentWord >= 0 ? chunkWordOffsets[currentChunk] + currentWord : chunkWordOffsets[currentChunk];
  const globalProgress = totalWords > 0 ? (currentGlobalWord / totalWords) * 100 : 0;

  // ── TTS generation ─────────────────────────────────────────────────────────
  // Uses voiceRef and chunksRef so it never captures stale closures
  const generateChunk = useCallback(async (index: number): Promise<Chunk | null> => {
    setChunkStates(prev => { const n = [...prev]; n[index] = 'loading'; return n; });
    setTtsError('');
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleId: article.id,
          chunkIndex: index,
          voice: voiceRef.current,    // always current
        }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(JSON.parse(text)?.error ?? text);
      const { audioUrl, wordTimestamps } = JSON.parse(text);
      const updated: Chunk = { ...chunksRef.current[index], audioUrl, wordTimestamps };
      setChunks(prev => { const n = [...prev]; n[index] = updated; return n; });
      setChunkStates(prev => { const n = [...prev]; n[index] = 'ready'; return n; });
      return updated;
    } catch (err) {
      setTtsError(err instanceof Error ? err.message : String(err));
      setChunkStates(prev => { const n = [...prev]; n[index] = 'error'; return n; });
      return null;
    }
  }, [article.id]); // no chunks/voice deps — uses refs instead

  // ── playback ───────────────────────────────────────────────────────────────
  const play = useCallback(async (chunkIndex: number, seekTime?: number) => {
    let chunk = chunksRef.current[chunkIndex];
    if (!chunk?.audioUrl) {
      const gen = await generateChunk(chunkIndex);
      if (!gen) return;
      chunk = gen;
    }
    const audio = audioRef.current;
    if (!audio) return;

    // Update the ref BEFORE audio.play() so timeupdate sees the right chunk
    currentChunkRef.current = chunkIndex;
    setCurrentChunk(chunkIndex);
    setCurrentWord(-1);  // clear stale highlight immediately

    if (audio.src !== chunk.audioUrl!) { audio.src = chunk.audioUrl!; audio.load(); }
    audio.playbackRate = playbackRate;
    if (seekTime !== undefined) audio.currentTime = seekTime;
    await audio.play();
    setIsPlaying(true);

    // preload next
    const next = chunkIndex + 1;
    const nextChunk = chunksRef.current[next];
    if (nextChunk && !nextChunk.audioUrl && chunkStates[next] === 'idle') {
      generateChunk(next);
    }
  }, [chunkStates, playbackRate, generateChunk]);

  useEffect(() => { playRef.current = play; }, [play]);

  const pause = () => { audioRef.current?.pause(); setIsPlaying(false); };

  const seekToWord = async (ci: number, wi: number) => {
    const ts = chunksRef.current[ci]?.wordTimestamps[wi]?.startTime ?? 0;
    if (ci !== currentChunkRef.current) {
      await play(ci, ts);
    } else {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = ts;
      if (!isPlaying) { await audio.play(); setIsPlaying(true); }
    }
  };

  const skipSeconds = async (delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const newTime = audio.currentTime + delta;
    if (newTime < 0) {
      if (currentChunkRef.current > 0) await playRef.current(currentChunkRef.current - 1, 0);
      else audio.currentTime = 0;
    } else if (isFinite(audio.duration) && newTime > audio.duration) {
      const next = currentChunkRef.current + 1;
      if (next < chunks.length) await playRef.current(next, 0);
    } else {
      audio.currentTime = Math.max(0, newTime);
    }
  };

  const applyProgressSeek = (clientX: number) => {
    const el = progressRef.current;
    if (!el) return;
    const { left, width } = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - left) / width));
    const targetWord = Math.round(pct * (totalWords - 1));
    let ci = 0;
    for (let i = chunks.length - 1; i >= 0; i--) {
      if (chunkWordOffsets[i] <= targetWord) { ci = i; break; }
    }
    const wi = Math.max(0, Math.min(targetWord - chunkWordOffsets[ci], wordCounts[ci] - 1));
    seekToWord(ci, wi);
  };

  // ── audio events ───────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      const t = audio.currentTime;
      setAudioTime(t);
      // Use the ref (not state) so this always reads the latest chunk index
      const wts: WordTimestamp[] = chunksRef.current[currentChunkRef.current]?.wordTimestamps ?? [];
      let idx = -1;
      for (let i = 0; i < wts.length; i++) {
        if (wts[i].startTime <= t) idx = i; else break;
      }
      setCurrentWord(idx);
    };

    const onEnded = async () => {
      const next = currentChunkRef.current + 1;
      if (next < chunksRef.current.length) await playRef.current(next, 0);
      else { setIsPlaying(false); setCurrentWord(-1); }
    };

    const onLoadedMetadata = () => {
      setChunkDurations(prev => ({ ...prev, [currentChunkRef.current]: audio.duration }));
    };

    audio.addEventListener('timeupdate',     onTimeUpdate);
    audio.addEventListener('ended',          onEnded);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => {
      audio.removeEventListener('timeupdate',     onTimeUpdate);
      audio.removeEventListener('ended',          onEnded);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, []); // runs once — uses refs, not stale closures

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  // auto-scroll
  useEffect(() => {
    if (currentWord < 0) return;
    wordRefs.current.get(`${currentChunk}-${currentWord}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentChunk, currentWord]);

  const handleVoiceChange = (v: string) => {
    setVoice(v);
    localStorage.setItem('tts-voice', v);
    setShowVoice(false);
  };

  const currentVoice = VOICES.find(v => v.id === voice) ?? VOICES[0];

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3 shrink-0">
        <Link href="/" className="text-blue-600 text-sm font-medium whitespace-nowrap">← New Article</Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold text-gray-900 text-base leading-tight truncate">{article.title}</h1>
          {article.byline && <p className="text-xs text-gray-500 truncate">{article.byline}</p>}
        </div>
      </div>

      {/* Article text */}
      <main className="flex-1 overflow-y-auto px-4 py-6 pb-40">
        <div className="max-w-2xl mx-auto text-[17px] leading-relaxed text-gray-800 space-y-4">
          {chunks.map((chunk, ci) => {
            const words = chunk.wordTimestamps.length > 0
              ? chunk.wordTimestamps.map(wt => wt.word)
              : chunk.text.split(/\s+/).filter(Boolean);
            return (
              <p key={ci}>
                {words.map((word, wi) => {
                  const isCurrent = ci === currentChunk && wi === currentWord;
                  const isPast = ci < currentChunk || (ci === currentChunk && wi < currentWord);
                  return (
                    <span
                      key={wi}
                      ref={el => {
                        const k = `${ci}-${wi}`;
                        if (el) wordRefs.current.set(k, el);
                        else wordRefs.current.delete(k);
                      }}
                      onClick={() => seekToWord(ci, wi)}
                      className={[
                        'cursor-pointer rounded px-[1px] transition-colors',
                        isCurrent ? 'bg-yellow-300'
                          : isPast ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                          : 'hover:bg-gray-100',
                      ].join(' ')}
                    >{word}{' '}</span>
                  );
                })}
              </p>
            );
          })}
        </div>
      </main>

      {/* Player */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
        {/* Error banner */}
        {ttsError && (
          <div className="px-4 py-2 bg-red-50 border-b border-red-100 flex items-center justify-between">
            <p className="text-xs text-red-600 truncate">{ttsError}</p>
            <button onClick={() => setTtsError('')} className="text-red-400 ml-2 shrink-0 text-xs">✕</button>
          </div>
        )}

        {/* Global progress bar */}
        <div
          ref={progressRef}
          className="h-2 bg-gray-200 cursor-pointer touch-none select-none"
          onPointerDown={e => {
            isDragging.current = true;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            applyProgressSeek(e.clientX);
          }}
          onPointerMove={e => { if (isDragging.current) applyProgressSeek(e.clientX); }}
          onPointerUp={() => { isDragging.current = false; }}
        >
          <div className="h-full bg-blue-500 pointer-events-none" style={{ width: `${globalProgress}%` }} />
        </div>

        {/* Time row */}
        <div className="px-4 pt-1.5 flex items-center justify-between text-xs text-gray-400">
          <span>{formatTime(elapsed)}</span>
          <span>{isFinite(remaining) && remaining > 0 ? `−${formatTime(remaining)}` : formatTime(totalDuration)}</span>
        </div>

        {/* Controls */}
        <div className="px-4 py-2 flex items-center justify-between gap-2">
          {/* Speed */}
          <div className="flex gap-0.5 flex-wrap w-[72px]">
            {[0.75, 1, 1.25, 1.5, 2].map(r => (
              <button
                key={r}
                onClick={() => setPlaybackRate(r)}
                className={[
                  'text-xs px-1 py-0.5 rounded font-mono transition-colors',
                  playbackRate === r ? 'bg-blue-100 text-blue-700 font-bold' : 'text-gray-400 hover:text-gray-700',
                ].join(' ')}
              >{r}×</button>
            ))}
          </div>

          {/* Skip + play */}
          <div className="flex items-center gap-3">
            <button onClick={() => skipSeconds(-15)} className="flex flex-col items-center gap-0.5 text-gray-600 hover:text-gray-900 transition-colors">
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
                <path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
              </svg>
              <span className="text-[10px] leading-none font-medium">15s</span>
            </button>

            <button
              onClick={isPlaying ? pause : () => play(currentChunk)}
              disabled={chunkStates[currentChunk] === 'loading'}
              className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {chunkStates[currentChunk] === 'loading' ? (
                <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
              ) : isPlaying ? (
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1"/>
                  <rect x="14" y="4" width="4" height="16" rx="1"/>
                </svg>
              ) : (
                <svg className="w-5 h-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              )}
            </button>

            <button onClick={() => skipSeconds(15)} className="flex flex-col items-center gap-0.5 text-gray-600 hover:text-gray-900 transition-colors">
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
                <path d="M12.01 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/>
              </svg>
              <span className="text-[10px] leading-none font-medium">15s</span>
            </button>
          </div>

          {/* Voice */}
          <button onClick={() => setShowVoice(true)} className="text-right w-[72px] hover:opacity-70 transition-opacity">
            <div className="text-xs font-medium text-gray-700">{currentVoice.label}</div>
            <div className="text-[10px] text-gray-400">{currentVoice.gender}</div>
          </button>
        </div>
      </div>

      {/* Voice picker sheet */}
      {showVoice && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setShowVoice(false)}>
          <div
            className="bg-white w-full rounded-t-2xl p-6 max-h-[70vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="font-semibold text-gray-900 mb-1">Voice</h2>
            <p className="text-xs text-gray-400 mb-4">Applies to newly generated chunks. Already-played audio keeps its original voice.</p>
            <div className="space-y-1">
              {VOICES.map(v => (
                <button
                  key={v.id}
                  onClick={() => handleVoiceChange(v.id)}
                  className={[
                    'w-full text-left px-4 py-3 rounded-xl flex justify-between items-center transition-colors',
                    voice === v.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-800',
                  ].join(' ')}
                >
                  <span className="font-medium">{v.label}</span>
                  <span className="text-sm text-gray-400">{v.gender}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <audio ref={audioRef} className="hidden"/>
    </div>
  );
}
