"use strict";
/* IntentShare Messages — UI. Layout, copy and flow are the artifact's (design/artifact-messages-v1.html).
   Changes: AI calls go to /api/ai/*, every interaction is logged through T.log (plan §6.2), messages are
   stored and synced between two devices, plus sign-in, study questions and "Exclude from study". */

/* ================= State ================= */
const AV_COLORS = {A:"#5E6AD2", B:"#E07A3F", C:"#3E9E73", G:"#8E6BC8", X:"#7A8794"};
const STATE = { cond:"ai", tier:"quick" };
const UI = { conv:"R", viewer:"A", attachment:null, lastText:{}, single:false, study:false, surveys:false, locked:false };
let CONVS = {};
const ME = () => Net.session.participant, PARTNER = () => Net.session.partner;

function avatar(letter, cls){ return h("div",{class:"av "+(cls||""), style:"background:"+(AV_COLORS[letter]||"#7A8794")}, letter); }
const timeFmt = (d) => d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
const conv = () => CONVS[UI.conv];
const isResearch = (c) => c && c.key === "R";
/* Demo: one screen plays both A and B (the A/B toggle). Study / phone: you are your own role. */
const viewer = () => UI.single ? ME().role : (isResearch(conv()) ? UI.viewer : "A");
const otherRole = (r) => r === "A" ? "B" : "A";
const pidOf = (role) => role === ME().role ? ME().id : PARTNER().id;
const nameOf = (role) => UI.single ? (role === ME().role ? ME().display_name : PARTNER().display_name) : role;
const initial = (role) => (nameOf(role) || role).trim().charAt(0).toUpperCase() || role;

T.context = () => !Net.session ? {} : ({
  participant_id: isResearch(conv()) || UI.single ? pidOf(viewer()) : ME().id,
  viewer: viewer(), condition: STATE.cond,
  conversation_id: isResearch(conv()) ? Net.session.conversation_id : null,
  draft_id: Draft.id,
});

/* ================= Draft tracking (one id per composition; becomes the share id) ================= */
const Draft = { id:null, keys:0, deletes:0, timer:null, linkLogged:false, scenario:null, scenarioText:null, lastSnap:"" };
function draftEnsure(){ if (!Draft.id){ Draft.id = Net.uuid(); Draft.keys = 0; Draft.deletes = 0; Draft.linkLogged = false; } return Draft.id; }
function snapshot(){
  clearTimeout(Draft.timer); Draft.timer = null;
  if (!Draft.id) return;
  const text = input.value;
  if (text === Draft.lastSnap && !Draft.keys && !Draft.deletes) return;
  T.log("compose.input", {text, length:text.length, keys:Draft.keys, deletes:Draft.deletes});
  Draft.keys = 0; Draft.deletes = 0; Draft.lastSnap = text;
}
function draftReset(){ snapshot(); Draft.id = null; Draft.scenario = null; Draft.scenarioText = null; Draft.lastSnap = ""; }

/* ================= Sidebar + header + thread ================= */
function previewText(m){
  if (!m) return "";
  if (m.kind==="text") return m.text;
  if (m.kind==="card") return (m.card.senderNote ? m.card.senderNote + " · " : "") + "Share card";
  return (m.note ? m.note + " · " : "") + (m.content ? m.content.title : "");
}
function renderSide(){
  const q = $("#search").value.trim().toLowerCase();
  $("#convs").replaceChildren(...Object.values(CONVS).filter(c => !q || (c.name + " " + c.thread.map(previewText).join(" ")).toLowerCase().includes(q)).map(c => {
    const last = c.thread[c.thread.length-1];
    const other = isResearch(c) ? otherRole(viewer()) : null;
    return h("button",{class:"conv", type:"button", "aria-current": String(c.key===UI.conv), onclick:() => { UI.conv = c.key; widget.close(); renderAll(); }},
      avatar(isResearch(c) ? initial(other) : c.av), h("span",{class:"n"}, isResearch(c) ? nameOf(other) : c.name), h("span",{class:"t"}, last ? timeFmt(last.time) : ""), h("span",{class:"p"}, previewText(last)));
  }));
}
function renderTop(){
  const c = conv(), v = viewer();
  const other = isResearch(c) ? otherRole(v) : c.av;
  const av = $("#top-av"); av.textContent = isResearch(c) ? initial(other) : other; av.style.background = AV_COLORS[other] || "#7A8794";
  $("#top-name").textContent = isResearch(c) ? nameOf(other) : c.name;
  $("#top-sub").textContent = isResearch(c) ? (UI.single ? "Research chat" : "Research chat · you are " + v) : c.sub;
  $("#viewseg").hidden = !isResearch(c) || UI.single;
  for (const b of document.querySelectorAll("#viewseg button")) b.setAttribute("aria-pressed", String(b.dataset.v===UI.viewer));
  const pin = $("#pin"); pin.hidden = !c.pinned; if (c.pinned) pin.replaceChildren("📌 Pinned", h("b",null, c.pinned));
}

