import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    'firebase-admin',
    '@google-cloud/firestore',
    '@grpc/grpc-js',
  ],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;

