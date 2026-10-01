import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  transpilePackages: ['@ats/shared'],
  turbopack: { root: path.join(__dirname, '..') },
  outputFileTracingRoot: path.join(__dirname, '..'),
  // On Vercel, vercel.json routes /api/* to the Express service. When running `next start`
  // yourself, proxy /api/* to the local Express server instead.
  async rewrites() {
    if (process.env.VERCEL) return [];
    const backend = (process.env.BACKEND_URL ?? 'http://localhost:4000').replace(/\/$/, '');
    return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
