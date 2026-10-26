// Content adapters (brief §5): URL -> ContentObject. Fixtures first (demo scenarios), then the cache,
// then a live adapter. Anything that can't be read becomes container-only (message + link, no AI parts).
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { FIXTURES, type ContentObject, type Unit } from './data';
import { api } from './db';

const UA = 'Mozilla/5.0 (compatible; IntentShareResearchBot/0.1; +https://github.com/yue7xu/share-core)';
const MAX_BYTES = 3_000_000;

async function get(url: string, ms = 8000, accept = 'text/html,application/json'): Promise<{ text: string; type: string; finalUrl: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.8' }, signal: ctl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) throw new Error('too large');
    return { text: new TextDecoder().decode(buf), type: r.headers.get('content-type') || '', finalUrl: r.url || url };
  } finally { clearTimeout(t); }
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };

export type Preview = { url: string; title: string; site: string; image: string | null; description: string | null };

export function previewFromHtml(html: string, url: string): Preview {
  const { document } = parseHTML(html);
  const meta = (k: string) => document.querySelector(`meta[property="${k}"],meta[name="${k}"]`)?.getAttribute('content') || null;
  let image = meta('og:image') || meta('twitter:image');
  if (image) { try { image = new URL(image, url).toString(); } catch { image = null; } }
  return {
    url,
    title: clean(meta('og:title') || meta('twitter:title') || document.querySelector('title')?.textContent || host(url)).slice(0, 200),
    site: clean(meta('og:site_name') || host(url)).slice(0, 80),
    image: image && image.startsWith('https://') ? image : null,
    description: (meta('og:description') || meta('description'))?.slice(0, 300) || null,
  };
}

export async function unfurl(url: string): Promise<Preview> {
  const fx = FIXTURES[url];
  if (fx) return { url, title: fx.title, site: host(url), image: null, description: null };
  const yt = youtubeId(url);
  try {
    if (yt) {
      const o = JSON.parse((await get(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, 5000, 'application/json')).text);
      return { url, title: o.title, site: 'YouTube', image: o.thumbnail_url || null, description: o.author_name || null };
    }
    const r = await get(url, 6000);
    return previewFromHtml(r.text, r.finalUrl);
  } catch {
    return { url, title: host(url), site: host(url), image: null, description: null };
  }
}

// ---------------------------------------------------------------- YouTube
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch {}
  return null;
}

async function youtube(url: string, id: string): Promise<ContentObject> {
  const page = await get(`https://www.youtube.com/watch?v=${id}&hl=en`, 8000);
  const m = page.text.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script>)/s);
  if (!m) throw new Error('no player response');
  const pr = JSON.parse(m[1]);
  const title = pr?.videoDetails?.title || 'YouTube video';
  const durationSec = Number(pr?.videoDetails?.lengthSeconds) || undefined;
  const tracks: any[] = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const track = tracks.find((t) => t.languageCode?.startsWith('en') && t.kind !== 'asr') || tracks.find((t) => t.languageCode?.startsWith('en')) || tracks[0];
  if (!track) throw new Error('no captions');
  const tt = JSON.parse((await get(track.baseUrl + '&fmt=json3', 8000, 'application/json')).text);
  const segs = (tt.events || []).filter((e: any) => e.segs).map((e: any) => ({
    start: e.tStartMs / 1000, end: (e.tStartMs + (e.dDurationMs || 0)) / 1000, text: e.segs.map((s: any) => s.utf8).join('') }));
  // ~45 s units, cut at sentence ends when possible (boundary snapping works on unit edges).
  const units: Unit[] = [];
  type Seg = { start: number; end: number; text: string };
  let cur: Seg | null = null;
  const flush = (c: Seg) => units.push({ unitId: `u${units.length + 1}`, start: Math.floor(c.start), end: Math.ceil(c.end), text: clean(c.text) });
  for (const s of segs as Seg[]) {
    const c: Seg = cur ? { start: cur.start, end: s.end, text: cur.text + ' ' + s.text } : { ...s };
    const long = c.end - c.start;
    if ((long >= 45 && /[.?!。？！]\s*$/.test(c.text)) || long >= 75) { flush(c); cur = null; } else cur = c;
  }
  if (cur) flush(cur);
  return { id: id, kind: 'video', sourceUrl: url, title, author: pr?.videoDetails?.author, durationSec, units: units.slice(0, 200),
    metadata: { captions: track.kind === 'asr' ? 'auto' : 'manual' }, isMock: false, adapter: 'youtube' };
}

