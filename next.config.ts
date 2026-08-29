import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Page images are paid content, so they live outside `public/` and are read
  // from disk by the server. Next's tracer cannot see a runtime fs.readFile, so
  // the directory has to be named explicitly or it is missing in production.
  outputFileTracingIncludes: {
    '/api/page/**': ['./content/pages/**'],
  },
}

export default nextConfig
