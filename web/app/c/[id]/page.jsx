import { notFound } from 'next/navigation';
import { getCard, costLine } from '../../../lib/card';
import CardView from './CardView';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { id } = await params;
  const card = await getCard(id);
  if (!card) return { title: 'Card not available' };
  const p = card.payload;
  const title = p.ai?.headline || p.source?.title || 'A shared video';
  const desc = [p.sender?.note ? `“${p.sender.note}” — ${card.sender}` : `From ${card.sender}`, costLine(p)].filter(Boolean).join(' · ');
  return {
    title,
    description: desc,
    openGraph: { title, description: desc, siteName: 'Core Share', type: 'website' },
    twitter: { card: 'summary_large_image', title, description: desc },
  };
}

export default async function CardPage({ params }) {
  const { id } = await params;
  const card = await getCard(id);
  if (!card) notFound();
  return <CardView card={card} />;
}
