import { notFound } from 'next/navigation';
import { getArticleById } from '@/lib/db';
import Reader from '@/components/Reader';
import type { Article } from '@/lib/types';

export default async function ReaderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getArticleById(id);
  if (!data) notFound();

  const article: Article = {
    id: data.id,
    url: data.url,
    title: data.title,
    byline: data.byline,
    chunks: data.chunks,
    createdAt: data.created_at,
  };

  return <Reader article={article} />;
}
