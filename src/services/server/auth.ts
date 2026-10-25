import 'server-only';
import mongoose from 'mongoose';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_SIGN_IN_HREF, SCANNER_SIGN_IN_HREF } from '@/components/layout/navigation';
import { getEnv } from '@/lib/env';
import { connectDb } from '@/lib/db';
import { InvalidCredentialsError, UnauthorizedError } from '@/lib/errors';
import { hashPassword, verifyPassword } from '@/lib/security/password';
import {
    ADMIN_COOKIE,
    ADMIN_SESSION_SECONDS,
    CHECKER_COOKIE,
    CHECKER_SESSION_SECONDS,
    signSession,
    verifySession,
} from '@/lib/security/tokens';
import { UserModel, type UserRole } from '@/models';
import { loginSchema, SESSION_ROLES } from '@/types/admin';
import { assertSameOrigin } from '@/utils/http';
import { writeAudit } from '@/lib/logger';

export type AdminSession = { role: 'admin'; userId: string; name: string };
export type CheckerSession = { role: 'checker'; userId: string; name: string };

let dummyHash: Promise<string> | undefined;

export const createSessionSchema = z.object({
    ...loginSchema.shape,
    role: z.enum(SESSION_ROLES),
});

async function authenticate(
    role: UserRole,
    username: string,
    password: string,
    ip?: string,
): Promise<string> {
    await connectDb();

    const user = await UserModel.findOne({ username }, null, { lean: true });

    dummyHash ??= hashPassword('placeholder-for-unknown-accounts');

    const hashToVerify = user?.passwordHash ?? (await dummyHash);
    const passwordMatches = await verifyPassword(hashToVerify, password);
    if (!user || !passwordMatches || user.role !== role || !user.active) {
        throw new InvalidCredentialsError();
    }

    await UserModel.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    await writeAudit({ actor: `${role}:${user._id}`, action: `${role}.login`, ip });

    const ttlSeconds = role === 'admin' ? ADMIN_SESSION_SECONDS : CHECKER_SESSION_SECONDS;
    const sessionVersion = user.sessionVersion ?? 0;
    return signSession({ role, userId: String(user._id), sessionVersion }, ttlSeconds);
}

export function loginAdmin(username: string, password: string, ip?: string): Promise<string> {
    return authenticate('admin', username, password, ip);
}

export function loginChecker(username: string, password: string, ip?: string): Promise<string> {
    return authenticate('checker', username, password, ip);
}

export async function resolveActiveSession(
    token: string | undefined,
    role: UserRole,
): Promise<{ userId: string; name: string } | null> {
    const session = await verifySession(token, role);
    if (!session || !mongoose.isValidObjectId(session.userId)) return null;

    await connectDb();

    const user = await UserModel.findById(session.userId, null, { lean: true });
    if (!user || !user.active || user.role !== role) return null;
    if ((user.sessionVersion ?? 0) !== session.sessionVersion) return null;

    return { userId: String(user._id), name: user.name };
}

export async function getAdminSession(): Promise<AdminSession | null> {
    const cookieStore = await cookies();
    const adminCookie = cookieStore.get(ADMIN_COOKIE);
    const user = await resolveActiveSession(adminCookie?.value, 'admin');
    return user ? { role: 'admin', ...user } : null;
}

export async function getCheckerSession(): Promise<CheckerSession | null> {
    const cookieStore = await cookies();
    const checkerCookie = cookieStore.get(CHECKER_COOKIE);
    const user = await resolveActiveSession(checkerCookie?.value, 'checker');
    return user ? { role: 'checker', ...user } : null;
}

export async function requireAdminSession() {
    const session = await getAdminSession();
    if (!session) throw new UnauthorizedError();

    return session;
}

export async function requireAdminPage() {
    const session = await getAdminSession();
    if (!session) redirect(ADMIN_SIGN_IN_HREF);

    return session;
}

export async function requireAdminMutation(request: Request) {
    assertSameOrigin(request, getEnv().APP_URL);
    return requireAdminSession();
}

export async function requireCheckerSession() {
    const session = await getCheckerSession();
    if (!session) throw new UnauthorizedError();

    return session;
}

export async function requireCheckerPage() {
    const session = await getCheckerSession();
    if (!session) redirect(SCANNER_SIGN_IN_HREF);

    return session;
}

export async function requireCheckerMutation(request: Request) {
    assertSameOrigin(request, getEnv().APP_URL);
    return requireCheckerSession();
}
