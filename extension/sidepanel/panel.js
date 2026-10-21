import { DEFAULT_SERVER } from '../config.js';
import { buildUnits, clock, coreDuration, minutes, preview, toRanges, unitAt } from './units.js';

const PIN = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 4.5 19.5 9l-3.2 3.2.6 4.3-1.4 1.4-3.5-3.5L7 19.4l-.9-.9 5-5-3.5-3.5 1.4-1.4 4.3.6L15 4.5Z"/></svg>';

const app = document.getElementById('app');
const S = {
  view: 'loading',
  code: null,
  server: DEFAULT_SERVER,
  me: null,
  aiConnected: null,
  tabId: null,
  video: null, // from the page: id, title, channel, duration, chapters, transcript
  units: [],
  marks: [],
  selected: new Set(),
  note: '',
  entry: 'icon',
  clarify: null, // { question, options, answer }
  draft: null, // { ai, coreUnits }
  sent: null, // { id, url }
  error: null,
};

// ---------- tiny DOM helper (no innerHTML with page data) ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // only for our own static icons
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
function render(...nodes) {
  app.replaceChildren(...nodes);
}

// ---------- server ----------
async function api(path, body) {
  const res = await fetch(`${S.server}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
  return data;
}
function log(type, data) {
  if (!S.code) return;
  fetch(`${S.server}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: S.code, type, data: { video: S.video?.id, entry: S.entry, ...data } }),
  }).catch(() => {});
}

// ---------- tab + page ----------
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
function sendToTab(msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(S.tabId, msg, (res) => {
      if (chrome.runtime.lastError) resolve({ error: 'no-content-script' });
      else resolve(res || {});
    });
  });
}
const isWatch = (url) => /^https:\/\/www\.youtube\.com\/watch\?/.test(url || '');
const vidOf = (url) => (isWatch(url) ? new URL(url).searchParams.get('v') : null);
const markKey = (id) => `marks:${id}`;
async function loadMarks(id) {
  const r = await chrome.storage.local.get(markKey(id));
  return r[markKey(id)] || [];
}
async function saveMarks(id, marks) {
  await chrome.storage.local.set({ [markKey(id)]: marks });
}
function seek(t) {
  sendToTab({ type: 'cs:seek', t });
}

// ---------- startup ----------
async function init() {
  const st = await chrome.storage.local.get(['code', 'server', 'me']);
  S.code = st.code || null;
  S.server = (st.server || DEFAULT_SERVER).replace(/\/$/, '');
  S.me = st.me || null;
  api('/api/status').then((s) => { S.aiConnected = s.ai; if (S.view === 'compose') showCompose(); }).catch(() => { S.aiConnected = false; });
  if (!S.code || !S.me?.name) return showSetup();
  try {
    const r = await api('/api/me', { code: S.code });
    S.me = r.me;
    await chrome.storage.local.set({ me: r.me });
    if (!S.me.name) return showSetup();
  } catch (e) {
    if (/not found/.test(e.message)) return showSetup(e.message);
  }
  await loadVideo();
}

async function readEntry() {
  const { entry } = await chrome.storage.session.get('entry');
  if (entry && entry.tabId === S.tabId && Date.now() - entry.at < 120000) S.entry = entry.type;
  else S.entry = 'icon';
}

async function loadVideo() {
  const tab = await activeTab();
  S.tabId = tab?.id ?? null;
  const vid = vidOf(tab?.url);
  if (!vid) return showIdle();
  await readEntry();
  if (S.video?.id !== vid) {
    S.video = null;
    S.units = [];
    S.selected = new Set();
    S.note = '';
    S.clarify = null;
    S.draft = null;
    S.sent = null;
  }
  S.marks = await loadMarks(vid);
  render(h('div', { class: 'spinner' }, 'Reading the video and its transcript…'));
  const res = await sendToTab({ type: 'cs:getVideo' });
  if (res.error === 'no-content-script') return showReload();
  if (res.error || !res.data) {
    return render(h('p', {}, 'Could not read this video.'), h('button', { class: 'btn', onclick: loadVideo }, 'Try again'));
  }
  S.video = res.data;
  S.units = buildUnits(S.video);
  log('panel_opened', { marks: S.marks.length, transcript: S.video.transcript?.status });
  showCompose();
}

