// Runs in the page's own JavaScript world on youtube.com so it can use the player.
// It only answers requests from the extension's content script (window.postMessage),
// and only reads data about the video that is open in this tab.
(() => {
  if (window.__coreShareMain) return;
  window.__coreShareMain = true;

  const cache = new Map();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const player = () => document.getElementById('movie_player');
  const adShowing = () => player()?.classList.contains('ad-showing');

  function find(o, key, out = []) {
    if (!o || typeof o !== 'object') return out;
    if (key in o) out.push(o[key]);
    for (const v of Object.values(o)) find(v, key, out);
    return out;
  }

  function headers() {
    const ctx = window.ytcfg?.get('INNERTUBE_CONTEXT');
    return {
      'content-type': 'application/json',
      'X-Youtube-Client-Name': '1',
      'X-Youtube-Client-Version': ctx?.client?.clientVersion || '',
    };
  }

  async function innertube(path, body) {
    const ctx = window.ytcfg?.get('INNERTUBE_CONTEXT');
    const res = await fetch(`/youtubei/v1/${path}?prettyPrint=false`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ context: ctx, ...body }),
    });
    return res.json();
  }

  async function meta(vid) {
    const [pr, next] = await Promise.all([innertube('player', { videoId: vid }), innertube('next', { videoId: vid })]);
    const d = pr?.videoDetails || {};
    const chapters = find(next, 'chapterRenderer')
      .map((c) => ({ title: c.title?.simpleText || '', start: (Number(c.timeRangeStartMillis) || 0) / 1000 }))
      .filter((c, i, arr) => arr.findIndex((x) => x.start === c.start) === i)
      .sort((a, b) => a.start - b.start);
    return {
      id: vid,
      title: d.title || document.title.replace(/ - YouTube$/, ''),
      channel: d.author || '',
      duration: Number(d.lengthSeconds) || player()?.getDuration?.() || 0,
      chapters,
    };
  }

  function timedtextEntries(vid) {
    return performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => n.includes('/api/timedtext') && new URL(n).searchParams.get('v') === vid);
  }

  function parseJson3(j) {
    return (j.events || [])
      .filter((e) => e.segs)
      .map((e) => ({ s: (e.tStartMs || 0) / 1000, t: e.segs.map((x) => x.utf8 || '').join('').replace(/\s+/g, ' ').trim() }))
      .filter((e) => e.t);
  }

  // The caption request needs a token that only the player adds, so we let the player
  // load the track and then read the same request back. Captions are restored afterwards.
  async function transcript(vid) {
    const p = player();
    if (!p?.loadModule) return { status: 'none', segments: [] };
    for (let i = 0; i < 180 && (adShowing() || p.getVideoData?.().video_id !== vid); i++) await sleep(500);
    if (adShowing()) return { status: 'ad', segments: [] };

    const before = p.getOption('captions', 'track');
    const wasOn = Boolean(before && before.languageCode);
    p.loadModule('captions');
    let list = [];
    for (let i = 0; i < 15 && !list.length; i++) {
      list = p.getOption('captions', 'tracklist') || [];
      if (!list.length) await sleep(200);
    }
    if (!list.length) {
      if (!wasOn) p.unloadModule('captions');
      return { status: 'none', segments: [] };
    }
    const asr = list.find((t) => t.kind === 'asr');
    const base = (t) => (t?.languageCode || '').split('-')[0];
    const pick =
      list.find((t) => t.kind !== 'asr' && asr && base(t) === base(asr)) ||
      list.find((t) => t.kind !== 'asr' && base(t) === 'en') ||
      asr ||
      list[0];

    const matches = (n) => new URL(n).searchParams.get('lang') === pick.languageCode;
    let url = timedtextEntries(vid).filter(matches).at(-1);
    let changed = false;
    if (!url) {
      const seen = new Set(timedtextEntries(vid));
      p.setOption('captions', 'track', { languageCode: pick.languageCode });
      changed = true;
      for (let i = 0; i < 30 && !url; i++) {
        await sleep(250);
        url = timedtextEntries(vid).find((n) => !seen.has(n) && matches(n));
      }
    }
    // Restore what the viewer had.
    if (changed) {
      if (wasOn) p.setOption('captions', 'track', before);
      else p.unloadModule('captions');
    } else if (!wasOn) {
      p.unloadModule('captions');
    }
    if (!url) return { status: 'none', segments: [] };

    const u = new URL(url);
    u.searchParams.delete('tlang');
    u.searchParams.set('fmt', 'json3');
    const segments = parseJson3(await (await fetch(u)).json());
    return { status: segments.length ? 'ok' : 'none', segments, language: pick.languageCode, auto: pick.kind === 'asr' };
  }

  async function getVideo(vid) {
    if (cache.has(vid)) return cache.get(vid);
    const job = (async () => {
      const m = await meta(vid);
      let tr;
      try {
        tr = await transcript(vid);
      } catch (e) {
        tr = { status: 'error', segments: [], error: String(e) };
      }
      return { ...m, transcript: tr };
    })();
    cache.set(vid, job);
    const out = await job;
    if (out.transcript.status !== 'ok') cache.delete(vid); // allow a retry later
    return out;
  }

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window || ev.data?.__coreShare !== 'req') return;
    const { id, type, vid } = ev.data;
    let data = null;
    let error = null;
    try {
      if (type === 'getVideo') data = await getVideo(vid);
      else if (type === 'adState') data = { ad: adShowing() };
    } catch (e) {
      error = String(e);
    }
    window.postMessage({ __coreShare: 'res', id, data, error }, '*');
  });
})();
