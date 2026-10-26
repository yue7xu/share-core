// Deterministic stand-in for Claude, used when AI_MODE=mock or no API key is set, and in tests.
// Sample messages get the type they were written for; anything else gets a small cue-based guess.
import { SCENARIOS, TYPES, REQUIRED, type ContentObject } from './data';

const CUES: [RegExp, string, string][] = [
  [/(lol|lmao|哈哈|太好笑|😂|😭|omg)/i, 'EXPRESS·reaction', 'laughter / emoji only'],
  [/(生日快乐|新年快乐|happy birthday|早安|good morning)/i, 'GREET', 'greeting formula'],
  [/(谢谢|thanks|thank you|抱歉|sorry|恭喜|congrats)/i, 'EXPRESS·attitude', 'thank / sorry / congrats verb'],
  [/(就定为|从今天起|officially|it's decided)/i, 'DECLARE', 'status-setting performative'],
  [/(发错了|更正|新版本|ignore the last)/i, 'AMEND·information', 'correction words'],
  [/(提醒一下|别忘了|reminder|don't forget)/i, 'REMIND·information', 'reminder words'],
  [/(不去了|算了|can't make it|pass on)/i, 'REFUSE·activity', 'negation of a proposal'],
  [/(我帮你|我来|I'll|I will)/i, 'COMMIT·activity', 'first person + future'],
  [/(你觉得|怎么样|what do you think|thoughts\?)/i, 'REQUEST·opinion', 'opinion-seeking question'],
  [/(我们去|一起|let's|lets |wanna go)/i, 'PROPOSE·activity', 'first-person plural + activity'],
  [/(你.*吧|记得|you should)/i, 'REQUEST·activity', 'second person + advice'],
  [/(说的对|说得对|同意|agree|is right)/i, 'DELIVER·opinion', 'stance on the content'],
  [/(蛮好|好喝|好吃|推荐|so good|try this)/i, 'SUGGEST·activity', 'evaluative words'],
];

export function mockIntent(message: string) {
  const sc = SCENARIOS.find((s) => s.msg && s.msg === message.trim());
  let primary = 'OTHER', cue = '', quote = '';
  if (sc) primary = sc.exp;
  for (const [re, type, c] of CUES) {
    const m = message.match(re);
    if (m && (!sc || type === primary)) { if (!sc) primary = type; cue = c; quote = m[0]; break; }
  }
  if (!message.trim()) primary = 'OTHER';
  const confidence = primary === 'OTHER' ? 'low' : quote ? 'high' : 'medium';
  const missing = (REQUIRED[primary] || []).filter((s) => s === 'when' ? !/(周|点|今天|明天|tonight|today|tomorrow|weekend|sat|sun)/i.test(message) : false);
  return {
    primary, secondary: sc?.sec || null, searleClass: TYPES[primary].cls,
    evidence: quote ? [{ quote, cue }] : [], indirect: sc?.note === 'indirect',
    intentLine: message.trim() ? `(mock) ${TYPES[primary].label}` : '',
    slots: { what: null, when: null, who: primary === 'PROPOSE·activity' ? 'both' : null },
    confidence, missingSlots: missing, isShare: true,
  };
}

const SKIP = /(sponsor|unrelated|off-topic|advertis|publisher|gallery|history of|office redesign|outro)/i;

export function mockExtract(message: string, intent: { primary: string; confidence: string } | null, content: ContentObject) {
  const useful = content.units.filter((u) => !SKIP.test(u.text));
  const picked = useful.slice(0, 2);
  const lowConf = intent?.confidence === 'low';
  return {
    anchors: picked.map((u) => ({ unitIds: [u.unitId], label: u.text.split(/[.:,，。]/)[0].slice(0, 28), why: 'Mock: first relevant part' })),
    summary: intent?.primary === 'GREET' ? '' : `(Mock AI) ${picked.map((u) => u.text).join(' ').slice(0, 140)}`,
    fallback: picked.length === 0,
    gapQuestion: lowConf ? { question: message ? 'What should they get from this?' : 'What do you want them to get from this?',
      options: ['Just for fun', 'Try it yourself', "Let's do it together"] } : null,
    replyOptions: intent?.primary === 'REQUEST·opinion' ? ['Option A', 'Option B', 'Not sure'] : [],
    discussPrompt: intent?.primary === 'DELIVER·opinion' ? 'Which point do you agree with most?' : null,
  };
}
