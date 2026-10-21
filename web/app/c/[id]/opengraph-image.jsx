import { ImageResponse } from 'next/og';
import { getCard, costLine } from '../../../lib/card';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'A Core Share card';

// The iMessage preview usually shows only this image, the title and the site name,
// so both voices (AI line + sender's note) and the time cost are drawn into the image (D11).
export default async function Image({ params }) {
  const { id } = await params;
  const card = await getCard(id);
  const p = card?.payload || {};
  const src = p.source || {};
  const ai = p.ai || {};
  const note = p.sender?.note || '';
  const big = ai.headline || src.title || 'A shared video';
  const bigSize = big.length > 110 ? 40 : big.length > 70 ? 48 : 56;
  const noteShort = note.length > 140 ? note.slice(0, 137) + '…' : note;

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#f5f3ee', padding: 48, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', background: '#ffffff', borderRadius: 28, border: '2px solid #e4e0d6', padding: 44 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {src.video_id && (
              <img src={`https://i.ytimg.com/vi/${src.video_id}/mqdefault.jpg`} width={192} height={108} style={{ borderRadius: 12, objectFit: 'cover' }} />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div style={{ fontSize: 26, color: '#1f1e1b', lineHeight: 1.25, display: 'flex' }}>{(src.title || '').slice(0, 90)}</div>
              <div style={{ fontSize: 22, color: '#6b6860', marginTop: 6, display: 'flex' }}>YouTube{src.channel ? ` · ${src.channel}` : ''}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, marginTop: 34, flex: 1 }}>
            {ai.headline && (
              <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: '#534ab7', background: '#eeedfe', borderRadius: 8, padding: '4px 12px', marginTop: 10 }}>AI</div>
            )}
            <div style={{ display: 'flex', fontSize: bigSize, fontWeight: 700, color: '#1f1e1b', lineHeight: 1.2, flex: 1 }}>{big}</div>
          </div>
          {noteShort && (
            <div style={{ display: 'flex', fontSize: 30, color: '#1f1e1b', borderLeft: '6px solid #e4e0d6', paddingLeft: 20, marginTop: 18 }}>
              “{noteShort}” — {card?.sender || ''}
            </div>
          )}
          <div style={{ display: 'flex', fontSize: 24, color: '#0f6e56', marginTop: 22 }}>▶ {costLine(p) || 'Open to watch'}</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
