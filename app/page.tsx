'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [mode, setMode]     = useState<'url' | 'text'>('url');
  const [url, setUrl]       = useState('');
  const [text, setText]     = useState('');
  const [title, setTitle]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const body = mode === 'url'
        ? { url: url.trim() }
        : { text: text.trim(), title: title.trim() || 'Untitled' };

      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const raw = await res.text();
      let data: { id?: string; error?: string };
      try { data = JSON.parse(raw); }
      catch { throw new Error(`Server error (${res.status}): ${raw.slice(0, 200)}`); }

      if (!res.ok) throw new Error(data.error || 'Failed to load article');
      router.push(`/reader/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
    }
  };

  const isValid = mode === 'url' ? url.trim().length > 0 : text.trim().length > 0;

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Text Reader</h1>
          <p className="mt-2 text-gray-500 text-sm">Audiobook-quality narration of any article</p>
        </div>

        {/* Tab toggle */}
        <div className="flex bg-gray-100 rounded-xl p-1">
          {(['url', 'text'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={['flex-1 py-2 text-sm font-medium rounded-lg transition-colors', mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'].join(' ')}
            >
              {m === 'url' ? 'Article URL' : 'Paste Text'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'url' ? (
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://example.com/article"
              required
              autoFocus
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-base"
            />
          ) : (
            <>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Title (optional)"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-base"
              />
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Paste your article, essay, or any text here…"
                required
                autoFocus
                rows={8}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-base resize-none"
              />
            </>
          )}

          <button
            type="submit"
            disabled={loading || !isValid}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium text-base hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                Loading…
              </>
            ) : 'Load Article'}
          </button>
        </form>

        {error && (
          <p className="text-sm text-red-600 text-center bg-red-50 px-4 py-3 rounded-lg">{error}</p>
        )}

        <p className="text-xs text-gray-400 text-center">
          {mode === 'url'
            ? 'Works with most news sites, blogs, and long-form articles.'
            : 'Paste any text — articles, book chapters, documents.'}
          <br/>First listen takes a moment to generate audio per paragraph.
        </p>
      </div>
    </main>
  );
}
