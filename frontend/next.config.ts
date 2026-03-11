import type { NextConfig } from "next";
import crypto from "crypto";
import createNextIntlPlugin from 'next-intl/plugin';

const isCI = process.env.CI === 'true';

// Backend URL for server-side API proxying (eliminates CORS entirely)
const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || 'http://localhost:8080';

const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.accounts.dev https://accounts.clerk.dev https://challenges.cloudflare.com",
  "connect-src 'self' https://*.clerk.accounts.dev https://accounts.clerk.dev https://accounts.clerk.dev https://api.clerk.com wss: https://ucarecdn.com",
  "img-src 'self' data: blob: https://img.clerk.com https://ucarecdn.com https://*.clerk.accounts.dev https://images.unsplash.com https://avatars.githubusercontent.com https://cdn.simpleicons.org https://cdn.jsdelivr.net https://smithery.ai https://*.smithery.ai https://raw.githubusercontent.com https://github.com https://*.supabase.co https://icons.duckduckgo.com https://logos.composio.dev",
  "frame-src 'self' https://challenges.cloudflare.com https://*.clerk.accounts.dev https://accounts.clerk.dev",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  // Generate a unique deployment ID per build so stale clients get a full
  // reload instead of hitting "Failed to find Server Action" errors.
  deploymentId: process.env.DEPLOYMENT_ID || `build-${crypto.randomBytes(4).toString('hex')}`,
  typescript: {
    // In CI: catch real type errors. In dev: don't block hot-reload.
    ignoreBuildErrors: !isCI,
  },
  eslint: {
    // In CI: enforce lint. In dev: don't block builds.
    ignoreDuringBuilds: !isCI,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ucarecdn.com',
      },
      {
        protocol: 'https',
        hostname: 'img.clerk.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: '*.zenblog.com',
      },
    ],
  },

  // ── Content Security Policy ────────────────────────────────────
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: cspDirectives,
          },
        ],
      },
    ];
  },

  // ── API Proxy ──────────────────────────────────────────────────
  // All /api/* requests are proxied server-side to the Fastify backend.
  // This eliminates CORS entirely — browser only talks to Next.js (same origin).
  // In production: Nginx → Next.js:3000 → Fastify:8080 (internal, no CORS)
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
