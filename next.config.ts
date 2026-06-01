import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['rss-parser', 'node-cron', '@anthropic-ai/sdk'],
};

export default nextConfig;
