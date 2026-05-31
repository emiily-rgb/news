import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['rss-parser', 'node-cron'],
};

export default nextConfig;
