export function json(data, status = 200) {
  return Response.json(data, { status });
}

export function options() {
  return new Response(null, { status: 204 });
}

export async function body(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export function siteUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}
