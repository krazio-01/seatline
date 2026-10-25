import 'server-only';
import { getEnv } from '@/lib/env';
import { createNoopBotCheck, createTurnstileBotCheck, type BotCheck } from './bot-check';
import { createSmtpEmailSender, type EmailSender } from './email';
import {
    createTesseractRecognizer,
    limitRecognizer,
    type TextRecognizer,
} from './text-recognition';

let emailSender: EmailSender | undefined;
let botCheck: BotCheck | undefined;
let textRecognizer: TextRecognizer | undefined;

const OCR_LIMITS = { maxPending: 6, timeoutMs: 25_000 };

export function getEmailSender(): EmailSender {
    const env = getEnv();
    emailSender ??= createSmtpEmailSender({
        from: env.EMAIL_FROM,
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
    });

    return emailSender;
}

export function getBotCheck(): BotCheck {
    const { TURNSTILE_SECRET_KEY } = getEnv();
    botCheck ??= TURNSTILE_SECRET_KEY
        ? createTurnstileBotCheck(TURNSTILE_SECRET_KEY)
        : createNoopBotCheck();

    return botCheck;
}

export function getTextRecognizer(): TextRecognizer {
    textRecognizer ??= limitRecognizer(createTesseractRecognizer(), OCR_LIMITS);

    return textRecognizer;
}