// ---------- views ----------
function showSetup(err) {
  S.view = 'setup';
  const code = h('input', { type: 'text', value: S.code || '', placeholder: 'For example 1A2B3C4D', autocomplete: 'off', spellcheck: 'false' });
  const name = h('input', { type: 'text', value: S.me?.name || '', placeholder: 'A first name or nickname', maxlength: '40' });
  const msg = h('div', { class: 'err' }, err || '');
  const go = async () => {
    msg.textContent = '';
    if (!code.value.trim()) return (msg.textContent = 'Enter your access code.');
    if (!name.value.trim()) return (msg.textContent = 'Choose a display name.');
    try {
      const r = await api('/api/me', { code: code.value.trim().toUpperCase(), name: name.value.trim() });
      S.code = code.value.trim().toUpperCase();
      S.me = r.me;
      await chrome.storage.local.set({ code: S.code, me: r.me });
      log('setup_done', {});
      loadVideo();
    } catch (e) {
      msg.textContent = e.message;
    }
  };
  render(
    h('h2', {}, 'Set up Core Share'),
    h('p', { class: 'muted' }, 'Use the access code the researcher gave you.'),
    h('div', { class: 'field-label' }, 'Access code'),
    code,
    h('div', { class: 'field-label' }, 'Display name', h('span', { class: 'small' }, 'Your partner sees this')),
    name,
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: go }, 'Continue')),
    msg
  );
}

function showSettings() {
  S.view = 'settings';
  const server = h('input', { type: 'text', value: S.server });
  const msg = h('div', { class: 'small muted' }, `AI: ${S.aiConnected ? 'connected' : S.aiConnected === false ? 'not connected' : 'checking…'}`);
  render(
    h('h2', {}, 'Settings'),
    h('p', { class: 'muted small' }, `Signed in as ${S.me?.name || '—'} (code ${S.code || '—'}).`),
    h('div', { class: 'field-label' }, 'Study server'),
    server,
    msg,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => showSetup() }, 'Change code or name'),
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          S.server = server.value.trim().replace(/\/$/, '') || DEFAULT_SERVER;
          await chrome.storage.local.set({ server: S.server });
          init();
        },
      }, 'Save')
    )
  );
}

function showIdle() {
  S.view = 'idle';
  render(
    h('h2', {}, 'Open a YouTube video'),
    h('p', { class: 'muted' }, 'While watching, press Mark (or Shift+M) at moments you might want to send. When you are ready, click “Share the part” under the video.')
  );
}

function showReload() {
  S.view = 'reload';
  render(
    h('h2', {}, 'Reload the YouTube tab'),
    h('p', { class: 'muted' }, 'Core Share was installed after this tab opened. Reload the page, then try again.'),
    h('button', { class: 'btn', onclick: loadVideo }, 'Try again')
  );
}

