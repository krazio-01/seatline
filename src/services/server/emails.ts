import 'server-only';
import mongoose from 'mongoose';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { getEnv } from '@/lib/env';
import { connectDb } from '@/lib/db';
import {
    EmailCapacityError,
    EmailDeliveryFailedError,
    EmailNotVerifiedError,
    InvalidVerificationCodeError,
    NotFoundError,
    VerificationExpiredError,
    VerificationLockedError,
} from '@/lib/errors';
import { logger } from '@/lib/logger';
import { EMAIL_PROOF_SECONDS, signEmailProof, verifyEmailProof } from '@/lib/security/tokens';
import { BookingModel, EmailVerificationModel } from '@/models';
import type { EmailSender } from '@/providers/email';
import { renderConfirmationEmail, renderVerificationEmail } from '@/templates/emails';
import type { EmailDelivery, EmailStatus, ZoneName } from '@/types/booking';
import { getEventSettings } from './settings';

export type SendOptions = { now?: Date; dailyLimit?: number };

type StoredEmail = {
    status: EmailStatus;
    sentAt?: Date | null;
    attempts: number;
    lastError?: string | null;
};

const DAY_MS = 24 * 60 * 60_000;
export const DAILY_LIMIT_MESSAGE = 'Daily email limit reached';
const GENERIC_FAILURE_MESSAGE = 'Email could not be sent';
const QR_CONTENT_ID = 'invitation-qr';
export const OTP_VALID_SECONDS = 600;
export const MAX_CODE_ATTEMPTS = 5;
export const EMAILS_PER_BOOKING = 2;
const CODE_DIGITS = 6;

async function attemptDelivery(
    booking: {
        _id: unknown;
        studentName: string;
        zone: ZoneName;
        seatCount: number;
        qrToken: string;
        guests: { name: string; email: string }[];
    },
    sender: EmailSender,
    options: SendOptions,
): Promise<EmailDelivery> {
    const now = options.now ?? new Date();
    const bookingId = String(booking._id);

    let update: Record<string, unknown>;

    try {
        const dailyLimit = options.dailyLimit ?? getEnv().EMAIL_DAILY_LIMIT;
        if ((await countEmailsSentInLastDay(now)) >= dailyLimit) {
            update = {
                $set: { 'email.status': 'failed', 'email.lastError': DAILY_LIMIT_MESSAGE },
            };
        } else {
            const settings = await getEventSettings();
            const { subject, html } = renderConfirmationEmail({
                eventName: settings.eventName,
                eventDate: settings.eventDate,
                gatesOpenAt: settings.gatesOpenAt,
                venue: settings.venue,
                studentName: booking.studentName,
                guestNames: booking.guests.map((guest) => guest.name),
                zone: booking.zone,
                seatCount: booking.seatCount,
                qrContentId: QR_CONTENT_ID,
            });

            await sender.send({
                to: booking.guests[0].email,
                subject,
                html,
                attachments: [
                    {
                        filename: 'invitation-qr.png',
                        content: await renderQrPng(booking.qrToken),
                        contentType: 'image/png',
                        cid: QR_CONTENT_ID,
                    },
                ],
            });

            update = {
                $set: { 'email.status': 'sent', 'email.sentAt': now },
                $unset: { 'email.lastError': '' },
            };
        }
    } catch (error) {
        logger.error(
            { bookingId, errorName: error instanceof Error ? error.name : 'unknown' },
            'confirmation email failed',
        );

        update = {
            $set: { 'email.status': 'failed', 'email.lastError': describeSendFailure(error) },
        };
    }

    const recorded = await BookingModel.findOneAndUpdate({ _id: bookingId }, update, {
        returnDocument: 'after',
        lean: true,
    });
    if (!recorded) throw new NotFoundError('Booking not found');

    return toEmailDelivery(recorded.email);
}

function hashCode(verificationId: string, code: string): string {
    const hmac = createHmac('sha256', getEnv().SESSION_SECRET);
    hmac.update(`${verificationId}:${code}`);

    return hmac.digest('hex');
}

export function renderQrPng(token: string): Promise<Buffer> {
    return QRCode.toBuffer(token, {
        type: 'png',
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 360,
    });
}

export async function countEmailsSentInLastDay(now: Date): Promise<number> {
    await connectDb();

    const since = new Date(now.getTime() - DAY_MS);
    const [confirmations, verificationCodes] = await Promise.all([
        BookingModel.countDocuments({ 'email.sentAt': { $gte: since } }),
        EmailVerificationModel.countDocuments({ createdAt: { $gte: since } }),
    ]);

    return confirmations + verificationCodes;
}

export async function remainingEmailCapacity(now: Date, dailyLimit: number): Promise<number> {
    return dailyLimit - (await countEmailsSentInLastDay(now));
}

export function toEmailDelivery(email: StoredEmail): EmailDelivery {
    return {
        status: email.status,
        sentAt: email.sentAt?.toISOString() ?? null,
        attempts: email.attempts,
        lastError: email.lastError ?? null,
    };
}

