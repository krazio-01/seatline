import pino, { type LoggerOptions } from 'pino';
import { connectDb } from '@/lib/db';
import { AuditLogModel } from '@/models';

export type AuditEntry = {
    actor: string;
    action: string;
    targetId?: string;
    ip?: string;
    details?: string;
};

const LOG_REDACT_PATHS = [
    'aadhaar',
    'aadhaarEncrypted',
    'phone',
    'email',
    'password',
    'pin',
    'token',
    'qrToken',
    '*.aadhaar',
    '*.aadhaarEncrypted',
    '*.phone',
    '*.email',
    '*.password',
    '*.pin',
    '*.token',
    '*.qrToken',
    'guests[*].aadhaar',
    'guests[*].aadhaarEncrypted',
    'guests[*].phone',
    'guests[*].email',
    '*.guests[*].aadhaar',
    '*.guests[*].aadhaarEncrypted',
    '*.guests[*].phone',
    '*.guests[*].email',
    'image',
    'original',
    'masked',
    'photoToken',
    '*.image',
    '*.original',
    '*.masked',
    '*.photoToken',
    'guests[*].photoToken',
    '*.guests[*].photoToken',
    'req.headers.cookie',
    'req.headers.authorization',
];

export const loggerOptions: LoggerOptions = {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
};

export const logger = pino(loggerOptions);

export async function writeAudit(entry: AuditEntry): Promise<void> {
    await connectDb();
    await AuditLogModel.create(entry);
}
