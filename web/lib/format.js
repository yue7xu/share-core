export function minutes(sec) {
  sec = Math.round(Number(sec) || 0);
  if (sec < 60) return `${Math.max(sec, 1)} sec`;
  return `${Math.round(sec / 60)} min`;
}

export function clock(sec) {
  sec = Math.round(Number(sec) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function costLine(p) {
  const full = p.source?.duration || 0;
  const part = p.core?.duration || 0;
  if (part && full && part < full - 5) return `The part: ${minutes(part)} · Whole video: ${minutes(full)}`;
  return full ? `Whole video: ${minutes(full)}` : '';
}