export function describeSendFailure(error: unknown): string {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,30}$/.test(code)
        ? `SMTP error ${code}`
        : GENERIC_FAILURE_MESSAGE;
}

export async function sendConfirmationEmail(
    bookingId: string,
    sender: EmailSender,
    options: SendOptions = {},
): Promise<void> {
    try {
        await connectDb();

        const claimed = await BookingModel.findOneAndUpdate(
            { _id: bookingId, 'email.status': 'pending', 'email.attempts': 0 },
            { $inc: { 'email.attempts': 1 } },
            { returnDocument: 'after', lean: true },
        );
        if (claimed) await attemptDelivery(claimed, sender, options);
    } catch (error) {
        logger.error(
            { bookingId, errorName: error instanceof Error ? error.name : 'unknown' },
            'confirmation email could not be processed',
        );
    }
}

export async function resendConfirmationEmail(
    bookingId: string,
    sender: EmailSender,
    options: SendOptions = {},
): Promise<EmailDelivery> {
    if (!mongoose.isValidObjectId(bookingId)) throw new NotFoundError('Booking not found');

    await connectDb();

    const claimed = await BookingModel.findOneAndUpdate(
        { _id: bookingId },
        { $inc: { 'email.attempts': 1 } },
        { returnDocument: 'after', lean: true },
    );
    if (!claimed) throw new NotFoundError('Booking not found');

    return attemptDelivery(claimed, sender, options);
}

export async function startEmailVerification(
    email: string,
    sender: EmailSender,
    options: { now?: Date; dailyLimit?: number } = {},
): Promise<{ verificationId: string; expiresInSeconds: number }> {
    await connectDb();

    const now = options.now ?? new Date();
    const dailyLimit = options.dailyLimit ?? getEnv().EMAIL_DAILY_LIMIT;
    if ((await remainingEmailCapacity(now, dailyLimit)) < EMAILS_PER_BOOKING)
        throw new EmailCapacityError();

    const verificationId = new mongoose.Types.ObjectId();
    const rawCode = randomInt(0, 10 ** CODE_DIGITS);
    const code = String(rawCode).padStart(CODE_DIGITS, '0');
    await EmailVerificationModel.create({
        _id: verificationId,
        email,
        codeHash: hashCode(String(verificationId), code),
        expiresAt: new Date(now.getTime() + OTP_VALID_SECONDS * 1000),
    });

    try {
        const { subject, html } = renderVerificationEmail({
            code,
            validMinutes: OTP_VALID_SECONDS / 60,
        });
        await sender.send({ to: email, subject, html });
    } catch (error) {
        logger.error(
            {
                verificationId: String(verificationId),
                errorName: error instanceof Error ? error.name : 'unknown',
            },
            'verification email failed',
        );

        await EmailVerificationModel.deleteOne({ _id: verificationId });

        throw new EmailDeliveryFailedError();
    }

    return { verificationId: String(verificationId), expiresInSeconds: OTP_VALID_SECONDS };
}

export async function confirmEmailVerification(
    verificationId: string,
    code: string,
    options: { now?: Date } = {},
): Promise<{ verificationToken: string; expiresInSeconds: number }> {
    if (!mongoose.isValidObjectId(verificationId)) throw new VerificationExpiredError();

    await connectDb();

    const now = options.now ?? new Date();

    const attempt = await EmailVerificationModel.findOneAndUpdate(
        {
            _id: verificationId,
            verifiedAt: null,
            expiresAt: { $gt: now },
            attempts: { $lt: MAX_CODE_ATTEMPTS },
        },
        { $inc: { attempts: 1 } },
        { returnDocument: 'after', lean: true },
    );

    if (!attempt) {
        const existing = await EmailVerificationModel.findById(verificationId, null, {
            lean: true,
        });
        if (existing?.verifiedAt) throw new VerificationExpiredError();
        if (existing && existing.expiresAt > now) throw new VerificationLockedError();

        throw new VerificationExpiredError();
    }

    const expected = Buffer.from(attempt.codeHash, 'hex');
    const actual = Buffer.from(hashCode(String(attempt._id), code), 'hex');
    if (!timingSafeEqual(expected, actual)) {
        throw new InvalidVerificationCodeError(MAX_CODE_ATTEMPTS - attempt.attempts);
    }

    const consumed = await EmailVerificationModel.updateOne(
        { _id: attempt._id, verifiedAt: null },
        { $set: { verifiedAt: now } },
    );
    if (consumed.modifiedCount !== 1) throw new VerificationExpiredError();

    return {
        verificationToken: await signEmailProof(attempt.email),
        expiresInSeconds: EMAIL_PROOF_SECONDS,
    };
}

export async function assertEmailProof(token: string | undefined, email: string): Promise<void> {
    const verifiedEmail = token ? await verifyEmailProof(token) : null;
    if (verifiedEmail !== email.toLowerCase()) throw new EmailNotVerifiedError();
}
