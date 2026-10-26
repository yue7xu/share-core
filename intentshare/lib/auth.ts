// Session tokens: <participant_id>.<session_id>.<mode>.<HMAC>, signed with the server key, so a browser
// can only act as the participant it logged in as. mode: s=study d=demo p=presentation b=booth.
// Booth sessions are never logged (CHI booth: no attendee data, plan §11.2 C).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';

const secret = () => env.serverKey || 'local-dev-server-key-0123456789abcdef';
export type Mode = 's' | 'd' | 'p' | 'b';
export const MODE_CHAR: Record<string, Mode> = { study: 's', demo: 'd', presentation: 'p', booth: 'b' };

export function signSession(participantId: string, sessionId: string, mode: Mode) {
  return createHmac('sha256', secret()).update(`${participantId}.${sessionId}.${mode}`).digest('base64url');
}

export type Auth = { participantId: string; sessionId: string; mode: Mode };

function parse(h: string): Auth | null {
  const m = h.match(/^Session ([0-9a-f-]{36})\.([0-9a-f-]{36})\.([sdpb])\.([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const [, participantId, sessionId, mode, sig] = m;
  const want = Buffer.from(signSession(participantId, sessionId, mode as Mode));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { participantId, sessionId, mode: mode as Mode };
}

// Primary identity (Authorization: Session <token>). In demo modes one browser plays both people,
// so the partner's token may come along in X-Session-2.
export function readAuth(req: Request): Auth | null {
  return parse(req.headers.get('authorization') || '');
}
export function readAuthAll(req: Request): Auth[] {
  return [parse(req.headers.get('authorization') || ''), parse('Session ' + (req.headers.get('x-session-2') || ''))]
    .filter(Boolean) as Auth[];
}
export function tokenFor(participantId: string, sessionId: string, mode: Mode) {
  return `${participantId}.${sessionId}.${mode}.${signSession(participantId, sessionId, mode)}`;
}
export const isBooth = (a: Auth | null | undefined) => a?.mode === 'b';

export function isAdmin(req: Request) {
  if (!env.adminToken) return process.env.NODE_ENV !== 'production';
  const t = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  const a = Buffer.from(t), b = Buffer.from(env.adminToken);
  return a.length === b.length && timingSafeEqual(a, b);
}
