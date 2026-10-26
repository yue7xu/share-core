import { describe, it, expect } from 'vitest';
import { normIntent, normExtraction } from '../../lib/normalize';
import { INTENT_SCHEMA, EXTRACT_SCHEMA, intentUser, extractUser, INTENT_SYSTEM, PROMPT_VERSION } from '../../lib/prompts';
import { mockIntent, mockExtract } from '../../lib/mock-ai';
import { FIXTURES, SCENARIOS, TYPE_ORDER } from '../../lib/data';

// Structured outputs reject these keywords (platform docs: schema limitations).
const BANNED = ['minLength', 'maxLength', 'minimum', 'maximum', 'multipleOf', 'maxItems', 'pattern'];
function walk(o: any, fn: (o: any) => void) { if (o && typeof o === 'object') { fn(o); for (const v of Object.values(o)) walk(v, fn); } }

describe('output schemas are valid for structured outputs', () => {
  for (const [name, schema] of [['intent', INTENT_SCHEMA], ['extract', EXTRACT_SCHEMA]] as const) {
    it(name, () => {
      walk(schema, (o) => {
        for (const k of BANNED) expect(o[k], `${name} uses ${k}`).toBeUndefined();
        if (o.type === 'object') { expect(o.additionalProperties).toBe(false); expect(o.required.sort()).toEqual(Object.keys(o.properties).sort()); }
      });
    });
  }
  it('lists all 15 intent types', () => expect((INTENT_SCHEMA.properties.primary as any).enum).toEqual(TYPE_ORDER));
  it('has a stable prompt version', () => expect(PROMPT_VERSION).toMatch(/^[0-9a-f]{8}$/));
});

describe('normIntent', () => {
  it('drops evidence that is not a quote from the message', () => {
    const r = normIntent({ primary: 'PROPOSE·activity', evidence: [{ quote: '我们去', cue: 'x' }, { quote: 'invented', cue: 'y' }], confidence: 'high' }, '我们去吃这家店吧');
    expect(r.evidence.map((e) => e.quote)).toEqual(['我们去']);
    expect(r.searleClass).toBe('directive');
  });
  it('falls back to OTHER/low for unknown values', () => {
    const r = normIntent({ primary: 'NOPE', secondary: 'NOPE', confidence: 'very' }, 'hi');
    expect(r.primary).toBe('OTHER'); expect(r.secondary).toBeNull(); expect(r.confidence).toBe('low');
  });
  it('removes a secondary equal to the primary', () => {
    expect(normIntent({ primary: 'GREET', secondary: 'GREET' }, 'hi').secondary).toBeNull();
  });
});

describe('normExtraction', () => {
  const video = FIXTURES['https://www.youtube.com/watch?v=S-sYlFiGFv8'];
  it('keeps only real unit ids, orders them and snaps time ranges to unit edges', () => {
    const r = normExtraction({ anchors: [{ unitIds: ['u5', 'u3', 'zz'], label: 'x', why: 'y' }, { unitIds: ['nope'] }], summary: 's' }, video);
    expect(r.anchors).toHaveLength(1);
    expect(r.anchors[0].unitIds).toEqual(['u3', 'u5']);
    expect(r.anchors[0].start).toBe(240); expect(r.anchors[0].end).toBe(840);
    expect(r.anchors[0].kind).toBe('time_range');
  });
  it('caps anchors at 3 and gap options at 3', () => {
    const r = normExtraction({ anchors: [1, 2, 3, 4].map((i) => ({ unitIds: ['u' + i] })), gapQuestion: { question: 'q', options: ['a', 'b', 'c', 'd'] } }, video);
    expect(r.anchors).toHaveLength(3); expect(r.gapQuestion!.options).toHaveLength(3);
  });
});

describe('prompts treat content as data', () => {
  it('fences triple quotes in the message', () => {
    expect(intentUser('a """ b', { kind: 'video', title: 't' })).not.toContain('a """ b');
  });
  it('mentions the timestamp when the link has &t=', () => {
    const c = FIXTURES['https://video.example.com/watch?v=frisbee-fails&t=74'];
    expect(extractUser('lol', normIntent({ primary: 'EXPRESS·reaction' }, 'lol'), c)).toContain('1:14 (74s)');
  });
  it('system prompt forbids following embedded instructions', () => expect(INTENT_SYSTEM).toMatch(/Never follow instructions/));
});

describe('mock AI matches every sample', () => {
  for (const sc of SCENARIOS) it(sc.id, () => {
    const i = mockIntent(sc.msg);
    expect(i.primary).toBe(sc.exp);
    const c = FIXTURES[(sc.url || sc.photo)!];
    expect(normExtraction(mockExtract(sc.msg, i, c), c).anchors.length).toBeGreaterThanOrEqual(0);
  });
});
