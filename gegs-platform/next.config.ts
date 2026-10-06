import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Phase 1 §15.2: the container is the deploy unit; output is self-contained.
  output: 'standalone',
  experimental: {
    // Phase 1 §4.1: sessions are server-side; no client bundle ever needs them.
    serverActions: { bodySizeLimit: '1mb' },
  },
};

export default nextConfig;
