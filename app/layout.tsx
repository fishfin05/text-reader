import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Text Reader',
  description: 'Read articles aloud with word-level highlighting',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#fff', color: '#111' }}>{children}</body>
    </html>
  )
}
