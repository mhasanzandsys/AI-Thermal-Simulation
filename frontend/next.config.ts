import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  transpilePackages: ['@ats/shared'],
  turbopack: { root: path.join(__dirname, '..') },
  outputFileTracingRoot: path.join(__dirname, '..'),
};

export default nextConfig;
