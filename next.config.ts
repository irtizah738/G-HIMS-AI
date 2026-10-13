import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    'ais-dev-bo7mqgmhjalnjw6vyttn2u-644889006515.asia-east1.run.app',
    'ais-pre-bo7mqgmhjalnjw6vyttn2u-644889006515.asia-east1.run.app',
    'localhost:3000',
    '127.0.0.1:3000',
  ],
  serverExternalPackages: [
    'firebase-admin',
    '@google-cloud/firestore',
    '@grpc/grpc-js',
  ],
  output: 'standalone',
  async headers() {
    return [{
      source: '/telehealth/join',
      headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Cache-Control', value: 'private, no-store' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
      ],
    }];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;

