'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import type { Article, Chunk, WordTimestamp } from '@/lib/types'

interface Props {
  article: Article
}

export default function Reader({ article }: Props) {
  const [chunks, setChunks]           = useState<Chunk[]>(article.chunks)
  const [activeChunk, setActiveChunk] = useState<number | null>(null)
  const [activeWord, setActiveWord]   = useState<number | null>(null)
  const [loading, setLoading]         = useState<number | null>(null)
  const audioRef                      = useRef<HTMLAudioElement | null>(null)

  const playChunk = useCallback(async (index: number) => {
    const chunk = chunks[index]
    if (!chunk) return

    let audioUrl = chunk.audioUrl

    if (!audioUrl) {
      setLoading(index)
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ articleId: article.id, chunkIndex: index }),
        })
        const data = await res.json()
        audioUrl = data.audioUrl
        setChunks(prev => prev.map((c, i) =>
          i === index ? { ...c, audioUrl: data.audioUrl, wordTimestamps: data.wordTimestamps } : c
        ))
      } catch {
        console.error('TTS failed')
        return
      } finally {
        setLoading(null)
      }
    }

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
    }

    const audio = new Audio(audioUrl ?? undefined)
    audioRef.current = audio
    setActiveChunk(index)
    setActiveWord(null)

    const timestamps: WordTimestamp[] = chunks[index]?.wordTimestamps ?? []

    audio.ontimeupdate = () => {
      const t = audio.currentTime
      let wi = 0
      for (let i = 0; i < timestamps.length; i++) {
        if (timestamps[i].startTime <= t) wi = i
      }
      setActiveWord(wi)
    }

    audio.onended = () => {
      setActiveChunk(null)
      setActiveWord(null)
    }

    audio.play()
  }, [chunks, article.id])

  useEffect(() => {
    return () => { audioRef.current?.pause() }
  }, [])

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'Georgia, serif' }}>
      <h1 style={{ fontSize: '1.75rem', lineHeight: 1.3, marginBottom: '.25rem' }}>{article.title}</h1>
      {article.byline && (
        <p style={{ color: '#666', fontSize: '.9rem', marginBottom: '2rem' }}>{article.byline}</p>
      )}

      {chunks.map((chunk, i) => (
        <div
          key={i}
          style={{
            marginBottom: '1.25rem',
            padding: '.75rem',
            borderRadius: 6,
            cursor: 'pointer',
            background: activeChunk === i ? '#f0f4ff' : 'transparent',
            transition: 'background .15s',
          }}
          onClick={() => playChunk(i)}
        >
          {loading === i ? (
            <span style={{ color: '#888', fontSize: '.9rem' }}>Generating audio…</span>
          ) : (
            chunk.wordTimestamps.map((wt, wi) => (
              <span
                key={wi}
                style={{
                  background: activeChunk === i && activeWord === wi ? '#c7d5ff' : 'transparent',
                  borderRadius: 2,
                  padding: '0 1px',
                  transition: 'background .05s',
                }}
              >
                {wt.word}{' '}
              </span>
            ))
          )}
        </div>
      ))}
    </main>
  )
}
