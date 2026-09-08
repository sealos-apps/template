/** @type {import('next').NextConfig} */
const { i18n } = require('./next-i18next.config');

const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true'
});

const nextConfig = {
  i18n,
  output: 'standalone',
  reactStrictMode: false,
  compress: true,
  webpack: (config, { isServer }) => {
    config.module.rules = config.module.rules.concat([
      {
        test: /\.svg$/i,
        issuer: /\.[jt]sx?$/,
        use: ['@svgr/webpack']
      }
    ]);
    config.plugins = [...config.plugins];
    return config;
  },
  experimental: {
    instrumentationHook: true
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**'
      }
    ]
  },
  transpilePackages: [
    '@labring/sealos-driver-sdk',
    '@labring/sealos-gtm-sdk',
    '@labring/sealos-shared-sdk',
    '@labring/sealos-ui',
    '@labring/sealos-desktop-sdk'
  ],
  async rewrites() {
    return [
      {
        source: '/api/v2alpha/docs',
        destination: '/doc/v2alpha'
      },
      {
        source: '/api/v2alpha/openapi.json',
        destination: '/api/v2alpha/openapi'
      }
    ];
  }
};

module.exports = withBundleAnalyzer(nextConfig);
