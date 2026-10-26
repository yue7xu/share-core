"use strict";
/* Shared helpers and the card composer, unchanged from the IntentShare Messages artifact.
   The taxonomy and sample content now come from the server (/api/bootstrap) so client and prompts
   never drift apart. */
let TYPES = {}, TYPE_ORDER = [], C = {}, SCENARIOS = [], SLOTS = [];
function loadShared(b) { TYPES = b.types; TYPE_ORDER = b.order; C = b.content; SCENARIOS = b.scenarios; SLOTS = b.slots; }

/* ================= Helpers ================= */
function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs||{})){
    if (v==null || v===false) continue;
    if (k==="class") el.className = v;
    else if (k==="text") el.textContent = v;
    else if (k.startsWith("on") && typeof v==="function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v===true ? "" : v);
  }
  for (const kid of kids.flat()){ if (kid==null||kid===false) continue; el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return el;
}
const $ = (s) => document.querySelector(s);
const fmt = (s) => { s = Math.max(0, Math.round(s||0)); return Math.floor(s/60) + ":" + String(s%60).padStart(2,"0"); };
const hostOf = (u) => { try { return new URL(u).host; } catch { return String(u).startsWith("photo:") ? "photo" : u; } };
const URL_RE = /https?:\/\/[^\s，。！？、]+/;
function getT(url){ try { const v = new URL(url).searchParams.get("t"); return v ? parseInt(v,10) : null; } catch { return null; } }
function withT(url, sec){ try { const u = new URL(url); u.searchParams.set("t", Math.round(sec)+"s"); return u.toString(); } catch { return url; } }
function textFrag(url, text){ const words = String(text).split(/\s+/).slice(0,6).join(" "); return url.split("#")[0] + "#:~:text=" + encodeURIComponent(words); }

/* ================= Content adapter (client side) ================= */
/* Sample content is known locally; any other link is resolved by the server (/api/content). */
function adapt(link){
  if (!link) return null;
  const key = link.type==="attachment" ? link.ref : link.url;
  if (C[key]) return C[key];
  return {id:"pending", kind: /youtu\.?be/.test(key) ? "video" : "article", sourceUrl:link.url, title:hostOf(link.url), units:[], metadata:{}, isMock:false, pending:true};
}

/* ================= Card composer ================= */
function freeBoth(content){
  if (content.metadata && content.metadata.showtimes) return content.metadata.showtimes.filter(s => s.a && s.b).map(s => s.label).slice(0,3);
  return SLOTS.filter(s => s.a && s.b).map(s => s.label).slice(0,3);
}
function buildAction(intent, extraction, content){
  const type = TYPES[intent.primary].action;
  const p = {}, md = content.metadata || {};
  if (type==="time_options") p.options = freeBoth(content);
  if (type==="reply_options") p.options = ["I'll try","Not now"];
  if (type==="quick_replies") p.options = extraction.replyOptions.length ? extraction.replyOptions : ["Sounds good","Let's talk","Not sure"];
  if (type==="add_to_calendar") p.label = (intent.slots && intent.slots.when ? intent.slots.when + " · " : "Sat Oct 31 · ") + (md.duration || "1 h");
  if (type==="set_reminder") p.label = md.remind || "Tomorrow · 9:00 am";
  if (type==="discuss_prompt") p.text = extraction.discussPrompt || "";
  if (type==="replace_previous") p.previousTitle = md.previousTitle || null;
  if (intent.secondary==="DELIVER·opinion" || intent.secondary==="PROPOSE·activity"){ if (extraction.discussPrompt) p.text = extraction.discussPrompt; }
  return {type, isMock:true, payload:p, state:null};
}
/* The stored card carries only what the receiver needs (not the full transcript). */
function slimContent(c){ return {kind:c.kind, title:c.title, sourceUrl:c.sourceUrl, durationSec:c.durationSec || null, isMock:!!c.isMock}; }
function composeCard(s, id){
  return {
    id: id || Net.uuid(), senderNote: s.note, noteSource: s.intentSource,
    intent: s.intent, content: slimContent(s.content), extraction: s.extraction,
    action: buildAction(s.intent, s.extraction, s.content),
    status:"sent", regenerations: s.regenerations, replaced:false
  };
}
function coreText(card){
  const c = card.content;
  if (c.kind==="video" && c.durationSec){
    const core = card.extraction.anchors.filter(a => a.kind==="time_range").reduce((s,a) => s + (a.end - a.start), 0);
    return core ? `core ${fmt(core)} · full ${fmt(c.durationSec)}` : `full ${fmt(c.durationSec)}`;
  }
  return c.kind==="image" ? "photo" : c.kind;
}
function findLink(d){
  if (d.attachment) return {type:"attachment", ref:d.attachment.ref};
  const m = (d.text||"").match(URL_RE);
  return m ? {type:"url", url:m[0]} : null;
}
function markEvidence(text, evidence){
  const ranges = [];
  for (const e of evidence||[]){ const i = text.indexOf(e.quote); if (i>=0) ranges.push([i, i+e.quote.length, e]); }
  ranges.sort((a,b) => a[0]-b[0]);
  const out = []; let pos = 0;
  for (const [s,e] of ranges){ if (s < pos) continue; out.push(text.slice(pos,s), h("mark",null, text.slice(s,e))); pos = e; }
  out.push(text.slice(pos));
  return out;
}
const ERR = {
  offline:"You seem to be offline. You can still send the plain link.",
  timeout:"The AI took too long. Try again, or send the plain link.",
  rate_limited:"Too many AI requests right now. Wait a moment, then try again.",
  overloaded:"The AI service is busy. Try again in a moment, or send the plain link.",
  refused:"The AI declined this message. Try rewording it.",
  truncated:"The AI reply was cut off. Try again.",
  auth:"The AI service isn't set up yet. You can still send the plain link.",
  unauthorized:"Your session expired. Reload the page.",
  db_unavailable:"The study server isn't reachable. You can still send the plain link.",
};
const errCopy = (e) => ERR[e && e.code] || "The AI request failed. Try again, or send the plain link.";
