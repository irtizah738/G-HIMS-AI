import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    'ais-dev-xvo5ch2dvjjh7m4mqyk5xy-644889006515.asia-east1.run.app',
    '*.run.app',
    'localhost:3000',
  ],
  serverExternalPackages: [
    'firebase-admin',
    '@google-cloud/firestore',
    '@grpc/grpc-js',
  ],
  output: 'standalone',
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

