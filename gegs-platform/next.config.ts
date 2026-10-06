import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `output: 'standalone'` was removed in Milestone 2. The approved option-A
  // change replaces `next start` with a custom Node server (server.ts) that
  // captures the TCP peer address, and standalone output ships its own
  // generated server.js which that wrapper supersedes. The deploy unit is still
  // the container (Phase 1 §15.2); only its entrypoint changed.
  experimental: {
    // Phase 1 §4.1: sessions are server-side; no client bundle ever needs them.
    serverActions: { bodySizeLimit: '1mb' },
  },
};

export default nextConfig;
