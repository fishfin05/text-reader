'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router   = useRouter()
  const [url, setUrl]     = useState('')
  const [text, setText]   = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [mode, setMode]       = useState<'url' | 'paste'>('url')

  async function submit() {
    setError('')
    setLoading(true)
    try {
      const body = mode === 'url' ? { url } : { text, title }
      const res  = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      router.push(`/reader/${data.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ maxWidth: 600, margin: '6rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '.5rem' }}>Text Reader</h1>
      <p style={{ color: '#555', marginBottom: '2rem' }}>
        Paste a URL or text to read it aloud with word-level highlighting.
      </p>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
        {(['url', 'paste'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              padding: '.5rem 1.25rem',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              background: mode === m ? '#3b5bdb' : '#e9ecef',
              color: mode === m ? '#fff' : '#333',
              fontWeight: 500,
            }}
          >
            {m === 'url' ? 'Article URL' : 'Paste Text'}
          </button>
        ))}
      </div>

      {mode === 'url' ? (
        <input
          type="url"
          placeholder="https://..."
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          style={{ width: '100%', padding: '.75rem', fontSize: '1rem', borderRadius: 6, border: '1px solid #ccc', boxSizing: 'border-box' }}
        />
      ) : (
        <>
          <input
            type="text"
            placeholder="Title (optional)"
            value={title}
            onChange={e => setTitle(e.target.value)}
            style={{ width: '100%', padding: '.75rem', fontSize: '1rem', borderRadius: 6, border: '1px solid #ccc', boxSizing: 'border-box', marginBottom: '.75rem' }}
          />
          <textarea
            placeholder="Paste your text here…"
            value={text}
            onChange={e => setText(e.target.value)}
            rows={10}
            style={{ width: '100%', padding: '.75rem', fontSize: '1rem', borderRadius: 6, border: '1px solid #ccc', boxSizing: 'border-box', resize: 'vertical' }}
          />
        </>
      )}

      {error && <p style={{ color: '#c0392b', marginTop: '.75rem' }}>{error}</p>}

      <button
        onClick={submit}
        disabled={loading || (mode === 'url' ? !url : !text)}
        style={{
          marginTop: '1rem',
          width: '100%',
          padding: '.85rem',
          fontSize: '1rem',
          borderRadius: 6,
          border: 'none',
          cursor: 'pointer',
          background: '#3b5bdb',
          color: '#fff',
          fontWeight: 600,
          opacity: loading ? .7 : 1,
        }}
      >
        {loading ? 'Loading…' : 'Read →'}
      </button>
    </main>
  )
}
