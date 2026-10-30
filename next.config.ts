import path from 'node:path';
import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${isDev ? "'unsafe-eval' " : ''}https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://challenges.cloudflare.com",
    'frame-src https://challenges.cloudflare.com',
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
].join('; ');

const baseHeaders = [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
    poweredByHeader: false,
    serverExternalPackages: ['@node-rs/argon2', 'tesseract.js'],
    outputFileTracingIncludes: {
        '/api/v1/aadhaar-photos': ['./node_modules/@tesseract.js-data/*/4.0.0_best_int/*.gz'],
        '/api/v1/bookings': ['./public/images/crest-email.png'],
        '/api/v1/bookings/[id]/confirmation-emails': ['./public/images/crest-email.png'],
        '/api/v1/email-verifications': ['./public/images/crest-email.png'],
    },
    sassOptions: { loadPaths: [path.join(process.cwd(), 'src/styles')] },
    async headers() {
        return [
            { source: '/:path*', headers: baseHeaders },
            {
                source: '/scanner/:path*',
                headers: [
                    ...baseHeaders.filter((header) => header.key !== 'Permissions-Policy'),
                    {
                        key: 'Permissions-Policy',
                        value: 'camera=(self), microphone=(), geolocation=()',
                    },
                ],
            },
        ];
    },
};

export default nextConfig;