/* ---------- Rich card (artifact) + receiver instrumentation ---------- */
function anchorChip(a, content, idx, m){
  const kinds = {time_range: fmt(a.start)+"–"+fmt(a.end), text_span:"¶", item:"•", image_region:"▣"};
  const inner = [h("span",{class:"k"}, kinds[a.kind]), h("span",null, a.label)];
  let href = null;
  if (a.kind==="time_range" && content.sourceUrl.startsWith("http")) href = withT(content.sourceUrl, a.start);
  if (a.kind==="text_span" && content.sourceUrl.startsWith("http") && a.firstText) href = textFrag(content.sourceUrl, a.firstText);
  const log = () => m && T.log("card.chip_click", {anchor_index:idx, kind:a.kind, start:a.start ?? null, label:a.label, href}, {message_id:m.id, card_id:m.card && m.card.id});
  return href ? h("a",{class:"anc", href, target:"_blank", rel:"noopener", title:a.why, "data-track":"card-chip", onclick:log}, inner)
              : h("span",{class:"anc", title:a.why, "data-track":"card-chip", onclick:log}, inner);
}
function actionBlock(card, rerender, m){
  const a = card.action, p = a.payload || {}, wrap = h("div",{class:"act"});
  const pick = (v) => { a.state = v; T.log("card.action_click", {type:a.type, value:v}, m ? {message_id:m.id, card_id:card.id} : null); rerender(); };
  const list = (opts, note) => { wrap.append(h("div",{class:"alab"}, note), h("div",{class:"opts"}, (opts||[]).map(o => h("button",{class:"opt"+(a.state===o?" on":""), type:"button", "data-track":"card-action", onclick:() => pick(o)}, o)))); };
  const one = (label, done) => a.state ? wrap.append(h("div",{class:"done"}, done)) : wrap.append(h("div",{class:"opts"}, h("button",{class:"opt", type:"button", "data-track":"card-action", onclick:() => pick("yes")}, label)));
  switch (a.type){
    case "time_options": (p.options||[]).length ? list(p.options, "Free for both of you · mock calendar") : wrap.append(h("div",{class:"alab"},"No shared free time this week · mock calendar")); break;
    case "reply_options": list(p.options, "Reply"); break;
    case "quick_replies": list(p.options, "Quick replies"); break;
    case "save_for_later": one("Remind me next time I'm nearby", "Saved. A reminder near the place is future work."); break;
    case "add_to_calendar": one("Add “"+p.label+"” to calendar", "Added to calendar · mock"); break;
    case "alternatives": one("Suggest another option", "Asked for another option · mock"); break;
    case "save": one("Save for later", "Saved · mock"); break;
    case "set_reminder": one("Remind me "+p.label, "Reminder set for "+p.label+" · mock"); break;
    case "pin": wrap.append(h("div",{class:"alab"}, card.status==="sent" ? "Pinned to this chat" : "Will be pinned to this chat")); break;
    case "replace_previous": if (p.previousTitle) wrap.append(h("div",{class:"alab"}, "Replaces “"+p.previousTitle+"”")); break;
  }
  if (p.text && a.type!=="quick_replies") wrap.append(h("div",{class:"alab"},"Something to reply"), h("p",{class:"sum"}, p.text));
  return wrap.childNodes.length ? wrap : null;
}
function richCard(card, m){
  const el = h("div",{class:"rich"+(card.replaced?" replaced":""), role:"group", "aria-label":"Share card"});
  const rerender = () => el.replaceWith(richCard(card, m));
  if (card.replaced) el.append(h("div",{class:"rep"},"Replaced by a newer version"));
  const t = TYPES[card.intent.primary] || TYPES.OTHER, ex = card.extraction;
  const ai = h("div",{class:"rich-ai"});
  ai.append(h("div",{class:"ai-row"}, h("span",{class:"ai-tag"},"AI"),
    h("span",{class:"ai-label "+t.cls}, t.label + (card.intent.secondary && TYPES[card.intent.secondary] ? " · " + TYPES[card.intent.secondary].label.toLowerCase() : "")),
    card.content.isMock ? h("span",{class:"mock"},"Mock content") : null, card.cached ? h("span",{class:"cached"},"cached") : null));
  if (ex.containerOnly) ai.append(h("p",{class:"sum"},"This page couldn't be read, so the card carries only the message and the link."));
  else if (ex.summary) ai.append(h("p",{class:"sum"}, ex.summary));
  if (ex.anchors.length) ai.append(h("div",{class:"chips"}, ex.anchors.map((a,i) => anchorChip(a, card.content, i, m))));
  const act = actionBlock(card, rerender, m); if (act) ai.append(act);
  el.append(ai);
  const src = card.content.sourceUrl;
  const foot = [h("span",{class:"ti"}, card.content.title), h("span",{class:"du"}, coreText(card))];
  const open = () => m && T.log("card.open_original", {kind:"card", href:src}, {message_id:m.id, card_id:card.id});
  el.append(src.startsWith("http") ? h("a",{class:"rich-foot", href:src, target:"_blank", rel:"noopener", "data-track":"card-open-original", onclick:open}, foot) : h("div",{class:"rich-foot"}, foot));
  return el;
}
function plainPreview(content, m){
  const img = h("div",{class:"img"});
  if (content.image) img.style.backgroundImage = "url(" + JSON.stringify(content.image) + ")";
  const inner = [img, h("div",{class:"tx"}, h("b",null, content.title), h("span",null, content.site || hostOf(content.sourceUrl)))];
  const open = () => m && T.log("card.open_original", {kind:"plain", href:content.sourceUrl}, {message_id:m.id});
  return content.sourceUrl && content.sourceUrl.startsWith("http") ? h("a",{class:"lp", href:content.sourceUrl, target:"_blank", rel:"noopener", "data-track":"plain-open", onclick:open}, inner) : h("div",{class:"lp"}, inner);
}
function itemRows(m, mine, showBy){
  const row = h("div",{class:"row "+(mine?"me":"them")});
  if (m.id){ row.setAttribute("data-mid", m.id); if (m.card) row.setAttribute("data-cid", m.card.id); }
  if (showBy) row.append(h("div",{class:"by"}, m.from));
  if (m.kind==="text") row.append(h("div",{class:"bub"}, m.text));
  if (m.kind==="card"){ if (m.card.senderNote) row.append(h("div",{class:"bub"}, m.card.senderNote)); row.append(richCard(m.card, m.id ? m : null)); }
  if (m.kind==="plain"){ if (m.note) row.append(h("div",{class:"bub"}, m.note)); row.append(plainPreview(m.content, m.id ? m : null)); }
  if (mine && UI.study && m.id && m.persisted){
    row.append(m.excluded ? h("span",{class:"xnote"},"Excluded from study")
      : h("button",{class:"xbtn", type:"button", "data-track":"exclude-message", onclick:() => excludeMessage(m)}, "Exclude from study"));
  }
  return row;
}

/* Receiver attention: rendered (≥50% in view), seen (in view ≥1 s), dwell (total time in view). */
const Seen = { rendered:new Set(), seen:new Set(), live:new Map() };
const observer = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  for (const e of entries){
    const el = e.target, mid = el.getAttribute("data-mid"), cid = el.getAttribute("data-cid") || null;
    const key = viewer() + ":" + mid;
    if (e.isIntersecting && e.intersectionRatio >= 0.5){
      if (!Seen.rendered.has(key)){ Seen.rendered.add(key); T.log("card.rendered", {kind: cid ? "card" : "plain"}, {message_id:mid, card_id:cid}); }
      if (!Seen.live.has(el)){
        const rec = {start: performance.now(), mid, cid, key};
        rec.timer = setTimeout(() => { if (!Seen.seen.has(key)){ Seen.seen.add(key); T.log("card.seen", {kind: cid ? "card" : "plain"}, {message_id:mid, card_id:cid}); onPartnerItemSeen(mid); } }, 1000);
        Seen.live.set(el, rec);
      }
    } else endDwell(el);
  }
}, {threshold:[0, 0.5]}) : null;
function endDwell(el){
  const rec = Seen.live.get(el); if (!rec) return;
  clearTimeout(rec.timer); Seen.live.delete(el);
  const ms = Math.round(performance.now() - rec.start);
  if (ms >= 300) T.log("card.dwell", {dwell_ms:ms}, {message_id:rec.mid, card_id:rec.cid});
}
function endAllDwell(){ for (const el of [...Seen.live.keys()]) endDwell(el); if (observer) observer.disconnect(); }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") endAllDwell(); else renderThread(); });

