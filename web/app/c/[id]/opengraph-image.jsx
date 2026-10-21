import { ImageResponse } from 'next/og';
import { getCard, costLine, clock } from '../../../lib/card';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'A Core Share card';

// Notes and titles can be in Chinese, Japanese or Korean; the default font has no CJK glyphs,
// so load Noto Sans SC from Google Fonts for just the characters that need it.
async function cjkFonts(text) {
  if (!/[⺀-鿿가-힯豈-﫿＀-￯　-〿]/.test(text)) return [];
  // Subset to every character used (Latin too), so nothing falls outside the loaded font.
  const chars = [...new Set(text + '▶·—“”…0123456789:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')].join('');
  const out = [];
  for (const weight of [400, 700]) {
    try {
      const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@${weight}&text=${encodeURIComponent(chars)}`)).text();
      const url = css.match(/src: url\(([^)]+)\) format\('(opentype|truetype|woff)'\)/)?.[1];
      if (url) out.push({ name: 'Noto Sans SC', data: await (await fetch(url)).arrayBuffer(), weight, style: 'normal' });
    } catch {
      // fall back to the default font
    }
  }
  return out;
}

// In iMessage the preview is ~300pt wide (about 1/4 of this image), with og:title (the AI line) and the
// site name shown as text underneath. So the image carries what the title can't, in large type:
// which video, the sender's own note, and what it costs to watch (D11).
export default async function Image({ params }) {
  const { id } = await params;
  const card = await getCard(id);
  const p = card?.payload || {};
  const src = p.source || {};
  const ai = p.ai || {};
  const ranges = p.core?.ranges || [];
  const note = p.sender?.note || '';
  const sender = card?.sender || '';
  // Without a note, the AI line becomes the main text (still labeled AI).
  const main = note || ai.headline || src.title || 'A shared video';
  const isNote = Boolean(note);
  const clipped = main.length > 90 ? main.slice(0, 88) + '…' : main;
  const mainSize = clipped.length > 60 ? 50 : clipped.length > 34 ? 58 : 68;
  const part = ranges.length ? `${clock(ranges[0].start)}${ranges.length > 1 ? ` +${ranges.length - 1}` : ''}` : '';
  const cost = costLine(p);
  const fonts = await cjkFonts(`${clipped} ${sender} ${cost} ${part} AI —“”`);
  const family = fonts.length ? '"Noto Sans SC", sans-serif' : 'sans-serif';

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#ffffff', fontFamily: family }}>
        <div style={{ display: 'flex', flex: 1 }}>
          <div style={{ display: 'flex', width: 470, height: 500, position: 'relative', background: '#1f1e1b' }}>
            {src.video_id && (
              <img src={`https://i.ytimg.com/vi/${src.video_id}/hqdefault.jpg`} width={470} height={500} style={{ objectFit: 'cover' }} />
            )}
            {part && (
              <div style={{ position: 'absolute', left: 24, bottom: 24, display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(20,20,20,0.82)', color: '#fff', borderRadius: 14, padding: '10px 18px', fontSize: 34, fontWeight: 700 }}>
                ▶ {part}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1, padding: '40px 52px' }}>
            {!isNote && ai.headline && (
              <div style={{ display: 'flex', alignSelf: 'flex-start', fontSize: 30, fontWeight: 700, color: '#534ab7', background: '#eeedfe', borderRadius: 10, padding: '4px 14px', marginBottom: 18 }}>AI</div>
            )}
            <div style={{ display: 'flex', fontSize: mainSize, fontWeight: 700, color: '#1f1e1b', lineHeight: 1.22 }}>
              {isNote ? `“${clipped}”` : clipped}
            </div>
            {isNote && sender && <div style={{ display: 'flex', fontSize: 36, color: '#6b6860', marginTop: 18 }}>— {sender}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', height: 130, padding: '0 44px', background: '#eeedfe', color: '#3c3489', fontSize: 40, fontWeight: 700 }}>
          {cost || 'Open to watch'}
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined }
  );
}
