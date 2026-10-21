'use client';

import { useEffect, useRef, useState } from 'react';
import { clock, costLine, minutes } from '../../../lib/format';

const BUBBLE_SECONDS = 5;

// Load the YouTube IFrame API once.
let ytReady = null;
function loadYT() {
  if (typeof window === 'undefined') return Promise.reject();
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!ytReady) {
    ytReady = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
  }
  return ytReady;
}

// One part of the video. Sender's timed comments appear as a bubble at their moment (E1).
function PartPlayer({ videoId, range, comments, sender, seekTo, title }) {
  const box = useRef(null);
  const player = useRef(null);
  const [now, setNow] = useState(null);

  useEffect(() => {
    let timer = null;
    let alive = true;
    loadYT().then((YT) => {
      if (!alive || !box.current) return;
      player.current = new YT.Player(box.current, {
        videoId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: { start: Math.floor(range.start), end: Math.ceil(range.end), rel: 0, playsinline: 1, modestbranding: 1 },
        events: {
          onReady: () => {
            timer = setInterval(() => {
              try {
                const t = player.current.getCurrentTime();
                const state = player.current.getPlayerState();
                setNow(state === 1 || state === 2 ? t : null);
              } catch {}
            }, 250);
          },
        },
      });
    });
    return () => {
      alive = false;
      clearInterval(timer);
      try { player.current?.destroy(); } catch {}
    };
  }, [videoId, range.start, range.end]);

  useEffect(() => {
    if (seekTo && player.current?.seekTo) {
      player.current.seekTo(seekTo.t, true);
      player.current.playVideo();
    }
  }, [seekTo]);

  const live = now == null ? [] : comments.filter((c) => now >= c.t - 0.3 && now < c.t + BUBBLE_SECONDS);

  return (
    <div className="player">
      <div ref={box} title={title} />
      <div className="bubbles" aria-live="polite">
        {live.map((c, i) => (
          <div className="bubble" key={`${c.t}-${i}`}>
            <span className="who">{sender} · {clock(c.t)}</span>
            <span className="what">{c.reaction}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CardView({ card }) {
  const p = card.payload;
  const src = p.source || {};
  const ai = p.ai || {};
  const ranges = p.core?.ranges || [];
  const comments = (p.sender?.marks || []).filter((m) => m.reaction && m.show !== false).sort((a, b) => a.t - b.t);
  const [open, setOpen] = useState(false);
  const [seek, setSeek] = useState({}); // per-part seek request
  const watchUrl = (t) => `https://www.youtube.com/watch?v=${src.video_id}${t != null ? `&t=${Math.floor(t)}s` : ''}`;

  function jump(t) {
    const i = ranges.findIndex((r) => t >= r.start && t < r.end);
    if (i < 0) {
      window.open(watchUrl(t), '_blank', 'noopener');
      return;
    }
    setOpen(true);
    setSeek((s) => ({ ...s, [i]: { t, n: (s[i]?.n || 0) + 1 } }));
    setTimeout(() => document.getElementById(`part-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  return (
    <main className="wrap">
      <p className="kicker">{card.sender} sent you part of a video</p>

      {/* Layer 1: the card */}
      <article className="card">
        <a className="source" href={watchUrl(ranges[0]?.start)} target="_blank" rel="noopener noreferrer">
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
          {comments.length > 0 && (
            <details className="comments">
              <summary>{card.sender}’s {comments.length === 1 ? 'comment' : `${comments.length} comments`} in the video</summary>
              <ul>
                {comments.map((c, i) => (
                  <li key={i}>
                    <button className="jump" onClick={() => jump(c.t)} aria-label={`Play from ${clock(c.t)}`}>▶ {clock(c.t)}</button>
                    <span className="said-by">{c.reaction}</span>
                  </li>
                ))}
              </ul>
            </details>
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
          {comments.length > 0 && <p className="hint">{card.sender}’s comments appear while you watch.</p>}
        </div>
      )}
      {open && ranges.map((r, i) => (
        <section className="part" id={`part-${i}`} key={i}>
          <div className="part-head">
            <span>{ranges.length > 1 ? `Part ${i + 1}` : 'The part'}{r.title ? ` · ${r.title}` : ''}</span>
            <span className="time">{clock(r.start)}–{clock(r.end)}</span>
          </div>
          <PartPlayer
            videoId={src.video_id}
            range={r}
            comments={comments.filter((c) => c.t >= r.start - 1 && c.t < r.end)}
            sender={card.sender}
            seekTo={seek[i]}
            title={`Part ${i + 1} of ${src.title}`}
          />
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
        <a className="btn block" href={watchUrl(null)} target="_blank" rel="noopener noreferrer">Open the whole video on YouTube</a>
      </div>

      <p className="foot">Core Share · a Carnegie Mellon University research prototype. Lines marked AI were written by AI and checked by {card.sender} before sending.</p>
    </main>
  );
}
