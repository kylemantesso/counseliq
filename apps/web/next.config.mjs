import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { withSentryConfig } from '@sentry/nextjs';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(appDir, '../..');
const appVersion = JSON.parse(
  readFileSync(path.join(appDir, 'package.json'), 'utf8'),
).version;

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: [
    '@counseliq/app',
    '@counseliq/cards',
    '@counseliq/ui',
    'react-native',
    'react-native-web',
    'solito',
    'nativewind',
    'react-native-css',
    '@gluestack-ui/core',
    '@gluestack-ui/utils',
  ],
  env: {
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL || 'http://localhost:3000',
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV,
    NEXT_PUBLIC_VERCEL_URL: process.env.VERCEL_URL,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  webpack: (config, { webpack }) => {
    config.plugins.push(
      new webpack.DefinePlugin({
        __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
      }),
    );
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      'react-native$': 'react-native-web',
      'convex/browser': path.join(monorepoRoot, 'node_modules/convex/dist/esm/browser/index.js'),
    };
    config.resolve.extensions = [
      '.web.js',
      '.web.jsx',
      '.web.ts',
      '.web.tsx',
      ...config.resolve.extensions,
    ];
    return config;
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
  silent: !process.env.CI,
});