function videoHeader() {
  const v = S.video;
  return h('div', { class: 'video' },
    h('img', { src: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`, alt: '' }),
    h('div', {}, h('div', { class: 't' }, v.title), h('div', { class: 'small muted' }, `${v.channel ? v.channel + ' · ' : ''}${minutes(v.duration)}`))
  );
}

// D5–D8: one panel for both entries; marks come in automatically; optional manual parts; note; Make card.
function showCompose() {
  S.view = 'compose';
  const v = S.video;
  const nodes = [videoHeader()];
  if (S.aiConnected === false) nodes.push(h('div', { class: 'banner' }, 'AI is not connected right now. You can still send the link and your note without an AI line.'));
  if (v.transcript?.status !== 'ok') nodes.push(h('div', { class: 'banner' }, v.transcript?.status === 'ad' ? 'Waiting for the ad to finish… then click Make card again.' : 'No transcript was found for this video. The AI can only use the chapter titles.'));

  // marks
  if (S.marks.length) {
    nodes.push(h('h3', {}, `Your marks (${S.marks.length})`));
    nodes.push(h('ul', { class: 'list' }, S.marks.map((m) => h('li', {},
      h('span', { class: 'pin', html: PIN }),
      h('button', { class: 'time', onclick: () => seek(m.t), title: 'Play from here' }, clock(m.t)),
      h('div', { class: 'grow' }, m.reaction ? h('div', {}, m.reaction) : h('div', { class: 'sub' }, preview(unitAt(S.units, m.t)?.text || unitAt(S.units, m.t)?.title || '', 9))),
      h('button', {
        class: 'x', 'aria-label': 'Remove mark', title: 'Remove mark',
        onclick: async () => {
          S.marks = S.marks.filter((x) => x.id !== m.id);
          await saveMarks(v.id, S.marks);
          log('mark_removed', { via: 'panel' });
          showCompose();
        },
      }, '×')
    ))));
    nodes.push(h('p', { class: 'small muted', style: 'margin-top:6px' }, 'Each mark brings in the whole passage around it.'));
  }

  // manual parts (L1)
  const markedUnits = new Set(S.marks.map((m) => unitAt(S.units, m.t)?.id));
  const parts = h('details', { class: 'parts', open: S.selected.size > 0 || (!S.marks.length && v.chapters?.length >= 2) ? true : null },
    h('summary', {}, `Choose parts yourself (optional)${S.selected.size ? ` · ${S.selected.size} chosen` : ''}`),
    h('ul', { class: 'list' }, S.units.map((u) => {
      const cb = h('input', { type: 'checkbox', checked: S.selected.has(u.id) ? true : null });
      cb.addEventListener('change', () => {
        cb.checked ? S.selected.add(u.id) : S.selected.delete(u.id);
        parts.querySelector('summary').textContent = `Choose parts yourself (optional)${S.selected.size ? ` · ${S.selected.size} chosen` : ''}`;
      });
      return h('li', {}, h('label', { class: 'grow' }, cb,
        h('div', { class: 'grow' },
          h('div', {}, u.title || preview(u.text, 10) || `${clock(u.start)}–${clock(u.end)}`),
          h('div', { class: 'sub' }, `${clock(u.start)}–${clock(u.end)} · ${minutes(u.end - u.start)}`))),
        markedUnits.has(u.id) ? h('span', { class: 'pin', title: 'You marked a moment here', html: PIN }) : null);
    }))
  );
  nodes.push(parts);

  // note
  const note = h('textarea', { maxlength: '1000', placeholder: `Write to ${S.me?.partner || 'your partner'} the way you normally would.` });
  note.value = S.note;
  note.addEventListener('input', () => (S.note = note.value));
  nodes.push(h('div', { class: 'field-label' }, `Note to ${S.me?.partner || 'your partner'}`, h('span', { class: 'small' }, 'Optional · sent exactly as you write it')));
  nodes.push(note);

  const err = h('div', { class: 'err' }, S.error || '');
  S.error = null;
  nodes.push(h('div', { class: 'row' }, h('button', { class: 'btn primary block', onclick: () => makeCard() }, 'Make card')));
  nodes.push(err);
  render(...nodes);
}

async function makeCard(clarifyAnswer) {
  S.view = 'loading';
  render(h('div', { class: 'spinner' }, 'Making the card…'));
  if (clarifyAnswer == null) {
    S.clarify = null;
    log('card_requested', { marks: S.marks.length, selected: S.selected.size, note_length: S.note.trim().length, transcript: S.video.transcript?.status });
  }
  const body = {
    video: { id: S.video.id, title: S.video.title, channel: S.video.channel, duration: S.video.duration },
    units: S.units.map(({ id, start, end, title, text }) => ({ id, start, end, title, text })),
    marks: S.marks.map((m) => ({ t: m.t, reaction: m.reaction })),
    selected: [...S.selected],
    note: S.note.trim(),
    relationship: S.me?.relationship || 'friend',
    clarify: S.clarify?.answer ? { question: S.clarify.question, answer: S.clarify.answer } : null,
  };
  let res;
  try {
    res = await api('/api/core', body);
  } catch (e) {
    S.error = `Could not reach the study server. ${e.message}`;
    return showCompose();
  }
  if (res.status === 'clarify') {
    S.clarify = { question: res.clarify.question, options: res.clarify.options };
    log('clarify_shown', { question: res.clarify.question });
    return showClarify();
  }
  S.draft = {
    ai: { ...res.ai, headline_ai: res.ai.headline, headline_edited: false, parts_changed: false, error: res.ai_error || null },
    coreUnits: res.core_units || [],
  };
  log('card_previewed', { intent: res.ai.intent_primary, summary_type: res.ai.summary_type, ai: res.ai.available, parts: (res.ranges || []).length, not_found: res.ai.not_found });
  showPreview();
}

// D9: ask once, before showing a card.
function showClarify() {
  S.view = 'clarify';
  const own = h('input', { type: 'text', placeholder: 'Something else…', maxlength: '200' });
  const answer = (a, how) => {
    S.clarify.answer = a;
    log('clarify_answered', { how });
    makeCard(a);
  };
  own.addEventListener('keydown', (e) => e.key === 'Enter' && own.value.trim() && answer(own.value.trim(), 'typed'));
  render(
    videoHeader(),
    h('h3', {}, 'One quick question'),
    h('p', {}, S.clarify.question),
    h('div', { class: 'chips' }, S.clarify.options.map((o) => h('button', { class: 'chip', onclick: () => answer(o, 'chip') }, o))),
    own,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => showCompose() }, 'Back'),
      h('button', { class: 'btn primary', onclick: () => own.value.trim() && answer(own.value.trim(), 'typed') }, 'Use my answer'))
  );
}

function currentRanges() {
  return toRanges(S.units, S.draft.coreUnits);
}

// D10: edit the AI line inline, remove/add parts, note stays as written, "Why these parts".
function showPreview() {
  S.view = 'preview';
  const v = S.video;
  const ai = S.draft.ai;
  const ranges = currentRanges();
  const part = coreDuration(ranges);
  const cost = part && part < v.duration - 5 ? `The part: ${minutes(part)} · Whole video: ${minutes(v.duration)}` : `Whole video: ${minutes(v.duration)}`;

  const body = h('div', { class: 'body' });
  if (ai.headline != null && ai.headline !== '') {
    const hl = h('p', { class: 'headline', contenteditable: 'plaintext-only', spellcheck: 'true', title: 'Click to edit' }, ai.headline);
    hl.addEventListener('input', () => {
      ai.headline = hl.textContent.replace(/\s+/g, ' ').trim();
      if (!ai.headline_edited) log('headline_edited', {});
      ai.headline_edited = ai.headline !== ai.headline_ai;
    });
    hl.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), hl.blur()));
    body.append(h('div', { class: 'ai-row' }, h('span', { class: 'ai-badge', title: 'Written by AI' }, 'AI'), hl));
    body.append(h('div', { class: 'edit-hint' }, ai.headline_edited ? 'Edited by you' : 'Written by AI · click to edit'));
  }
  if (S.note.trim()) body.append(h('p', { class: 'note' }, S.note.trim(), h('span', { class: 'by' }, `— ${S.me?.name || 'you'}`)));
  if (ai.points?.length) {
    body.append(h('ul', { class: 'points' }, ai.points.map((p) => h('li', {}, h('button', { class: 'time', onclick: () => seek(p.t) }, clock(p.t)), h('span', {}, p.text)))));
  }
  body.append(h('p', { class: 'cost' }, cost));

  const card = h('div', { class: 'card' },
    h('div', { class: 'src' }, h('img', { src: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`, alt: '' }),
      h('div', {}, h('div', { class: 't' }, v.title), h('div', { class: 'c' }, `YouTube${v.channel ? ' · ' + v.channel : ''}`))),
    body
  );

  const nodes = [h('h2', {}, 'Check the card'), h('p', { class: 'small muted' }, `This is what ${S.me?.partner || 'your partner'} will see. Nothing is sent until you create the link.`)];
  if (ai.error || !ai.available) nodes.push(h('div', { class: 'banner' }, 'AI is unavailable right now. You can still send the link and your note without an AI line.'));
  if (ai.not_found) nodes.push(h('div', { class: 'banner' }, 'The AI could not find what your note refers to in this video. You can choose parts yourself below.'));
  nodes.push(card);

  // parts
  nodes.push(h('h3', {}, ranges.length ? `Parts that will be sent (${ranges.length})` : 'No part chosen · the card links to the whole video'));
  if (ranges.length) {
    nodes.push(h('ul', { class: 'list' }, ranges.map((r) => h('li', {},
      h('button', { class: 'time', onclick: () => seek(r.start), title: 'Play this part' }, `${clock(r.start)}–${clock(r.end)}`),
      h('div', { class: 'grow' }, h('div', {}, r.title || preview(r.snippet, 9)), h('div', { class: 'sub' }, minutes(r.end - r.start))),
      h('button', {
        class: 'x', 'aria-label': 'Remove this part', title: 'Remove this part',
        onclick: () => {
          S.draft.coreUnits = S.draft.coreUnits.filter((id) => !r.units.includes(id));
          ai.parts_changed = true;
          log('part_removed', {});
          showPreview();
        },
      }, '×')
    ))));
  }
  const remaining = S.units.filter((u) => !S.draft.coreUnits.includes(u.id));
  if (remaining.length) {
    const sel = h('select', {}, h('option', { value: '' }, '+ Add a part…'),
      remaining.map((u) => h('option', { value: u.id }, `${clock(u.start)} · ${u.title || preview(u.text, 8)}`)));
    sel.style.marginTop = '8px';
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      S.draft.coreUnits.push(sel.value);
      ai.parts_changed = true;
      log('part_added', {});
      showPreview();
    });
    nodes.push(sel);
  }
  if (ai.rationale) nodes.push(h('details', { class: 'why' }, h('summary', {}, 'Why these parts'), h('p', { style: 'margin:6px 0 0' }, ai.rationale)));

  const err = h('div', { class: 'err' });
  const create = h('button', { class: 'btn primary', onclick: () => createLink(create, err) }, 'Create link');
  nodes.push(h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => showCompose() }, 'Back'), create));
  nodes.push(err);
  render(...nodes);
}