function renderThread(){
  endAllDwell();
  const c = conv(), v = viewer(), box = $("#thread"), out = [];
  let prevTime = null, prevFrom = null, lastMine = -1;
  c.thread.forEach((m,i) => { if (m.from===v) lastMine = i; });
  c.thread.forEach((m,i) => {
    if (!prevTime || m.time - prevTime > 30*60000) { out.push(h("div",{class:"stamp"}, (sameDay(m.time) ? "Today " : m.time.toLocaleDateString([], {weekday:"short", month:"short", day:"numeric"}) + " ") + timeFmt(m.time))); prevFrom = null; }
    const mine = m.from===v;
    const row = itemRows(m, mine, !mine && !isResearch(c) && m.from!==prevFrom);
    out.push(row);
    if (!mine && isResearch(c) && m.id && (m.kind==="card" || m.kind==="plain") && observer) observer.observe(row);
    if (i===lastMine) out.push(h("div",{class:"status", style:"align-self:flex-end"}, m.failed ? "Not delivered" : m.card && m.card.sample ? "Delivered · sample" : "Delivered"));
    prevTime = m.time; prevFrom = m.from;
  });
  box.replaceChildren(...out);
  box.scrollTop = box.scrollHeight;
}
const sameDay = (d) => d.toDateString() === new Date().toDateString();
function renderAll(){ renderSide(); renderTop(); renderThread(); renderAttach(); widget.refresh(); syncSend(); Surveys.render(); }

/* ================= Composer ================= */
const input = $("#input");
function renderAttach(){
  const slot = $("#attslot");
  slot.replaceChildren(...(UI.attachment ? [h("span",{class:"att"}, h("span",{class:"thumb", "aria-hidden":"true"}), UI.attachment.label,
    h("button",{type:"button", "aria-label":"Remove photo", onclick:() => { UI.attachment = null; T.log("compose.attach", {removed:true}); renderAttach(); widget.refresh(); syncSend(); }}, "×"))] : []));
}
function autoGrow(){ input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; }
function syncSend(){ $("#send").disabled = UI.locked || (!input.value.trim() && !UI.attachment); input.disabled = UI.locked; }

/* Store a message (research chat only) and show it. Demo decoration chats stay local. */
function deliver(entry, extra){
  const c = conv(); entry.from = viewer(); entry.time = new Date();
  entry.id = entry.id || Net.uuid();
  if (entry.kind==="card"){
    const k = entry.card;
    if (k.action.type==="replace_previous"){
      const prev = [...c.thread].reverse().find(m => m.kind==="card" && m.from===entry.from && (!k.action.payload.previousTitle || m.card.content.title===k.action.payload.previousTitle));
      if (prev) prev.card.replaced = true;
    }
    if (k.action.type==="pin") c.pinned = k.content.title;
  }
  c.thread.push(entry); UI.lastText[c.key+entry.from] = null;
  T.log("msg.sent", {kind:entry.kind, length:(entry.text || entry.note || (entry.card && entry.card.senderNote) || "").length}, {message_id:entry.id, card_id:entry.card ? entry.card.id : null});
  if (isResearch(c)) persist(entry, extra);
  renderAll();
}
async function persist(entry, extra){
  const msg = { id:entry.id, conversation_id:Net.session.conversation_id, sender_id:pidOf(entry.from), kind:entry.kind,
    text: entry.kind==="text" ? entry.text : entry.kind==="card" ? entry.card.senderNote : entry.note,
    link_url: entry.kind==="card" ? entry.card.content.sourceUrl : entry.kind==="plain" ? entry.content.sourceUrl : null,
    card_id: entry.card ? entry.card.id : null, share_id: (extra && extra.shareId) || null,
    plain_preview: entry.kind==="plain" ? entry.content : null, client_ts: entry.time.toISOString() };
  entry.shareId = msg.share_id;
  try {
    const r = await Net.call("/api/messages", {body:{message:msg, card: entry.card || null}});
    entry.persisted = true; entry.failed = false;
    if (r && r.server_ts) entry.serverTs = r.server_ts;
  } catch (e) {
    entry.failed = true;
    if (e.code === "locked") setLocked(true);
    toast(e.code === "locked" ? "The study period has ended, so new messages aren't sent." : "This message couldn't be delivered. Check your connection.");
  }
  renderThread();
}
async function excludeMessage(m){
  try {
    await Net.call("/api/messages/exclude", {body:{message_id:m.id, participant_id:pidOf(m.from)}});
    m.excluded = true; T.log("study.exclude_message", null, {message_id:m.id}); renderThread();
    toast("Excluded. This message won't be used in the study.");
  } catch { toast("Couldn't exclude it right now. Try again."); }
}
function toast(text){
  const t = h("div",{class:"toast", role:"status"}, text);
  document.body.append(t); setTimeout(() => t.remove(), 4200);
}
function setLocked(v){
  UI.locked = v; input.placeholder = v ? "The study period has ended. Thank you!" : "Message"; syncSend();
}

/* ================= AI calls (server) ================= */
async function aiCall(task, bodyArgs, cur){
  const crid = Net.uuid(), t0 = performance.now();
  T.log("ai.request", {task, client_request_id:crid, attempt:cur.regenerations}, {draft_id:cur.shareId});
  try {
    const r = await Net.call("/api/ai/" + task, {body:Object.assign({participant_id:pidOf(viewer()), share_id:cur.shareId, tier:STATE.tier,
      attempt:cur.regenerations, client_request_id:crid}, bodyArgs), signal:cur.ctl.signal, timeout: Net.mode==="booth" ? 9000 : 60000});
    T.log("ai.response", {task, client_request_id:crid, wait_ms:Math.round(performance.now()-t0), model:r.model, server_latency_ms:r.latency_ms}, {draft_id:cur.shareId});
    return r;
  } catch (e) {
    if (e.code !== "cancelled") T.log("ai.error", {task, client_request_id:crid, code:e.code, wait_ms:Math.round(performance.now()-t0)}, {draft_id:cur.shareId});
    const rp = Net.mode==="booth" && Replay.get(task, bodyArgs);
    if (rp && e.code !== "cancelled"){ cur.cached = true; return rp; }
    throw e;
  }
}
/* CHI booth: if the venue Wi-Fi fails, sample shares fall back to a recorded live result (shown as "cached"). */
const Replay = {
  data:null,
  async load(){ try { this.data = await (await fetch("/app/replay.json", {cache:"no-store"})).json(); } catch { this.data = {}; } },
  get(task, a){ const k = (a.message || "") + "|" + (a.content_ref || ""); const r = this.data && this.data[k]; return r && r[task] ? r[task] : null; },
};

function saveShare(cur, patch, version){
  if (!isResearch(conv())) return;
  const share = Object.assign({id:cur.shareId, participant_id:pidOf(viewer()), conversation_id:Net.session.conversation_id,
    session_id:Net.session.session_id, condition:STATE.cond}, patch);
  Net.call("/api/share", {body:{share, version}}).catch(() => {});
}

