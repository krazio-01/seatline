import { ZONE_LABELS, type ZoneName } from '@/types/booking';
import { formatDate } from '@/utils/dates';
import { escapeHtml, pluralize } from '@/utils/text';

export type ConfirmationEmailData = {
    eventName: string;
    eventDate: Date;
    gatesOpenAt: Date;
    venue: string;
    studentName: string;
    guestNames: string[];
    zone: ZoneName;
    seatCount: number;
    qrContentId: string;
};

export function renderConfirmationEmail(data: ConfirmationEmailData): {
    subject: string;
    html: string;
} {
    const eventName = escapeHtml(data.eventName);

    const guestRows = data.guestNames.map((name) => `<li>${escapeHtml(name)}</li>`).join('');
    const seatSummary = `${data.seatCount} ${pluralize(data.seatCount, 'seat')} registered in ${ZONE_LABELS[data.zone]}`;

    const html = `<!doctype html>
<html><body style="margin:0;background:#f6f5f1;font-family:Arial,Helvetica,sans-serif;color:#1b1b1f;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e2dfd6;border-radius:12px;">
<tr><td style="background:#7a1f2b;color:#ffffff;padding:20px 24px;border-radius:12px 12px 0 0;">
<div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;">Invitation</div>
<div style="font-size:22px;font-weight:bold;margin-top:4px;">${eventName}</div></td></tr>
<tr><td style="padding:24px;">
<p style="font-size:18px;margin:0 0 8px;"><strong>Registration successful</strong></p>
<p style="margin:0 0 16px;color:#5f6368;">Booking for ${escapeHtml(data.studentName)}</p>
<p style="margin:0 0 4px;"><strong>When:</strong> ${escapeHtml(formatDate(data.eventDate, 'fullDateTime'))}</p>
<p style="margin:0 0 4px;"><strong>Gates open:</strong> ${escapeHtml(formatDate(data.gatesOpenAt, 'fullDateTime'))}</p>
<p style="margin:0 0 16px;"><strong>Where:</strong> ${escapeHtml(data.venue)}</p>
<p style="margin:0 0 16px;"><strong>Seats:</strong> ${escapeHtml(seatSummary)}</p>
<p style="margin:0 0 4px;"><strong>Guests</strong></p>
<ul style="margin:0 0 20px;padding-left:20px;">${guestRows}</ul>
<div style="text-align:center;margin:8px 0 16px;"><img src="cid:${escapeHtml(data.qrContentId)}" width="220" height="220" alt="Entry QR code" style="display:inline-block;"></div>
<p style="margin:0;color:#5f6368;font-size:13px;text-align:center;">Show this QR code at the gate. It is valid once for your whole party.</p>
</td></tr></table></td></tr></table></body></html>`;

    return { subject: `Registration confirmed: ${data.eventName}`, html };
}

export function renderVerificationEmail(data: { code: string; validMinutes: number }): {
    subject: string;
    html: string;
} {
    const html = `<!doctype html>
<html><body style="margin:0;background:#f6f5f1;font-family:Arial,Helvetica,sans-serif;color:#1b1b1f;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e2dfd6;border-radius:12px;">
<tr><td style="padding:24px;text-align:center;">
<p style="margin:0 0 12px;font-size:16px;">Your verification code is</p>
<p style="margin:0 0 16px;font-size:32px;letter-spacing:6px;"><strong>${escapeHtml(data.code)}</strong></p>
<p style="margin:0;color:#5f6368;font-size:13px;">It is valid for ${data.validMinutes} minutes. If you did not request it, you can ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`;

    return { subject: 'Your email verification code', html };
}
