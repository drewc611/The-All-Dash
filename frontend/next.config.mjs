/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output copies only what the server needs, which is what the
  // Dockerfile ships: no node_modules tree, no source.
  output: 'standalone',
  // Pin the tracing root to this package: with another lockfile above it
  // (the browser app's), Next would otherwise nest the standalone output
  // under frontend/ and the Dockerfile's `node server.js` would miss it.
  outputFileTracingRoot: import.meta.dirname,
  reactStrictMode: true,
  poweredByHeader: false,
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        // Only honoured over HTTPS, which is the only way the Ingress serves it.
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    },
  ],
}

export default nextConfig