function payload() {
  const v = S.video;
  const ai = S.draft.ai;
  const ranges = currentRanges();
  return {
    source: { platform: 'youtube', video_id: v.id, url: `https://www.youtube.com/watch?v=${v.id}`, title: v.title, channel: v.channel, duration: Math.round(v.duration) },
    sender: { note: S.note.trim(), entry: S.entry, marks: S.marks.map((m) => ({ t: m.t, reaction: m.reaction })), selected: [...S.selected] },
    ai: {
      available: ai.available, model: ai.model, intent_primary: ai.intent_primary, intent_secondary: ai.intent_secondary,
      about_recipient: ai.about_recipient, summary_type: ai.summary_type,
      headline: ai.headline || null, headline_ai: ai.headline_ai, headline_edited: ai.headline_edited,
      points: ai.points || [], rationale: ai.rationale, not_found: ai.not_found,
      clarify: S.clarify?.answer ? { question: S.clarify.question, answer: S.clarify.answer } : null,
      parts_changed: ai.parts_changed,
    },
    core: { ranges, duration: coreDuration(ranges) },
  };
}

async function createLink(btn, err) {
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const r = await api('/api/cards', { code: S.code, payload: payload() });
    S.sent = r;
    await navigator.clipboard.writeText(r.url).catch(() => {});
    log('card_created', { card: r.id, headline_edited: S.draft.ai.headline_edited, parts_changed: S.draft.ai.parts_changed });
    // Marks that went into a card are cleared so they don't pile up.
    S.marks = [];
    await saveMarks(S.video.id, []);
    showSent();
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false;
    btn.textContent = 'Create link';
  }
}