/* ================= The widget (composer-attached) ================= */
const widget = (function(){
  const slot = $("#widget-slot");
  const trig = h("div",{class:"trig", hidden:true});
  const sheet = h("div",{class:"sheet", hidden:true, role:"dialog", "aria-label":"Share card draft"});
  slot.append(trig); $("#comp").append(sheet);
  let s = null, trigShownFor = null;

  function draftInfo(){
    const d = {text: input.value, attachment: UI.attachment};
    const link = findLink(d); if (!link) return null;
    const note = (d.text||"").replace(URL_RE, "").trim();
    let intentText = note, intentSource = null, kind = note ? "same_message" : "link_only";
    const last = UI.lastText[UI.conv + viewer()];
    if (!note && last && Date.now() - last.time < 60000){ intentText = last.text; intentSource = "From your message " + Math.round((Date.now()-last.time)/1000) + " s ago"; kind = "merged_previous"; }
    return {link, note:intentText, rawNote:note, intentSource, triggerKind:kind, content: adapt(link)};
  }
  function refresh(){
    if (s) { trig.hidden = true; return; }
    const info = draftInfo();
    if (info && Draft.id && !Draft.linkLogged){ Draft.linkLogged = true; T.log("share.link_detected", {url: info.content.sourceUrl, host: hostOf(info.content.sourceUrl), with_text: !!info.rawNote}); }
    if (!info || STATE.cond==="baseline"){ hideTrig(); return; }
    trig.hidden = false;
    if (trigShownFor !== Draft.id){ trigShownFor = Draft.id; T.log("share.trigger_shown", {kind:info.triggerKind}); }
    trig.replaceChildren(h("span",{class:"sp"},"✦"),
      h("span",{class:"g"}, info.intentSource ? "Share card · your last message will be used as the intent" : "Share card · you'll review it before it's sent"),
      h("button",{class:"link", type:"button", "data-track":"trigger-preview", onclick:() => open(info, "preview_link")}, "Preview"));
  }
  function hideTrig(){ if (!trig.hidden && trigShownFor) T.log("share.trigger_hidden"); trig.hidden = true; trigShownFor = null; }
  function clearDraft(){ input.value = ""; UI.attachment = null; autoGrow(); renderAttach(); syncSend(); draftReset(); }
  async function interceptSend(){
    const info = draftInfo(); if (!info) return false;
    snapshot();
    if (STATE.cond==="baseline"){
      const shareId = draftEnsure();
      const content = await plainContent(info.content);
      T.log("share.sent_plain", {condition:"baseline", url:info.content.sourceUrl});
      saveShare({shareId}, {trigger_kind:"baseline_send", message_text:info.rawNote, link_url:info.content.sourceUrl, outcome:"sent_plain", ...scenarioFields()});
      const entry = {kind:"plain", note:info.rawNote, content};
      clearDraft(); deliver(entry, {shareId}); Surveys.afterSend(entry, shareId, false);
      return true;
    }
    open(info, "send_button"); return true;
  }
  function scenarioFields(){
    const sc = Draft.scenario && input.value === Draft.scenarioText ? Draft.scenario : (Draft.scenario && Draft.scenarioLocked ? Draft.scenario : null);
    return sc ? {scenario_id:sc.id, expected_type:sc.exp} : {};
  }
  function close(reason){
    if (s){
      if (s.ctl) s.ctl.abort();
      T.log("share.preview_scroll", {max_ratio:Math.round((s.maxScroll||0)*100)/100}, {draft_id:s.shareId});
      T.log("share.closed", {reason: reason || "close"}, {draft_id:s.shareId});
      saveShare(s, {outcome:"closed"});
    }
    s = null; sheet.hidden = true; refresh();
  }
  async function open(info, via){
    if (s && s.ctl) s.ctl.abort();
    closePops();
    const shareId = draftEnsure();
    Draft.scenarioLocked = !!(Draft.scenario && input.value === Draft.scenarioText);
    s = Object.assign(info, {shareId, intent:null, extraction:null, phase:"intent", error:null, gapAsked:false, gapLogged:false, editing:false,
      regenerations:0, version:0, ctl:null, maxScroll:0, cached:false});
    trig.hidden = true; sheet.hidden = false;
    T.log("share.sheet_opened", {via, url:info.content.sourceUrl, merged_intent:!!info.intentSource});
    saveShare(s, {trigger_kind:info.triggerKind, message_text:info.note, link_url:info.content.sourceUrl, ...scenarioFields()});
    await run({});
  }
  async function run({override=null, clarification=null}){
    const cur = s; if (!cur) return;
    cur.ctl = new AbortController(); cur.error = null;
    try {
      if (override) cur.intent = Object.assign({}, cur.intent, override, {edited:true, searleClass:TYPES[override.primary].cls});
      else {
        cur.phase = "intent"; cur.extraction = null; render();
        const msg = clarification ? (cur.note ? cur.note + "\n" : "") + "[Sender's answer to a clarifying question: " + clarification + "]" : cur.note;
        const r = await aiCall("intent", {message:msg, content_ref:contentRef(cur)}, cur);
        if (s !== cur) return;
        cur.intent = r.intent;
        if (r.content && !r.content.pending) cur.content = r.content;
        if (clarification) cur.intent.clarified = clarification;
        T.log("share.intent_shown", {primary:cur.intent.primary, secondary:cur.intent.secondary, confidence:cur.intent.confidence,
          indirect:!!cur.intent.indirect, evidence:cur.intent.evidence.map(e => e.quote), content_kind:cur.content.kind, container_only:!!cur.content.containerOnly}, {draft_id:cur.shareId});
      }
      if (s !== cur) return;
      cur.phase = "extract"; render();
      const m = cur.intent.clarified ? (cur.note ? cur.note + " " : "") + "(" + cur.intent.clarified + ")" : cur.note;
      const r2 = await aiCall("extract", {message:m, intent:cur.intent, content_ref:contentRef(cur), previous_title:(cur.content.metadata||{}).previousTitle}, cur);
      if (s !== cur) return;
      cur.extraction = r2.extraction;
      cur.phase = "ready";
      T.log("share.card_ready", {version:cur.version, anchors:cur.extraction.anchors.length, fallback:!!cur.extraction.fallback,
        gap:!!cur.extraction.gapQuestion, container_only:!!cur.extraction.containerOnly}, {draft_id:cur.shareId});
      saveShare(cur, {}, {version:cur.version, intent:cur.intent, extraction:cur.extraction, edited_intent:!!cur.intent.edited, clarification:cur.intent.clarified || null});
      cur.version++;
    } catch(e){
      if (e && e.code==="cancelled") return; if (s !== cur) return;
      cur.error = e; cur.phase = cur.intent ? "ready-err" : "err";
    }
    render();
  }
  const contentRef = (cur) => cur.link.type==="attachment" ? cur.link.ref : cur.link.url;
  function sendCard(){
    if (!s || !s.intent || !s.extraction || s.phase=="intent" || s.phase=="extract") return;
    const card = composeCard(s); card.cached = s.cached || undefined;
    const cur = s;
    T.log("share.preview_scroll", {max_ratio:Math.round((cur.maxScroll||0)*100)/100}, {draft_id:cur.shareId});
    T.log("share.sent_card", {primary:card.intent.primary, secondary:card.intent.secondary, edited:!!card.intent.edited, regenerations:card.regenerations,
      anchors:card.extraction.anchors.length}, {draft_id:cur.shareId, card_id:card.id});
    saveShare(cur, {outcome:"sent_card", final_card_id:card.id});
    s = null; sheet.hidden = true;
    const entry = {kind:"card", card};
    clearDraft(); deliver(entry, {shareId:cur.shareId});
    Surveys.afterSend(entry, cur.shareId, true);
  }
  async function sendPlain(){
    if (!s) return;
    const cur = s;
    T.log("share.preview_scroll", {max_ratio:Math.round((cur.maxScroll||0)*100)/100}, {draft_id:cur.shareId});
    T.log("share.sent_plain", {condition:"ai", dismissed_card:true, had_card:!!cur.extraction}, {draft_id:cur.shareId});
    saveShare(cur, {outcome:"sent_plain"});
    s = null; sheet.hidden = true;
    const content = await plainContent(cur.content);
    const e = {kind:"plain", note:cur.rawNote || "", content};
    clearDraft(); deliver(e, {shareId:cur.shareId});
    Surveys.afterSend(e, cur.shareId, false);
  }
  function render(){
    if (!s){ sheet.hidden = true; return; }
    const body = h("div",{class:"sh-body"});
    body.addEventListener("scroll", () => { const r = (body.scrollTop + body.clientHeight) / Math.max(1, body.scrollHeight); if (s && r > s.maxScroll) s.maxScroll = r; }, {passive:true});
    const said = h("div",{class:"grp"}, h("div",{class:"h"},"Your message"));
    said.append(s.note ? h("div",{class:"said"}, markEvidence(s.note, s.intent && s.intent.evidence)) : h("div",{class:"said"}, h("span",{class:"empty"},"No message, just the link")));
    if (s.intentSource) said.append(h("div",{class:"state"}, s.intentSource + ", used as the intent"));
    body.append(said);
    if (s.phase==="intent") body.append(h("div",{class:"state"}, h("span",{class:"spin"}), "Reading your message…"));
    if (s.intent){
      const it = s.intent, t = TYPES[it.primary];
      const g = h("div",{class:"grp"}, h("div",{class:"h"},"How AI read it"));
      g.append(h("div",{class:"meta"},
        h("span",{class:"tc "+t.cls, title:t.src}, it.primary), it.secondary ? h("span",{class:"tc "+TYPES[it.secondary].cls}, it.secondary) : null,
        h("span",{class:"cls "+t.cls}, t.cls),
        h("span",{class:"conf c"+({high:3,medium:2,low:1}[it.confidence]), title:"Confidence"}, h("i"),h("i"),h("i"), " " + it.confidence),
        it.indirect ? h("span",{class:"tag"},"indirect") : null, it.edited ? h("span",{class:"tag"},"edited by you") : null));
      if (it.evidence.length) g.append(h("div",{class:"cues"}, it.evidence.map(e => h("span",{class:"cue", tabindex:"0", "data-track":"evidence-cue",
        onmouseenter:() => logHover(e), onfocus:() => logHover(e)}, "“"+e.quote+"”", h("span",null," → "+e.cue)))));
      if (it.intentLine) g.append(h("div",{class:"restate"}, it.intentLine));
      if (!s.editing) g.append(h("div",null, h("button",{class:"link", type:"button", style:"padding:0", "data-track":"change-intent", onclick:() => {
        s.editing = true; T.log("share.intent_edit_start", {primary:it.primary}, {draft_id:s.shareId}); render(); }}, "Not right? Change the intent")));
      else {
        const sel = h("select",{class:"inp", id:"ed-type", "data-track":"edit-type"}, TYPE_ORDER.map(c => h("option",{value:c, selected:c===it.primary}, c + " — " + TYPES[c].label)));
        const line = h("input",{class:"inp", id:"ed-line", value:it.intentLine||"", placeholder:"What should " + otherRole(viewer()) + " get from this?", "data-track":"edit-line"});
        g.append(h("div",{class:"edit"},
          h("div",null, h("label",{for:"ed-type"},"Type"), sel),
          h("div",null, h("label",{for:"ed-line"},"In your words, what " + otherRole(viewer()) + " should get"), line),
          h("div",{class:"meta"},
            h("button",{class:"btn", type:"button", "data-track":"regenerate", disabled: !s.extraction && s.phase!=="ready-err", onclick:() => {
              s.regenerations++; s.editing = false;
              T.log("share.regenerate", {n:s.regenerations, from:it.primary, to:sel.value}, {draft_id:s.shareId});
              if (sel.value !== it.primary) T.log("share.type_changed", {from:it.primary, to:sel.value}, {draft_id:s.shareId});
              if (line.value !== (it.intentLine||"")) T.log("share.intent_edited", {before:it.intentLine||"", after:line.value}, {draft_id:s.shareId});
              run({override:{primary:sel.value, secondary: sel.value===it.primary ? it.secondary : null, intentLine:line.value}});
            }}, "Regenerate card"),
            h("button",{class:"link", type:"button", "data-track":"edit-cancel", onclick:() => { s.editing = false; T.log("share.intent_edit_cancel", null, {draft_id:s.shareId}); render(); }}, "Cancel"))));
      }
      body.append(g);
    }
    if (s.phase==="extract") body.append(h("div",{class:"state"}, h("span",{class:"spin"}), "Finding the parts that match your intent…"));
    if (s.error) body.append(h("div",{class:"state err", role:"alert"}, errCopy(s.error)),
      h("div",null, h("button",{class:"link", type:"button", style:"padding:0", "data-track":"ai-retry", onclick:() => { T.log("share.retry", {code:s.error && s.error.code}, {draft_id:s.shareId}); run({}); }}, "Try again")));
    const gq = s.extraction && s.extraction.gapQuestion;
    if (gq && !s.gapAsked){
      if (!s.gapLogged){ s.gapLogged = true; T.log("share.gap_shown", {question:gq.question, options:gq.options}, {draft_id:s.shareId}); }
      const own = h("input",{class:"inp", id:"gap-own", placeholder:"Or write your own", "data-track":"gap-own"});
      const answer = (v, src) => { if (!v.trim()) return; s.gapAsked = true; T.log("share.gap_answered", {answer:v, source:src}, {draft_id:s.shareId}); run({clarification:v}); };
      body.append(h("div",{class:"gap"}, h("div",{class:"q"}, gq.question),
        h("div",{class:"opts"}, gq.options.map(o => h("button",{class:"opt", type:"button", "data-track":"gap-option", onclick:() => answer(o, "option")}, o))),
        h("div",{class:"own"}, h("label",{for:"gap-own", class:"state", style:"white-space:nowrap"},"Your answer"), own, h("button",{class:"btn", type:"button", "data-track":"gap-use", onclick:() => answer(own.value, "own")}, "Use"))));
    }
    if (s.extraction){
      const card = composeCard(s, "preview"); card.status = "preview"; card.cached = s.cached || undefined;
      const other = otherRole(viewer());
      body.append(h("div",{class:"grp"}, h("div",{class:"h"}, "What " + nameOf(other) + " will see"),
        h("div",{class:"preview"}, itemRows({kind:"card", card, from:viewer()}, false, false))));
    }
    sheet.replaceChildren(
      h("div",{class:"sh-head"}, h("b",null,"Share card"), h("span",null,"Only you see this"), s.cached ? h("span",{class:"cached"},"cached") : null,
        h("button",{class:"ico", type:"button", "aria-label":"Close", "data-track":"sheet-close", onclick:() => close("close_button")}, "×")),
      body,
      h("div",{class:"sh-foot"},
        h("button",{class:"btn", type:"button", "data-track":"send-plain", onclick:sendPlain}, "Send as plain link"),
        h("button",{class:"btn pri", type:"button", "data-track":"send-card", disabled:!s.extraction || s.phase==="intent" || s.phase==="extract", onclick:sendCard}, "Send card")));
    // Keep the reader's scroll position anchored at the bottom when content grows (same as before).
  }
  const hovered = new Set();
  function logHover(e){ const k = s.shareId + e.quote; if (hovered.has(k)) return; hovered.add(k); T.log("share.evidence_hover", {quote:e.quote, cue:e.cue}, {draft_id:s.shareId}); }
  return {refresh, interceptSend, close, isOpen:() => !!s};
})();

