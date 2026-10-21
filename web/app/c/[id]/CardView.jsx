'use client';

import { useState } from 'react';
import { clock, costLine, minutes } from '../../../lib/format';

function embed(videoId, start, end, autoplay) {
  const q = new URLSearchParams({ start: String(start), rel: '0', modestbranding: '1', playsinline: '1' });
  if (end) q.set('end', String(end));
  if (autoplay) q.set('autoplay', '1');
  return `https://www.youtube-nocookie.com/embed/${videoId}?${q}`;
}

export default function CardView({ card }) {
  const p = card.payload;
  const src = p.source || {};
  const ai = p.ai || {};
  const ranges = p.core?.ranges || [];
  const [open, setOpen] = useState(false);
  // per-range playback start override (for "jump to" from AI points)
  const [starts, setStarts] = useState({});
  const watchUrl = `https://www.youtube.com/watch?v=${src.video_id}${ranges[0] ? `&t=${ranges[0].start}s` : ''}`;

  function jump(t) {
    const i = ranges.findIndex((r) => t >= r.start && t < r.end);
    const idx = i >= 0 ? i : 0;
    setOpen(true);
    setStarts((s) => ({ ...s, [idx]: { t, n: (s[idx]?.n || 0) + 1 } }));
    setTimeout(() => document.getElementById(`part-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  return (
    <main className="wrap">
      <p className="kicker">{card.sender} sent you part of a video</p>

      {/* Layer 1: the card */}
      <article className="card">
        <a className="source" href={watchUrl} target="_blank" rel="noopener noreferrer">
          <img src={`https://i.ytimg.com/vi/${src.video_id}/mqdefault.jpg`} alt="" />
          <div>
            <div className="t">{src.title}</div>
            <div className="c">YouTube{src.channel ? ` · ${src.channel}` : ''}</div>
          </div>
        </a>
        <div className="card-body">
          {ai.headline && (
            <div className="ai-row">
              <span className="ai-badge" title="Written by AI">AI</span>
              <p className="headline">{ai.headline}</p>
            </div>
          )}
          {p.sender?.note && (
            <p className="note" style={ai.headline ? null : { marginTop: 0 }}>
              {p.sender.note}
              <span className="by">— {card.sender}</span>
            </p>
          )}
          {ai.points?.length > 0 && (
            <ul className="points">
              {ai.points.map((pt, i) => (
                <li key={i}>
                  <button className="jump" onClick={() => jump(pt.t)} aria-label={`Play from ${clock(pt.t)}`}>▶ {clock(pt.t)}</button>
                  <span>{pt.text}</span>
                </li>
              ))}
            </ul>
          )}
          {costLine(p) && <p className="cost">{costLine(p)}</p>}
        </div>
      </article>

      {ai.not_found && (
        <p className="notice">The AI could not find what {card.sender}’s note refers to in this video, so no part was chosen.</p>
      )}

      {/* Layer 2: the part(s) */}
      {ranges.length > 0 && !open && (
        <div className="layer">
          <button className="btn primary block" onClick={() => setOpen(true)}>
            {ranges.length > 1 ? `Watch the ${ranges.length} parts` : 'Watch the part'} · {minutes(p.core?.duration)}
          </button>
        </div>
      )}
      {open && ranges.map((r, i) => (
        <section className="part" id={`part-${i}`} key={i}>
          <div className="part-head">
            <span>{ranges.length > 1 ? `Part ${i + 1}` : 'The part'}{r.title ? ` · ${r.title}` : ''}</span>
            <span className="time">{clock(r.start)}–{clock(r.end)}</span>
          </div>
          <div className="player">
            <iframe
              key={starts[i]?.n || 0}
              src={embed(src.video_id, starts[i]?.t ?? r.start, r.end, Boolean(starts[i]))}
              title={`Part ${i + 1} of ${src.title}`}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          </div>
          {r.snippet && (
            <details className="said">
              <summary>Read what’s said</summary>
              <p>{r.snippet}</p>
            </details>
          )}
        </section>
      ))}

      {/* Layer 3: the whole video */}
      <div className="layer">
        <a className="btn block" href={watchUrl} target="_blank" rel="noopener noreferrer">Open the whole video on YouTube</a>
      </div>

      <p className="foot">Core Share · a Carnegie Mellon University research prototype. Lines marked AI were written by AI and checked by {card.sender} before sending.</p>
    </main>
  );
}
