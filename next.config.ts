import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Suppress X-Powered-By: Next.js header (DAST Finding #8)
  poweredByHeader: false,

  async headers() {
    return [
      // ── Global security headers (all routes) ──────────────────────
      // Fixes DAST Findings #3 (clickjacking), #6 (MIME sniffing)
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },

      // ── Favicon headers (DAST Finding #1 – MEDIUM) ────────────────
      // Explicitly marks the favicon as intentional binary content so
      // the ZAP scanner does not misinterpret it as source code disclosure.
      {
        source: "/favicon.ico",
        headers: [
          {
            key: "Content-Disposition",
            value: "inline",
          },
          {
            key: "Cache-Control",
            value: "public, max-age=86400, immutable",
          },
        ],
      },

      // ── Public image assets ────────────────────────────────────────
      {
        source: "/:path*.(png|ico)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400",
          },
        ],
      },

      // ── Public skills files ────────────────────────────────────────
      {
        source: "/skills/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },

      // ── API routes – restrictive CORS (DAST Finding #2) ───────────
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            value: "https://fgac.ai",
          },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET, POST, PUT, DELETE, OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