/* Baseline / "Send as plain link": a normal link preview (real Open Graph data for real links). */
async function plainContent(c){
  const base = {title:c.title, sourceUrl:c.sourceUrl, site:hostOf(c.sourceUrl), image:null, isMock:!!c.isMock};
  if (!c.sourceUrl || !c.sourceUrl.startsWith("http") || C[c.sourceUrl]) return base;
  try { const p = await Net.call("/api/unfurl", {body:{url:c.sourceUrl}, timeout:7000}); return Object.assign(base, {title:p.title, site:p.site, image:p.image}); }
  catch { return base; }
}

/* ================= Study questions (brief §10: m1a, m1b, m2, post-hoc rating) ================= */
const Surveys = {
  queue: [], answeredM2: new Set(),
  on(){ return UI.surveys && isResearch(conv()); },
  afterSend(entry, shareId, isCard){
    if (!this.on()) return;
    this.push({kind:"sender", shareId, cardId: entry.card ? entry.card.id : null, isCard, viewer:viewer()});
  },
  push(item){ this.queue = this.queue.filter(q => !(q.kind===item.kind && q.shareId===item.shareId)); this.queue.push(item); this.render(); },
  save(item, key, value, skipped){
    const body = {id:Net.uuid(), participant_id:pidOf(item.viewer), share_id:item.shareId, card_id:item.cardId || null, item:key,
      value: skipped ? null : value, skipped:!!skipped, shown_at:item.shownAt};
    Net.call("/api/survey", {body}).catch(() => {});
    T.log(skipped ? "survey.skipped" : "survey.answered", {item:key, value: skipped ? null : value, ms_since_shown: item.shownPerf ? Math.round(performance.now() - item.shownPerf) : null},
      {participant_id:pidOf(item.viewer), draft_id:item.shareId, card_id:item.cardId || null});
  },
  done(item){ this.queue = this.queue.filter(q => q !== item); this.render(); },
  render(){
    const slot = $("#survey-slot");
    const item = this.queue.find(q => q.viewer === viewer());
    if (!item || !this.on()){ slot.replaceChildren(); return; }
    if (!item.shownAt){ item.shownAt = new Date().toISOString(); item.shownPerf = performance.now();
      T.log("survey.shown", {item:item.kind}, {participant_id:pidOf(item.viewer), draft_id:item.shareId, card_id:item.cardId || null}); }
    const other = nameOf(otherRole(item.viewer));
    const box = h("div",{class:"survey", role:"group", "aria-label":"Study question"});
    if (item.kind==="sender"){
      const txt = h("input",{class:"inp", placeholder:"Optional", "aria-label":"What do you want them to get from this?", "data-track":"survey-m1a"});
      let rating = null;
      const scale = h("div",{class:"scale"}, [1,2,3,4,5].map(n => h("button",{class:"opt", type:"button", "data-track":"survey-m1b", "aria-label":"Rating " + n, onclick:(ev) => {
        rating = n; for (const b of scale.children) b.classList.toggle("on", b === ev.currentTarget); }}, String(n))));
      box.append(h("div",{class:"q"}, "In a few words, what do you want " + other + " to get from this?"), txt);
      if (item.isCard) box.append(h("div",{class:"q"}, "How well does the card say what you wanted?"), h("div",{class:"rowq"}, h("span",{class:"hint"},"Not at all"), scale, h("span",{class:"hint"},"Exactly")));
      box.append(h("div",{class:"rowq"},
        h("button",{class:"btn pri", type:"button", "data-track":"survey-submit", onclick:() => {
          this.save(item, "m1a", txt.value.trim(), !txt.value.trim()); if (item.isCard) this.save(item, "m1b", rating, rating==null); this.done(item); }}, "Done"),
        h("button",{class:"link", type:"button", "data-track":"survey-skip", onclick:() => { this.save(item, "m1a", null, true); if (item.isCard) this.save(item, "m1b", null, true); this.done(item); }}, "Skip")));
    } else if (item.kind==="receiver"){
      const txt = h("input",{class:"inp", placeholder:"Optional", "aria-label":"What do you think they wanted you to get?", "data-track":"survey-m2"});
      box.append(h("div",{class:"q"}, "Before you reply: in a few words, what do you think " + other + " wanted you to get from this?"), txt,
        h("div",{class:"rowq"},
          h("button",{class:"btn pri", type:"button", "data-track":"survey-submit", onclick:() => { this.save(item, "m2", txt.value.trim(), !txt.value.trim()); this.answeredM2.add(item.shareId); this.done(item); }}, "Done"),
          h("button",{class:"link", type:"button", "data-track":"survey-skip", onclick:() => { this.save(item, "m2", null, true); this.answeredM2.add(item.shareId); this.done(item); }}, "Skip")));
    } else if (item.kind==="post"){
      const scale = h("div",{class:"scale"}, [1,2,3,4,5].map(n => h("button",{class:"opt", type:"button", "data-track":"survey-post", onclick:() => { this.save(item, "post_rating", n, false); this.done(item); }}, String(n))));
      box.append(h("div",{class:"hint"}, "Earlier you shared: “" + (item.message || item.link || "a link") + "”"),
        h("div",{class:"hint"}, other + " thought you wanted them to get: “" + item.m2 + "”"),
        h("div",{class:"q"}, "My partner understood what I meant."),
        h("div",{class:"rowq"}, h("span",{class:"hint"},"Strongly disagree"), scale, h("span",{class:"hint"},"Strongly agree")),
        h("div",{class:"rowq"}, h("button",{class:"link", type:"button", "data-track":"survey-skip", onclick:() => { this.save(item, "post_rating", null, true); this.done(item); }}, "Skip")));
    }
    slot.replaceChildren(box);
  },
};
/* m2 appears once the receiver has actually seen a shared item and before they reply. */
function onPartnerItemSeen(mid){
  const c = CONVS.R; if (!c) return;
  const m = c.thread.find(x => x.id === mid); if (!m || !m.shareId || Surveys.answeredM2.has(m.shareId)) return;
  const v = viewer(); if (m.from === v) return;
  const replied = c.thread.some(x => x.from === v && x.time > m.time);
  if (!replied) Surveys.push({kind:"receiver", shareId:m.shareId, cardId: m.card ? m.card.id : null, viewer:v});
}

