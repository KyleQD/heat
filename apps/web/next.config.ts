import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import type { NextConfig } from 'next'

// v0 mirrors project env vars into the monorepo root, so load them for this workspace too.
loadEnvConfig(path.resolve(process.cwd(), '../..'))

const nextConfig: NextConfig = {
  allowedDevOrigins: ['*.vercel.run', '*.vusercontent.net'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
    ]
  },
}

export default nextConfig