// ---------------------------------------------------------------- Reddit
async function reddit(url: string): Promise<ContentObject> {
  const u = new URL(url);
  u.search = ''; u.hash = '';
  const j = JSON.parse((await get(u.toString().replace(/\/$/, '') + '.json?limit=40&raw_json=1', 8000, 'application/json')).text);
  const post = j?.[0]?.data?.children?.[0]?.data;
  if (!post) throw new Error('no post');
  const units: Unit[] = [{ unitId: 'c1', paragraphIndex: 1, text: clean(`${post.title}. ${post.selftext || ''}`).slice(0, 1500), itemType: 'post' }];
  for (const c of (j?.[1]?.data?.children || []).filter((c: any) => c.kind === 't1').slice(0, 30)) {
    const d = c.data;
    if (!d.body || d.body === '[deleted]' || d.body === '[removed]') continue;
    units.push({ unitId: `c${units.length + 1}`, paragraphIndex: units.length + 1, text: clean(d.body).slice(0, 800), itemType: 'comment' });
  }
  return { id: post.id, kind: 'thread', sourceUrl: url, title: post.title, author: post.subreddit_name_prefixed,
    units, metadata: { permalinkBase: 'https://www.reddit.com' }, isMock: false, adapter: 'reddit' };
}

// ---------------------------------------------------------------- Articles
async function article(url: string): Promise<ContentObject> {
  const r = await get(url, 8000, 'text/html');
  if (!/html/.test(r.type)) throw new Error('not html');
  const { document } = parseHTML(r.text);
  const pv = previewFromHtml(r.text, r.finalUrl);
  const art = new Readability(document as any, { charThreshold: 400 }).parse();
  if (!art?.content) throw new Error('unreadable');
  const { document: body } = parseHTML(`<html><body>${art.content}</body></html>`);
  const paras = [...body.querySelectorAll('p, li, h2, h3, blockquote')]
    .map((p: any) => clean(p.textContent || '')).filter((t) => t.length > 40);
  if (paras.length < 2) throw new Error('too little text');
  const units = paras.slice(0, 80).map((t, i) => ({ unitId: `p${i + 1}`, paragraphIndex: i + 1, text: t.slice(0, 1200) }));
  return { id: host(url), kind: 'article', sourceUrl: url, title: clean(art.title || pv.title), author: art.byline || pv.site,
    units, metadata: { site: pv.site, image: pv.image }, isMock: false, adapter: 'article' };
}

function containerOnly(url: string, title?: string): ContentObject {
  return { id: 'unknown', kind: 'article', sourceUrl: url, title: title || host(url), units: [], metadata: {}, isMock: false, containerOnly: true, adapter: 'none' };
}

export async function resolveContent(ref: string, opts: { cache?: boolean } = {}): Promise<ContentObject> {
  if (FIXTURES[ref]) return FIXTURES[ref];
  if (!/^https?:\/\//.test(ref)) return containerOnly(ref);
  if (opts.cache !== false) {
    try { const hit = await api('content_get', { url: ref }); if (hit?.content) return hit.content; } catch {}
  }
  let content: ContentObject;
  const yt = youtubeId(ref);
  try {
    if (yt) content = await youtube(ref, yt);
    else if (/(^|\.)reddit\.com$/.test(new URL(ref).hostname)) content = await reddit(ref);
    else content = await article(ref);
  } catch (e: any) {
    const pv = await unfurl(ref).catch(() => null);
    content = containerOnly(ref, pv?.title);
    content.metadata = { reason: String(e?.message || e).slice(0, 120), preview: pv };
    if (yt) content.kind = 'video';
  }
  if (opts.cache !== false && !content.containerOnly) { try { await api('content_put', { url: ref, adapter: content.adapter, content }); } catch {} }
  return content;
}