function plainText() {
  const p = payload();
  const first = p.core.ranges[0];
  const yt = `https://youtu.be/${p.source.video_id}${first ? `?t=${first.start}` : ''}`;
  return [p.ai.headline ? `[AI] ${p.ai.headline}` : null, p.sender.note || null, yt].filter(Boolean).join('\n');
}

// After the link is made: copy, fallback text, and the two optional in-the-moment questions (m1).
function showSent() {
  S.view = 'sent';
  const copied = h('span', { class: 'small muted' });
  const copy = async (text, what) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    copied.textContent = 'Copied';
    setTimeout(() => (copied.textContent = ''), 1500);
    log(what === 'text' ? 'copy_text' : 'copy_link', { card: S.sent.id });
  };

  const m1a = h('textarea', { placeholder: 'Optional', maxlength: '500', style: 'min-height:60px' });
  let m1b = null;
  const scale = h('div', { class: 'scale' }, [1, 2, 3, 4, 5].map((n) => {
    const b = h('button', { type: 'button', 'aria-pressed': 'false' }, String(n));
    b.addEventListener('click', () => {
      m1b = n;
      scale.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
    return b;
  }));
  const qBox = h('div', {},
    h('hr'),
    h('p', { class: 'small muted' }, `Two optional questions. ${S.me?.partner || 'Your partner'} never sees your answers.`),
    h('div', { class: 'field-label' }, 'In a few words, what do you want your partner to get from this?'),
    m1a,
    h('div', { class: 'field-label' }, 'How well does the card say what you wanted?'),
    scale,
    h('div', { class: 'scale-ends' }, h('span', {}, '1 = Not at all'), h('span', {}, '5 = Exactly')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { log('insitu_m1_skipped', { card: S.sent.id }); qBox.replaceChildren(h('p', { class: 'small muted' }, 'Skipped.')); } }, 'Skip'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          log('insitu_m1', { card: S.sent.id, want: m1a.value.trim(), how_well: m1b });
          qBox.replaceChildren(h('p', { class: 'small muted' }, 'Thanks — saved.'));
        },
      }, 'Save answers'))
  );

  render(
    h('div', { class: 'ok' }, '✓ Link copied'),
    h('p', { class: 'muted', style: 'margin-top:6px' }, `Paste it into your chat with ${S.me?.partner || 'your partner'}. The preview shows the AI line, your note and how long it takes.`),
    h('div', { class: 'link' }, S.sent.url),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => copy(S.sent.url, 'link') }, 'Copy link again'),
      h('button', { class: 'btn', onclick: () => chrome.tabs.create({ url: S.sent.url }) }, 'Open card')),
    h('div', { class: 'row' }, h('button', { class: 'btn block', onclick: () => copy(plainText(), 'text'), title: 'Use this if the link preview does not work' }, 'Copy as text instead'), copied),
    qBox,
    h('hr'),
    h('button', {
      class: 'btn block',
      onclick: () => {
        S.draft = null; S.sent = null; S.note = ''; S.selected = new Set(); S.clarify = null;
        loadVideo();
      },
    }, 'Make another card')
  );
}

// ---------- events ----------
document.getElementById('settings-btn').addEventListener('click', () => (S.view === 'settings' ? init() : showSettings()));

// Follow the user to another video; never throw away a card that is being checked.
async function onTabChange() {
  if (['setup', 'settings', 'loading', 'clarify', 'preview', 'sent'].includes(S.view)) return;
  loadVideo();
}
chrome.tabs.onActivated.addListener(onTabChange);
chrome.tabs.onUpdated.addListener((id, info) => {
  if (id === S.tabId && info.url) onTabChange();
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'cs:videoChanged') onTabChange();
});
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'session' && changes.entry) {
    await readEntry();
    if (S.view === 'idle' || S.view === 'compose') loadVideo();
  }
  if (area === 'local' && S.video && changes[markKey(S.video.id)] && S.view === 'compose') {
    S.marks = changes[markKey(S.video.id)].newValue || [];
    showCompose();
  }
});

init();
