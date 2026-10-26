// DB-free clock endpoint for client clock alignment.
export const dynamic = 'force-dynamic';
export function GET() {
  return new Response(JSON.stringify({ now: Date.now() }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
