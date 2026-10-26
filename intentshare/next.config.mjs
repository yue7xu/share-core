/** @type {import('next').NextConfig} */
const pages = ['/', '/demo', '/join', '/booth', '/present'];
export default {
  reactStrictMode: true,
  serverExternalPackages: ['@electric-sql/pglite', 'linkedom'],
  outputFileTracingIncludes: { '/api/**': ['./supabase/migrations/**'] },
  async rewrites() {
    return {
      beforeFiles: [
        ...pages.map((source) => ({ source, destination: '/app/index.html' })),
        { source: '/admin', destination: '/admin/index.html' },
      ],
    };
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    ] }];
  },
};
