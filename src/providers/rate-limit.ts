import 'server-only';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { getEnv } from '@/lib/env';
import { RateLimitedError } from '@/lib/errors';
import { getClientIp } from '@/utils/http';

export type RateLimitRule = { max: number; windowSeconds: number };

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export interface RateLimiter {
    limit(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
}

export const RATE_LIMITS = {
    booking: { max: 10, windowSeconds: 600 },
    studentsList: { max: 60, windowSeconds: 60 },
    adminLogin: { max: 5, windowSeconds: 900 },
    checkerLogin: { max: 10, windowSeconds: 900 },
    checkerWrite: { max: 30, windowSeconds: 3600 },
    scan: { max: 120, windowSeconds: 60 },
    emailVerificationSend: { max: 10, windowSeconds: 900 },
    emailVerificationPerAddress: { max: 3, windowSeconds: 900 },
    emailVerificationConfirm: { max: 30, windowSeconds: 900 },
    aadhaarReveal: { max: 30, windowSeconds: 3600 },
    aadhaarPhotoUpload: { max: 20, windowSeconds: 600 },
    aadhaarPhotoView: { max: 600, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;

let rateLimiter: RateLimiter | undefined;

export type RateLimitName = keyof typeof RATE_LIMITS;

export function createMemoryRateLimiter(): RateLimiter {
    const windows = new Map<string, { count: number; resetAt: number }>();
    return {
        async limit(key, rule) {
            const now = Date.now();
            const current = windows.get(key);
            if (!current || current.resetAt <= now) {
                windows.set(key, { count: 1, resetAt: now + rule.windowSeconds * 1000 });
                return { allowed: true, retryAfterSeconds: 0 };
            }

            current.count += 1;

            if (current.count <= rule.max) return { allowed: true, retryAfterSeconds: 0 };

            return { allowed: false, retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) };
        },
    };
}

export function createUpstashRateLimiter(url: string, token: string): RateLimiter {
    const redis = new Redis({ url, token });
    const limiters = new Map<string, Ratelimit>();
    return {
        async limit(key, rule) {
            const ruleId = `${rule.max}:${rule.windowSeconds}`;
            let limiter = limiters.get(ruleId);
            if (!limiter) {
                limiter = new Ratelimit({
                    redis,
                    limiter: Ratelimit.slidingWindow(rule.max, `${rule.windowSeconds} s`),
                    prefix: `rl:${ruleId}`,
                });

                limiters.set(ruleId, limiter);
            }

            const result = await limiter.limit(key);
            return {
                allowed: result.success,
                retryAfterSeconds: Math.max(0, Math.ceil((result.reset - Date.now()) / 1000)),
            };
        },
    };
}

export function getRateLimiter(): RateLimiter {
    const env = getEnv();
    rateLimiter ??=
        env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
            ? createUpstashRateLimiter(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN)
            : createMemoryRateLimiter();

    return rateLimiter;
}

export async function enforceRateLimit(name: RateLimitName, identity: string): Promise<void> {
    const result = await getRateLimiter().limit(`${name}:${identity}`, RATE_LIMITS[name]);
    if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
}

export function clientIp(request: Request): string {
    return getClientIp(request.headers, getEnv().TRUSTED_PROXY_HOPS);
}
