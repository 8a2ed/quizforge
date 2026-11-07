import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable Gzip and Brotli compression for maximum network performance
  compress: true,

  // Remove X-Powered-By header for security and reduced header size
  poweredByHeader: false,

  // Keep Prisma and PDF parsers out of the Edge/browser bundle — must run in Node.js only
  serverExternalPackages: [
    "@prisma/client",
    "prisma",
    "pdf-parse",
    "pdfjs-dist",
    "@napi-rs/canvas",
  ],

  // High performance next-gen image formats (AVIF & WebP)
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
    remotePatterns: [
      { protocol: "https", hostname: "**.telegram.org" },
      { protocol: "https", hostname: "t.me" },
    ],
  },

  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
    proxyClientMaxBodySize: "50mb",
  },

  // HTTP performance and security headers
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },

      {
        source: "/images/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
    ];
  },
};

export default nextConfig;
