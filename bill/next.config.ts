import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native / Node-only packages must stay outside the server bundle.
  serverExternalPackages: ['better-sqlite3', '@prisma/adapter-better-sqlite3', 'qrcode'],
};

export default nextConfig;
