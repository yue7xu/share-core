// Core Share on youtube.com (isolated world): Share button (D1), Mark button + Shift+M (D2),
// optional reaction toast that never pauses the video (D3), progress-bar pins + toast (D4).
(() => {
  if (window.__coreShareIso) return;
  window.__coreShareIso = true;

  const PIN_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 4.5 19.5 9l-3.2 3.2.6 4.3-1.4 1.4-3.5-3.5L7 19.4l-.9-.9 5-5-3.5-3.5 1.4-1.4 4.3.6L15 4.5Z"/></svg>';
  const SHARE_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 12h9M9 7l5 5-5 5M17 5v14"/></svg>';

  let vid = null;
  let toastTimer = null;

  // ---------- helpers ----------
  const videoId = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);
  const playerEl = () => document.getElementById('movie_player');
  const videoEl = () => document.querySelector('#movie_player video');
  const adShowing = () => playerEl()?.classList.contains('ad-showing');
  const key = (id) => `marks:${id}`;
  const clock = (s) => {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };
  const isEditable = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const log = (type, data) => chrome.runtime.sendMessage({ type: 'log', event: type, data }).catch(() => {});

  async function getMarks(id = vid) {
    const r = await chrome.storage.local.get(key(id));
    return r[key(id)] || [];
  }
  async function setMarks(marks, id = vid) {
    await chrome.storage.local.set({ [key(id)]: marks });
  }

  // Bridge to the page-world script (main-world.js).
  let reqId = 0;
  function bridge(type, extra = {}) {
    const id = `cs${++reqId}`;
    return new Promise((resolve, reject) => {
      const onMsg = (ev) => {
        if (ev.source !== window || ev.data?.__coreShare !== 'res' || ev.data.id !== id) return;
        window.removeEventListener('message', onMsg);
        ev.data.error ? reject(new Error(ev.data.error)) : resolve(ev.data.data);
      };
      window.addEventListener('message', onMsg);
      window.postMessage({ __coreShare: 'req', id, type, vid, ...extra }, '*');
    });
  }

  function openPanel(entry) {
    chrome.runtime.sendMessage({ type: 'openPanel', entry, vid }).catch(() => {});
  }

  // ---------- Share button in the action bar (D1) ----------
  function injectShareButton() {
    if (!vid || document.querySelector('.cs-share-btn')) return;
    const bar = document.querySelector('ytd-watch-metadata #top-level-buttons-computed') || document.querySelector('#top-level-buttons-computed');
    if (!bar) return;
    const btn = document.createElement('button');
    btn.className = 'cs-share-btn';
    btn.type = 'button';
    btn.title = 'Core Share: send the part that matters';
    btn.innerHTML = `${SHARE_SVG}<span>Share the part</span>`;
    btn.addEventListener('click', () => openPanel('share'));
    bar.appendChild(btn);
  }

  // ---------- Mark button on the player (D2) ----------
  function injectFab() {
    const p = playerEl();
    if (!vid || !p || p.querySelector('.cs-fab')) return;
    const fab = document.createElement('button');
    fab.className = 'cs-fab';
    fab.type = 'button';
    fab.title = 'Mark this moment (Shift+M)';
    fab.innerHTML = `${PIN_SVG}<span>Mark</span><kbd>⇧M</kbd>`;
    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      addMark('button');
    });
    // Keep the player from treating the click as play/pause.
    for (const t of ['mousedown', 'pointerdown', 'dblclick']) fab.addEventListener(t, (e) => e.stopPropagation());
    p.appendChild(fab);
  }

  // ---------- marks ----------
  async function addMark(via) {
    if (!vid) return;
    if (adShowing()) {
      showToast({ text: 'Marks are paused while an ad plays.' });
      return;
    }
    const v = videoEl();
    if (!v) return;
    const mark = { id: crypto.randomUUID(), t: Math.round(v.currentTime * 10) / 10, reaction: '', created_at: Date.now() };
    const marks = await getMarks();
    marks.push(mark);
    marks.sort((a, b) => a.t - b.t);
    await setMarks(marks);
    renderPins(marks);
    showToast({ mark });
    log('mark_added', { video: vid, t: mark.t, via });
    bridge('getVideo').catch(() => {}); // start reading the transcript early
  }

  async function updateMark(id, patch) {
    const marks = await getMarks();
    const m = marks.find((x) => x.id === id);
    if (!m) return;
    Object.assign(m, patch);
    await setMarks(marks);
  }

  async function removeMark(id) {
    const marks = (await getMarks()).filter((m) => m.id !== id);
    await setMarks(marks);
    renderPins(marks);
    log('mark_removed', { video: vid, via: 'pin' });
  }

  // ---------- pins on the progress bar (D4) ----------
  function renderPins(marks) {
    const bar = document.querySelector('#movie_player .ytp-progress-bar-container');
    const v = videoEl();
    document.querySelectorAll('.cs-pins').forEach((n) => n.remove());
    if (!bar || !v || !marks?.length || adShowing() || !isFinite(v.duration) || !v.duration) return;
    const layer = document.createElement('div');
    layer.className = 'cs-pins';
    for (const m of marks) {
      const pin = document.createElement('button');
      pin.className = 'cs-pin';
      pin.type = 'button';
      pin.style.left = `${Math.min(100, (m.t / v.duration) * 100)}%`;
      pin.title = `Marked ${clock(m.t)}${m.reaction ? ` · ${m.reaction}` : ''}`;
      for (const t of ['mousedown', 'pointerdown', 'mousemove']) pin.addEventListener(t, (e) => e.stopPropagation());
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        showPinPopover(pin, m);
      });
      layer.appendChild(pin);
    }
    bar.appendChild(layer);
  }

  function showPinPopover(pin, m) {
    document.querySelectorAll('.cs-pop').forEach((n) => n.remove());
    const pop = document.createElement('div');
    pop.className = 'cs-pop';
    const label = document.createElement('div');
    label.className = 'cs-pop-t';
    label.textContent = `Marked ${clock(m.t)}`;
    pop.appendChild(label);
    if (m.reaction) {
      const r = document.createElement('div');
      r.className = 'cs-pop-r';
      r.textContent = m.reaction;
      pop.appendChild(r);
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = 'Remove mark';
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      pop.remove();
      removeMark(m.id);
    });
    pop.appendChild(rm);
    for (const t of ['mousedown', 'pointerdown', 'click']) pop.addEventListener(t, (e) => e.stopPropagation());
    pin.parentElement.appendChild(pop);
    pop.style.left = pin.style.left;
    setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 0);
  }

  // ---------- toast with optional reaction (D3, D4) ----------
  function showToast({ mark, text }) {
    const p = playerEl();
    if (!p) return;
    p.querySelectorAll('.cs-toast').forEach((n) => n.remove());
    clearTimeout(toastTimer);
    const toast = document.createElement('div');
    toast.className = 'cs-toast';
    for (const t of ['mousedown', 'pointerdown', 'click', 'dblclick']) toast.addEventListener(t, (e) => e.stopPropagation());

    const head = document.createElement('div');
    head.className = 'cs-toast-head';
    head.innerHTML = PIN_SVG;
    const msg = document.createElement('span');
    msg.textContent = mark ? `Marked ${clock(mark.t)}` : text;
    head.appendChild(msg);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'cs-x';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', () => toast.remove());
    head.appendChild(close);
    toast.appendChild(head);

    if (mark) {
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 200;
      input.placeholder = 'Add a reaction (optional)';
      // Keep YouTube's keyboard shortcuts from firing while typing.
      for (const t of ['keydown', 'keyup', 'keypress']) input.addEventListener(t, (e) => e.stopPropagation());
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          await saveReaction();
          toast.remove();
        } else if (e.key === 'Escape') {
          toast.remove();
        }
      });
      const saveReaction = async () => {
        const r = input.value.trim();
        if (r && r !== mark.reaction) {
          mark.reaction = r;
          await updateMark(mark.id, { reaction: r });
          renderPins(await getMarks());
          log('mark_reaction', { video: vid, length: r.length });
        }
      };
      input.addEventListener('blur', saveReaction);
      input.addEventListener('focus', () => clearTimeout(toastTimer));
      toast.appendChild(input);

      const actions = document.createElement('div');
      actions.className = 'cs-toast-actions';
      const make = document.createElement('button');
      make.type = 'button';
      make.textContent = 'Make card';
      make.addEventListener('click', async () => {
        await saveReaction();
        toast.remove();
        openPanel('mark');
      });
      actions.appendChild(make);
      toast.appendChild(actions);
    }
    toast.addEventListener('mouseenter', () => clearTimeout(toastTimer));
    toast.addEventListener('mouseleave', () => {
      if (!toast.contains(document.activeElement)) toastTimer = setTimeout(() => toast.remove(), 2500);
    });
    p.appendChild(toast);
    toastTimer = setTimeout(() => {
      if (!toast.contains(document.activeElement)) toast.remove();
    }, mark ? 5000 : 2500);
  }

  // ---------- keyboard: Shift+M (YouTube already uses plain M for mute) ----------
  document.addEventListener(
    'keydown',
    (e) => {
      if (!vid || e.code !== 'KeyM' || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(e.target) || isEditable(document.activeElement)) return;
      e.preventDefault();
      e.stopPropagation();
      addMark('key');
    },
    true
  );

  // ---------- messages from the side panel ----------
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === 'cs:ping') {
      reply({ vid });
      return;
    }
    if (msg.type === 'cs:getVideo') {
      if (!vid) {
        reply({ error: 'not-a-video' });
        return;
      }
      bridge('getVideo')
        .then((data) => reply({ data }))
        .catch((e) => reply({ error: String(e) }));
      return true; // async
    }
    if (msg.type === 'cs:seek') {
      const v = videoEl();
      if (v && !adShowing()) {
        v.currentTime = msg.t;
        v.play?.();
      }
      reply({ ok: true });
      return;
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && vid && changes[key(vid)]) renderPins(changes[key(vid)].newValue || []);
  });

  // ---------- page lifecycle (YouTube is a single-page app) ----------
  async function refresh() {
    const next = videoId();
    const changed = next !== vid;
    vid = next;
    if (!vid) return;
    injectFab();
    injectShareButton();
    renderPins(await getMarks());
    if (changed) chrome.runtime.sendMessage({ type: 'cs:videoChanged', vid }).catch(() => {});
  }

  document.addEventListener('yt-navigate-finish', refresh);
  // The action bar and progress bar render late; keep trying cheaply.
  const obs = new MutationObserver(() => {
    if (!vid) return;
    if (!document.querySelector('.cs-share-btn')) injectShareButton();
    if (!playerEl()?.querySelector('.cs-fab')) injectFab();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('loadedmetadata', async (e) => {
    if (e.target === videoEl()) renderPins(await getMarks());
  }, true);
  setInterval(async () => {
    // Re-draw pins after ads end or the player re-renders.
    if (vid && !document.querySelector('.cs-pins') && !adShowing()) {
      const m = await getMarks();
      if (m.length) renderPins(m);
    }
  }, 2000);
  refresh();
})();