/* ================= Send ================= */
async function sendNow(){
  if (UI.locked) return;
  if (await widget.interceptSend()) return;
  const t = input.value.trim(); if (!t) return;
  snapshot();
  input.value = ""; autoGrow(); syncSend();
  deliver({kind:"text", text:t});
  UI.lastText[UI.conv + viewer()] = {text:t, time:Date.now()};
  draftReset();
}
input.addEventListener("focus", () => { if (!input.value) draftEnsure(); T.log("compose.focus"); });
input.addEventListener("beforeinput", (e) => {
  draftEnsure();
  if (/^delete/.test(e.inputType)) Draft.deletes++; else if (/^insert(Text|CompositionText|LineBreak)?$/.test(e.inputType) || e.inputType === "insertReplacementText") Draft.keys++;
});
input.addEventListener("input", () => {
  if (input.value) draftEnsure();
  clearTimeout(Draft.timer); Draft.timer = setTimeout(snapshot, 500);
  autoGrow(); syncSend(); widget.refresh();
});
input.addEventListener("paste", (e) => {
  draftEnsure();
  const txt = (e.clipboardData && e.clipboardData.getData("text")) || "";
  const m = txt.match(URL_RE);
  T.log("compose.paste", {length:txt.length, has_url:!!m, url: m ? m[0] : null});
});
input.addEventListener("keydown", (e) => { if (e.key==="Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); sendNow(); } });
$("#send").addEventListener("click", sendNow);
$("#search").addEventListener("input", renderSide);

/* ================= Popovers: + menu and study settings ================= */
const plusmenu = $("#plusmenu"), studymenu = $("#studymenu");
function closePops(){ plusmenu.hidden = true; studymenu.hidden = true; $("#plusbtn").setAttribute("aria-expanded","false"); $("#studybtn").setAttribute("aria-expanded","false"); }
function fillScenario(sc){
  UI.attachment = sc.photo ? {ref:sc.photo, label:"Photo · matcha latte"} : null;
  input.value = sc.photo ? sc.msg : (sc.msg ? sc.msg + " " : "") + sc.url;
  draftEnsure(); Draft.scenario = sc; Draft.scenarioText = input.value; Draft.linkLogged = false;
  T.log("compose.sample_loaded", {scenario:sc.id, expected:sc.exp});
  closePops(); autoGrow(); renderAttach(); syncSend(); widget.refresh(); input.focus();
}
function buildPlusMenu(){
  const items = [
    h("button",{class:"it", type:"button", "data-track":"plus-photo", onclick:() => { draftEnsure(); UI.attachment = {ref:"photo:la-prima-matcha", label:"Photo · matcha latte"}; T.log("compose.attach", {ref:"photo:la-prima-matcha"}); closePops(); renderAttach(); syncSend(); widget.refresh(); input.focus(); }},
      h("span",{class:"m"},"Photo"), h("span",{class:"s"},"Sample · matcha latte at La Prima"))];
  if (!UI.study) items.push(h("hr"), h("div",{class:"ph"},"Sample shares"),
    h("div",{class:"pn"},"Fills the field with a message and a link. The type shown is what each sample was written for; the AI doesn't see it."),
    ...SCENARIOS.map(sc => h("button",{class:"it", type:"button", "data-track":"plus-sample", onclick:() => fillScenario(sc)},
      h("span",{class:"m"}, sc.msg || "(no message, just a link)"),
      h("span",{class:"s"}, h("span",{class:"mono"}, sc.id), h("span",{class:"tc "+TYPES[sc.exp].cls}, sc.exp), sc.note ? sc.note : null, sc.photo ? "photo" : hostOf(sc.url)))));
  plusmenu.replaceChildren(...items);
}
$("#plusbtn").addEventListener("click", (e) => { e.stopPropagation(); const was = plusmenu.hidden; closePops(); plusmenu.hidden = !was; $("#plusbtn").setAttribute("aria-expanded", String(was));
  if (was){ draftEnsure(); T.log("compose.plus_open"); } });
$("#studybtn").addEventListener("click", (e) => { e.stopPropagation(); const was = studymenu.hidden; closePops(); studymenu.hidden = !was; $("#studybtn").setAttribute("aria-expanded", String(was)); });
for (const p of [plusmenu, studymenu]) p.addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", closePops);
document.addEventListener("keydown", (e) => { if (e.key==="Escape"){ closePops(); if (widget.isOpen()) widget.close("escape"); } });
for (const r of document.querySelectorAll('input[name="cond"]')) r.addEventListener("change", () => { STATE.cond = r.value; widget.close("condition_change"); T.log("study.condition_changed", {value:STATE.cond, by:"menu"}); });
for (const r of document.querySelectorAll('input[name="tier"]')) r.addEventListener("change", () => { STATE.tier = r.value; T.log("study.tier_changed", {value:r.value}); });
$("#opt-surveys").addEventListener("change", (e) => { UI.surveys = e.target.checked; Surveys.render(); });
for (const b of document.querySelectorAll("#viewseg button")) b.addEventListener("click", () => {
  snapshot(); UI.viewer = b.dataset.v; widget.close("viewer_switch"); clearInputs(); T.log("demo.viewer", {viewer:UI.viewer}); renderAll(); });
function clearInputs(){ input.value = ""; UI.attachment = null; autoGrow(); draftReset(); }

/* ---------- QR: open B's screen on a phone (CHI booth, plan §11.4) ---------- */
$("#qrbtn").addEventListener("click", () => {
  const code = PARTNER().code;
  const url = location.origin + (Net.mode === "booth" ? "/booth" : "/demo") + "?code=" + code;
  const box = h("div",{class:"qrbox"});
  if (window.qrcode){ const q = qrcode(0, "M"); q.addData(url); q.make(); box.append(h("img",{src:q.createDataURL(6, 2), alt:"QR code to open B's screen"})); }
  box.append(h("code",null, code), h("span",{class:"pn"}, url));
  studymenu.replaceChildren(h("div",{class:"ph"},"Scan to open " + nameOf(otherRole(ME().role)) + "'s screen"), box);
  T.log("demo.qr_shown");
  Sync.start(2000);
});

/* ================= Sync (two devices) ================= */
function entryFromServer(m){
  const e = {id:m.id, from:m.sender_role, kind:m.kind, time:new Date(m.server_ts), persisted:true, shareId:m.share_id, excluded:m.excluded, serverTs:m.server_ts};
  if (m.kind==="text") e.text = m.text;
  if (m.kind==="card"){ e.card = m.card; }
  if (m.kind==="plain"){ e.note = m.text || ""; e.content = m.plain_preview || {title:hostOf(m.link_url || ""), sourceUrl:m.link_url || ""}; }
  return e;
}
Sync.onMessages = (msgs) => {
  const c = CONVS.R; let changed = false;
  for (const m of msgs){
    const have = c.thread.find(x => x.id === m.id);
    if (have){ if (!have.persisted){ have.persisted = true; changed = true; } continue; }
    const e = entryFromServer(m);
    if (e.kind==="card" && e.card.action && e.card.action.type==="pin") c.pinned = e.card.content.title;
    c.thread.push(e); changed = true;
    if (e.from !== viewer()) T.log("msg.received", {kind:e.kind}, {message_id:e.id, card_id:e.card ? e.card.id : null});
  }
  if (changed){ c.thread.sort((a,b) => a.time - b.time); renderAll(); }
};
Sync.onMeta = (r) => {
  const c = CONVS.R;
  for (const id of r.replaced || []){ const m = c.thread.find(x => x.card && x.card.id === id); if (m && !m.card.replaced){ m.card.replaced = true; renderThread(); } }
  if (UI.single && r.condition && r.condition !== STATE.cond){ STATE.cond = r.condition; T.log("study.condition_changed", {value:r.condition, by:"schedule"}); widget.refresh(); }
  if (r.locked !== UI.locked) setLocked(!!r.locked);
};

/* ================= Boot ================= */
function seedDemo(){
  const t0 = new Date(); t0.setHours(t0.getHours()-2);
  const at = (min) => new Date(t0.getTime() + min*60000);
  const v1 = C["https://docs.example.com/offsite-agenda-v1"];
  CONVS.R.thread.push({from:"B", kind:"text", text:"周六 offsite 几点开始？", time:at(0)});
  CONVS.R.thread.push({from:"A", kind:"card", time:at(2), card:{id:"card-seed", senderNote:"安排在这里", intent:{primary:"DELIVER·information", secondary:null, confidence:"high", evidence:[]}, content:slimContent(v1),
    extraction:{anchors:[{kind:"text_span", unitIds:["p1"], label:"9:00 在 lounge 开始", why:"Start time and place", firstText:v1.units[0].text}], summary:"开始时间和地点在第一段。", fallback:false, gapQuestion:null, replyOptions:[], discussPrompt:null},
    action:{type:"save", isMock:true, payload:{}, state:null}, status:"sent", regenerations:0, replaced:false, sample:true}});
  CONVS.R.thread.push({from:"B", kind:"text", text:"收到 👍", time:at(3)});
  CONVS.G = {key:"G", name:"Study group", sub:"A, C, X", av:"G", thread:[], pinned:null};
  CONVS.C = {key:"C", name:"C", sub:"", av:"C", thread:[], pinned:null};
  CONVS.G.thread.push({from:"X", kind:"text", text:"周三 demo 之前大家把 slides 发群里", time:at(-60)});
  CONVS.G.thread.push({from:"A", kind:"text", text:"好的", time:at(-58)});
  CONVS.C.thread.push({from:"C", kind:"text", text:"明天图书馆见？", time:at(-200)});
}

const Gate = {
  el: $("#gate"),
  show(title, ...kids){ $("#gate-title").textContent = title; $("#gate-body").replaceChildren(...kids); this.el.hidden = false; },
  hide(){ this.el.hidden = true; },
  askCode(err){
    return new Promise((resolve) => {
      const inp = h("input",{class:"inp codein", maxlength:"6", autocomplete:"one-time-code", autocapitalize:"characters", "aria-label":"Study code", spellcheck:"false"});
      const msg = h("div",{class:"err", role:"alert"}, err || "");
      const go = () => { const v = inp.value.trim().toUpperCase(); if (/^[A-Z0-9]{6}$/.test(v)) resolve(v); else msg.textContent = "Codes have 6 letters or numbers."; };
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      this.show("Welcome to the research chat",
        h("p",null,"Enter the 6-character code you got from the research team."), inp, msg,
        h("button",{class:"btn pri", type:"button", onclick:go}, "Continue"),
        Net.mode === "auto" ? h("p",null, "Just looking? ", h("a",{href:"/demo"},"Try the demo")) : null,
        h("p",null,"Please don't share anything personal or private in this chat."));
      setTimeout(() => inp.focus(), 50);
    });
  },
};

async function boot(){
  Gate.show("Loading…");
  try { loadShared(await Net.bootstrap()); }
  catch { Gate.show("Can't reach the server", h("p",null,"Check your connection and reload the page.")); return; }
  const qcode = (Net.params.get("code") || "").toUpperCase();
  let mode = Net.mode, code = null;
  if (mode === "auto" || mode === "study"){ mode = "study"; code = qcode || Net.store.get("is_code"); }
  else if (qcode) code = qcode; // a phone joining a demo/booth pair
  for (let tries = 0; ; tries++){
    if (mode === "study" && !code) code = await Gate.askCode();
    try {
      Gate.show("Loading…");
      await Net.startSession({code, mode});
      break;
    } catch (e) {
      if (mode !== "study" || tries > 20){ Gate.show("Something went wrong", h("p",null, e.code === "db_unavailable" ? "The study server isn't reachable right now. Try again later." : "Reload the page to try again.")); return; }
      Net.store.del("is_code");
      code = await Gate.askCode(e.code === "unknown_code" ? "That code wasn't found. Check it and try again." : e.code === "withdrawn" ? "This code is no longer active." : "Couldn't sign in. Try again.");
    }
  }
  const S = Net.session;
  if (mode === "study") Net.store.set("is_code", code);
  UI.single = !!code;                               // own role only (study, or a phone joined by code)
  UI.study = ["study","pilot"].includes(S.participant.data_origin);
  UI.surveys = UI.study;
  STATE.cond = S.condition || "ai";
  STATE.tier = UI.study || mode === "presentation" ? "default" : "quick";
  for (const r of document.querySelectorAll('input[name="tier"]')) r.checked = r.value === STATE.tier;
  for (const r of document.querySelectorAll('input[name="cond"]')) r.checked = r.value === STATE.cond;
  T.enabled = mode !== "booth" && S.participant.data_origin !== "booth";
  T.onCount = (n) => { const el = $("#evcount"); if (el) el.textContent = n + " events logged this session"; };
  $("#mode-note").textContent = T.enabled ? "AI: " + (Net.boot.config.ai === "live" ? "live (Claude API)" : "mock (no API key)") : "Booth mode: nothing is recorded";
  if (mode === "presentation") document.body.classList.add("presentation");
  const live = Net.boot.config.ai === "live";
  $("#ai-dot").className = "dot " + (live ? "on" : "");
  $("#ai-text").textContent = live ? "Live AI: on" : "AI: mock (no API key yet)";
  $("#row-surveys").hidden = UI.study; $("#opt-surveys").checked = UI.surveys;
  $("#row-qr").hidden = UI.single || !window.qrcode;
  if (UI.single) $("#studybtn").hidden = true;

  CONVS = {R:{key:"R", name:"", sub:"Research chat", av:"R", demo:!UI.single, thread:[], pinned:null}};
  if (!UI.single) seedDemo();
  UI.conv = "R"; UI.viewer = "A";
  if (mode === "booth") await Replay.load();
  buildPlusMenu();
  T.log("app.session_start", {mode, ai:Net.boot.config.ai, prompt_version:Net.boot.config.promptVersion, ua_mobile:/Mobi/.test(navigator.userAgent),
    viewport: innerWidth + "x" + innerHeight, dpr: devicePixelRatio, lang: navigator.language});
  Gate.hide();
  renderAll();
  if (UI.single){
    Sync.start(2000);
    if (UI.study){
      try { const pend = await Net.call("/api/survey", {method:"GET"}); for (const p of pend) Surveys.push({kind:"post", shareId:p.share_id, viewer:ME().role, message:p.message_text, link:p.link_url, m2:p.m2}); } catch {}
    }
  }
}
boot();
