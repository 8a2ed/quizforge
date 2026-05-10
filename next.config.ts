import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Prisma out of the Edge/browser bundle — must run in Node.js only
  serverExternalPackages: ["@prisma/client", "prisma"],

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.telegram.org" },
      { protocol: "https", hostname: "t.me" },
    ],
  },

  // Reduce 404 noise from favicon/apple-touch in dev
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
