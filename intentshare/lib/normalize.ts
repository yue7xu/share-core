// Business-rule validation of model output (ported from the artifact). Structured outputs already
// guarantee the JSON shape; these rules check meaning: evidence must quote the message, unit ids must exist.
import { TYPES, type ContentObject } from './data';

export type Intent = {
  primary: string; secondary: string | null; searleClass: string;
  evidence: { quote: string; cue: string }[]; indirect: boolean; intentLine: string;
  slots: { what?: string | null; when?: string | null; who?: string | null };
  confidence: 'high' | 'medium' | 'low'; missingSlots: string[]; isShare: boolean;
  edited?: boolean; clarified?: string;
};

export function normIntent(r: any, message: string): Intent {
  const out = Object.assign({ primary: 'OTHER', secondary: null, evidence: [], indirect: false, intentLine: '', slots: {},
    confidence: 'low', missingSlots: [], isShare: true }, r || {});
  if (!TYPES[out.primary]) out.primary = 'OTHER';
  if (out.secondary && (!TYPES[out.secondary] || out.secondary === out.primary)) out.secondary = null;
  out.searleClass = TYPES[out.primary].cls;
  out.evidence = (Array.isArray(out.evidence) ? out.evidence : [])
    .filter((e: any) => e && e.quote && message.includes(String(e.quote))).slice(0, 3);
  if (!['high', 'medium', 'low'].includes(out.confidence)) out.confidence = 'low';
  out.slots = out.slots || {};
  out.missingSlots = Array.isArray(out.missingSlots) ? out.missingSlots : [];
  return out as Intent;
}

export type Anchor = { kind: string; unitIds: string[]; start?: number; end?: number; label: string; why: string; firstText: string };
export type Extraction = {
  anchors: Anchor[]; summary: string; fallback: boolean;
  gapQuestion: { question: string; options: string[] } | null;
  replyOptions: string[]; discussPrompt: string | null; containerOnly?: boolean;
};

export function anchorKind(kind: string) {
  return kind === 'video' || kind === 'podcast' ? 'time_range'
    : kind === 'article' || kind === 'thread' ? 'text_span' : kind === 'image' ? 'image_region' : 'item';
}

export function normExtraction(r: any, content: ContentObject): Extraction {
  const out = Object.assign({ anchors: [], summary: '', fallback: false, gapQuestion: null, replyOptions: [], discussPrompt: null }, r || {});
  const idx = Object.fromEntries(content.units.map((u, i) => [u.unitId, i]));
  out.anchors = (Array.isArray(out.anchors) ? out.anchors : []).map((a: any) => {
    const ids = (a.unitIds || []).map(String).filter((id: string) => id in idx).sort((x: string, y: string) => idx[x] - idx[y]);
    if (!ids.length) return null;
    const us = ids.map((id: string) => content.units[idx[id]]);
    const an: Anchor = { kind: anchorKind(content.kind), unitIds: ids, label: String(a.label || us[0].text.slice(0, 30)), why: String(a.why || ''), firstText: us[0].text };
    if (an.kind === 'time_range') { an.start = Math.min(...us.map((u: any) => u.start)); an.end = Math.max(...us.map((u: any) => u.end)); }
    return an;
  }).filter(Boolean).slice(0, 3);
  if (out.gapQuestion && !(out.gapQuestion.question && Array.isArray(out.gapQuestion.options))) out.gapQuestion = null;
  if (out.gapQuestion) out.gapQuestion.options = out.gapQuestion.options.slice(0, 3).map(String);
  out.replyOptions = (Array.isArray(out.replyOptions) ? out.replyOptions : []).slice(0, 3).map(String);
  out.summary = String(out.summary || '');
  if (out.discussPrompt === '') out.discussPrompt = null;
  return out as Extraction;
}
