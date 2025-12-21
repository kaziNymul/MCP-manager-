/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  env: {
    CONTROL_PLANE_URL: process.env.CONTROL_PLANE_URL || 'http://localhost:3001',
    REGISTRY_URL: process.env.REGISTRY_URL || 'http://localhost:3002',
    GATEWAY_URL: process.env.GATEWAY_URL || 'http://localhost:3003',
  },
};

module.exports = nextConfig;
