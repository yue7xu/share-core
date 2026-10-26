"use strict";
/* IntentShare client runtime: API calls, session, interaction log (plan §6.1), and two-device sync.
   Exposes window.Net and window.T. The UI (ui.js) is the artifact's UI with its AI calls and event log
   pointed here. */
(function () {
  const APP_VERSION = "web-1";
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const params = new URLSearchParams(location.search);
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const MODE = path === "/demo" ? "demo" : path === "/booth" ? "booth" : path === "/present" ? "presentation"
    : path === "/join" ? "study" : (params.get("mode") || "auto");

  /* ------------------------------------------------------------ API */
  const Net = { mode: MODE, uuid, store, params, session: null, boot: null };

  function headers(extra) {
    const h = { "Content-Type": "application/json" };
    const s = Net.session;
    if (s) { h.Authorization = "Session " + s.token; if (s.partner_token) h["X-Session-2"] = s.partner_token; }
    return Object.assign(h, extra || {});
  }
  Net.call = async function (path, { method = "POST", body, signal, timeout = 45000 } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    if (signal) signal.addEventListener("abort", () => ctl.abort(), { once: true });
    let res;
    try {
      res = await fetch(path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined, signal: ctl.signal, cache: "no-store" });
    } catch (e) {
      throw { code: signal && signal.aborted ? "cancelled" : ctl.signal.aborted ? "timeout" : "offline" };
    } finally { clearTimeout(t); }
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw { code: (data && data.error) || "http_" + res.status, status: res.status };
    return data;
  };

  Net.bootstrap = async function () {
    Net.boot = await Net.call("/api/bootstrap", { method: "GET" });
    return Net.boot;
  };

  Net.startSession = async function ({ code, mode }) {
    const id = uuid();
    const r = await Net.call("/api/session", { body: { code, session: { id, mode, client_now: Date.now(),
      viewport: innerWidth + "x" + innerHeight, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } } });
    Net.session = r;
    T.flushPersisted();
    Net.syncClock();
    return r;
  };

  /* Clock alignment for cross-device timings (sender's send vs receiver's "seen"): NTP-style, best of
     3 round trips to a DB-free endpoint, stored on the session. */
  Net.syncClock = async function () {
    let best = null;
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now(), p0 = performance.now();
      try {
        const r = await (await fetch("/api/time", { cache: "no-store" })).json();
        const rtt = performance.now() - p0;
        const offset = Math.round(r.now - (t0 + rtt / 2));
        if (!best || rtt < best.rtt) best = { offset, rtt: Math.round(rtt) };
      } catch {}
    }
    if (!best || !Net.session) return;
    Net.clock = best;
    T.log("app.clock", { offset_ms: best.offset, rtt_ms: best.rtt });
    fetch("/api/session", { method: "PATCH", headers: headers(), body: JSON.stringify({ session_id: Net.session.session_id, clock_offset_ms: best.offset }) }).catch(() => {});
  };

  /* ------------------------------------------------------------ Telemetry */
  const T = {
    enabled: true, queue: [], seq: 0, count: 0, context: () => ({}), timer: null, inflight: false,
    onCount: null,
  };
  /* Every event: client-generated id (dedupes retries), per-session seq (detects gaps), wall clock
     (client_ts) and monotonic clock (perf_ms). The UI's context() adds who/what it is about. */
  T.log = function (type, payload, ctx, at) {
    if (!T.enabled || !Net.session) return null;
    const base = T.context() || {};
    const c = Object.assign({}, base, ctx || {});
    const s = Net.session;
    const ev = {
      id: uuid(), session_id: s.session_id, participant_id: c.participant_id || s.participant.id, pair_id: s.participant.pair_id,
      conversation_id: c.conversation_id === undefined ? s.conversation_id : c.conversation_id,
      draft_id: c.draft_id || null, card_id: c.card_id || null, message_id: c.message_id || null,
      seq: ++T.seq, type, client_ts: new Date(at ? at.ts : Date.now()).toISOString(), perf_ms: Math.round((at ? at.perf : performance.now()) * 10) / 10,
      condition: c.condition || null, viewer: c.viewer || null, app_version: APP_VERSION, payload: payload || null,
    };
    T.queue.push(ev);
    T.count++;
    if (T.onCount) T.onCount(T.count);
    if (T.queue.length >= 20) T.flush();
    else if (!T.timer) T.timer = setTimeout(T.flush, 2000);
    return ev;
  };
  T.tokens = () => Net.session ? [Net.session.token, Net.session.partner_token || null] : [];
  T.flush = async function () {
    clearTimeout(T.timer); T.timer = null;
    if (T.inflight || !T.queue.length || !Net.session) return;
    const batch = T.queue.splice(0, 100);
    T.inflight = true;
    try {
      await Net.call("/api/events", { body: { events: batch }, timeout: 15000 });
    } catch (e) {
      T.queue.unshift(...batch); // keep order; retried on the next tick
      T.persist();
    } finally {
      T.inflight = false;
      if (T.queue.length) T.timer = setTimeout(T.flush, 4000);
    }
  };
  /* Unsent events survive a closed tab: they are kept with the tokens they belong to. */
  T.persist = function () {
    if (!T.queue.length) return;
    const pend = store.get("is_pending_events") || [];
    pend.push({ tokens: T.tokens(), events: T.queue.slice(0, 500) });
    store.set("is_pending_events", pend.slice(-5));
  };
  T.flushPersisted = async function () {
    const pend = store.get("is_pending_events");
    if (!pend || !pend.length) return;
    store.del("is_pending_events");
    for (const p of pend) {
      try {
        await fetch("/api/events", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(p) });
      } catch {}
    }
  };
  /* On tab close: sendBeacon cannot set headers, so tokens travel in the body. */
  T.beacon = function () {
    if (!T.queue.length || !Net.session) return;
    const payload = JSON.stringify({ tokens: T.tokens(), events: T.queue.splice(0, 200) });
    let ok = false;
    try { ok = navigator.sendBeacon("/api/events", new Blob([payload], { type: "text/plain" })); } catch {}
    if (!ok) { T.queue.unshift(...JSON.parse(payload).events); T.persist(); }
  };

  /* ------------------------------------------------------------ App-level events */
  let hiddenAt = null;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { hiddenAt = performance.now(); T.log("app.visibility", { state: "hidden" }); T.beacon(); }
    else { T.log("app.visibility", { state: "visible", away_ms: hiddenAt ? Math.round(performance.now() - hiddenAt) : null }); hiddenAt = null; }
  });
  addEventListener("focus", () => T.log("app.focus"));
  addEventListener("blur", () => T.log("app.blur"));
  addEventListener("pagehide", () => { T.log("app.session_end", { ms: Math.round(performance.now()) }); T.beacon(); });
  addEventListener("error", (e) => T.log("app.error", { message: String(e.message).slice(0, 300), source: String(e.filename || "").slice(-80), line: e.lineno }));
  addEventListener("unhandledrejection", (e) => T.log("app.error", { message: String(e.reason && (e.reason.message || e.reason.code) || e.reason).slice(0, 300) }));

  /* Generic click capture (plan §6.2 "ui.click"): every click, described by data-track or by role + label,
     so "how many clicks" never depends on having instrumented a button in advance. */
  function describe(el) {
    const t = el.closest("[data-track]");
    if (t) return t.getAttribute("data-track");
    const b = el.closest("button,a,input,select,textarea,label,[role=button],.conv,.anc,.opt,.cue");
    if (!b) return el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "");
    const label = (b.getAttribute("aria-label") || b.textContent || b.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return b.tagName.toLowerCase() + (b.className && typeof b.className === "string" ? "." + b.className.split(" ")[0] : "") + (label ? ":" + label : "");
  }
  document.addEventListener("click", (e) => {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    const host = el.closest("[data-mid]");
    const at = { ts: Date.now(), perf: performance.now() };
    const pre = (T.context() || {}).draft_id || null; // a click that ends a draft (Send) still belongs to it
    const payload = { target: describe(el), x: Math.round(e.clientX), y: Math.round(e.clientY), vw: innerWidth, vh: innerHeight };
    const ctx = host ? { message_id: host.getAttribute("data-mid"), card_id: host.getAttribute("data-cid") || null } : null;
    // Logged after the click's own handlers run, so a click that starts a draft is attributed to it;
    // the timestamp is still the moment of the click.
    setTimeout(() => T.log("ui.click", payload, Object.assign({ draft_id: pre || (T.context() || {}).draft_id || null }, ctx), at), 0);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Escape" || ((e.metaKey || e.ctrlKey) && /^[vcxz]$/i.test(e.key))) {
      T.log("ui.key", { key: (e.metaKey || e.ctrlKey ? "mod+" : "") + (e.shiftKey ? "shift+" : "") + e.key, target: describe(e.target instanceof Element ? e.target : document.body) });
    }
  }, true);

  /* ------------------------------------------------------------ Sync (study mode, two devices) */
  const Sync = { since: null, timer: null, onMessages: null, onMeta: null, running: false };
  Sync.tick = async function () {
    if (!Net.session || document.visibilityState === "hidden") return;
    try {
      const r = await Net.call("/api/sync" + (Sync.since ? "?since=" + encodeURIComponent(Sync.since) : ""), { method: "GET", timeout: 10000 });
      if (r.messages && r.messages.length) { Sync.since = r.messages[r.messages.length - 1].server_ts; Sync.onMessages && Sync.onMessages(r.messages); }
      Sync.onMeta && Sync.onMeta(r);
    } catch {}
  };
  Sync.start = function (intervalMs) {
    if (Sync.running) return; Sync.running = true;
    const loop = async () => { await Sync.tick(); Sync.timer = setTimeout(loop, intervalMs || 2000); };
    loop();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") Sync.tick(); });
  };

  window.Net = Net; window.T = T; window.Sync = Sync;
})();
