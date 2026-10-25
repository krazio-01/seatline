import { z } from 'zod';
import { ForbiddenOriginError, ValidationError } from '@/lib/errors';
import { idempotencyKeySchema } from '@/types/booking';

export function parseWithSchema<T>(input: unknown, schema: z.core.$ZodType<T>): T {
    const result = z.safeParse(schema, input);
    if (!result.success) {
        throw new ValidationError(
            result.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
            })),
        );
    }

    return result.data;
}

export function getClientIp(headers: Headers, trustedProxyHops = 1): string {
    const forwardedFor = headers.get('x-forwarded-for') ?? '';
    const addresses = forwardedFor.split(',').map((address) => address.trim());
    const hops = addresses.filter((address) => address !== '');
    return hops[hops.length - trustedProxyHops] ?? headers.get('x-real-ip') ?? 'unknown';
}

export function assertSameOrigin(request: Request, appUrl: string): void {
    if (request.headers.get('origin') !== new URL(appUrl).origin) throw new ForbiddenOriginError();
}

export function assertSameOriginFetch(request: Request): void {
    if (request.headers.get('sec-fetch-site') !== 'same-origin') throw new ForbiddenOriginError();
}

export async function parseBody<T>(request: Request, schema: z.core.$ZodType<T>): Promise<T> {
    const body: unknown = await request.json().catch(() => undefined);

    return parseWithSchema(body, schema);
}

export async function parseForm<T>(request: Request, schema: z.core.$ZodType<T>): Promise<T> {
    const form = await request.formData().catch(() => undefined);

    return parseWithSchema(form ? Object.fromEntries(form.entries()) : undefined, schema);
}

export function privateResponse(body: Uint8Array, contentType: string): Response {
    return new Response(new Uint8Array(body), {
        headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store, private' },
    });
}

export function parseQuery<T>(request: Request, schema: z.core.$ZodType<T>): T {
    const { searchParams } = new URL(request.url);
    const entries = [...searchParams.entries()].filter(([, value]) => value !== '');

    return parseWithSchema(Object.fromEntries(entries), schema);
}

export function parseIdempotencyKey(headers: Headers): string {
    const result = idempotencyKeySchema.safeParse(headers.get('Idempotency-Key'));
    if (!result.success) {
        throw new ValidationError([
            { path: 'Idempotency-Key', message: 'A UUID Idempotency-Key header is required' },
        ]);
    }

    return result.data;
}
