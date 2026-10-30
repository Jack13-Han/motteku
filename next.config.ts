import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  // Keep development chunks separate from `next build` output.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  devIndicators: false,
};
export default nextConfig;
