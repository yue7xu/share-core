// Turns a transcript into "units": chapters when the video has them, otherwise ~1-minute chunks (D7).
export function clock(s) {
  s = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function minutes(sec) {
  sec = Math.round(Number(sec) || 0);
  if (sec < 60) return `${Math.max(sec, 1)} sec`;
  return `${Math.round(sec / 60)} min`;
}

export function buildUnits(video) {
  const segs = video.transcript?.segments || [];
  const duration = video.duration || (segs.length ? segs[segs.length - 1].s + 5 : 0);
  // Time markers about every 20 s let the AI point to the exact moment of each point.
  const textIn = (a, b) => {
    let last = -Infinity;
    return segs
      .filter((s) => s.s >= a && s.s < b)
      .map((s) => {
        const mark = s.s - last >= 20 ? `[${clock(s.s)}] ` : '';
        if (mark) last = s.s;
        return mark + s.t;
      })
      .join(' ');
  };

  if ((video.chapters || []).length >= 2) {
    const ch = video.chapters;
    return ch.map((c, i) => {
      const end = i + 1 < ch.length ? ch[i + 1].start : duration;
      return { id: `u${i + 1}`, start: c.start, end, title: c.title, text: textIn(c.start, end), chapter: true };
    });
  }
  if (!segs.length) {
    return [{ id: 'u1', start: 0, end: duration, title: 'Whole video', text: '', chapter: false }];
  }
  const units = [];
  let start = 0;
  let buf = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (buf.length && s.s - start >= 60) {
      units.push({ start, end: s.s });
      start = s.s;
      buf = [];
    }
    buf.push(s.t);
  }
  units.push({ start, end: Math.max(duration, start + 1) });
  for (const u of units) u.text = textIn(u.start, u.end);
  return units.map((u, i) => ({ id: `u${i + 1}`, ...u, title: '', chapter: false }));
}

export function unitAt(units, t) {
  return units.find((u) => t >= u.start && t < u.end) || units[units.length - 1] || null;
}

export const stripMarks = (t) => (t || '').replace(/\[\d+:\d{2}(?::\d{2})?\]\s?/g, '');

export function preview(text, n = 12) {
  const w = stripMarks(text).split(/\s+/).filter(Boolean);
  return w.slice(0, n).join(' ') + (w.length > n ? '…' : '');
}

// Same merge rule as the server: adjacent units become one part.
export function toRanges(units, ids) {
  const chosen = units.filter((u) => ids.includes(u.id)).sort((a, b) => a.start - b.start);
  const out = [];
  for (const u of chosen) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.end - u.start) < 1) {
      last.end = u.end;
      last.units.push(u.id);
      if (u.title) last.titles.push(u.title);
      last.text += ' ' + u.text;
    } else {
      out.push({ start: u.start, end: u.end, units: [u.id], titles: u.title ? [u.title] : [], text: u.text });
    }
  }
  return out.map((r) => ({
    start: Math.round(r.start),
    end: Math.round(r.end),
    units: r.units,
    title: r.titles.join(' / '),
    snippet: stripMarks(r.text).trim().slice(0, 1500),
  }));
}

export function coreDuration(ranges) {
  return ranges.reduce((n, r) => n + Math.max(0, r.end - r.start), 0);
}
