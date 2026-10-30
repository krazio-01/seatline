import { ZONE_LABELS, type ZoneName } from '@/types/booking';
import { formatDate } from '@/utils/dates';
import { escapeHtml, pluralize } from '@/utils/text';

export type ConfirmationEmailData = {
    eventName: string;
    eventDate: Date;
    gatesOpenAt: Date;
    venue: string;
    studentName: string;
    studentGroup: string;
    guestNames: string[];
    zone: ZoneName;
    seatCount: number;
    appUrl: string;
    qrContentId: string;
    crestContentId: string;
};

export type VerificationEmailData = {
    code: string;
    validMinutes: number;
    eventName: string;
    eventDate: Date;
    crestContentId: string;
};

const SANS_FONT = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const SERIF_FONT = "Georgia,'Times New Roman',serif";
const MONO_FONT = "'SFMono-Regular',Menlo,Consolas,monospace";

const TRICOLOUR = ['#ff9933', '#e4e4e7', '#138808'];

const ENTRY_REQUIREMENTS = [
    'Each guest must carry their original Aadhaar card.',
    'Please keep this email available on your phone or bring a printed copy.',
    'The pass is valid for one entry, so all guests should arrive together.',
];

function eventTitle(eventName: string, eventDate: Date): string {
    return `${eventName} ${formatDate(eventDate, 'year')}`;
}

function renderLayout({
    title,
    preheader,
    crestContentId,
    footerTitle,
    body,
}: {
    title: string;
    preheader: string;
    crestContentId: string;
    footerTitle: string;
    body: string;
}): string {
    const tricolour = TRICOLOUR.map(
        (color) =>
            `<td width="24" height="3" bgcolor="${color}" style="width:24px;height:3px;background:${color};font-size:0;line-height:0;">&nbsp;</td>`,
    ).join('');

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background:#ffffff;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;font-family:${SANS_FONT};color:#09090b;">
<tr><td style="padding:0 0 18px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:12px;"><img src="cid:${escapeHtml(crestContentId)}" width="34" height="36" alt="Indian Air Force crest" style="display:block;border:0;"></td>
<td><div style="font-size:15px;font-weight:600;line-height:1.3;">${escapeHtml(footerTitle)}</div><div style="font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:#71717a;">Indian Air Force</div></td>
</tr></table>
</td></tr>
<tr><td style="padding:0 0 28px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${tricolour}</tr></table></td></tr>
${body}
<tr><td style="padding:28px 0 0;border-top:1px solid #e4e4e7;font-size:12px;line-height:1.5;color:#71717a;">
${escapeHtml(footerTitle)} · Indian Air Force<br>This is an automated message. Please do not reply to this email.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function detailRow(label: string, value: string, isLast = false): string {
    const border = isLast ? '' : 'border-bottom:1px solid #f4f4f5;';

    return `<tr><td style="padding:12px 0;${border}font-size:14px;color:#71717a;">${escapeHtml(label)}</td><td align="right" style="padding:12px 0;${border}font-size:14px;font-weight:500;">${value}</td></tr>`;
}

export function renderConfirmationEmail(data: ConfirmationEmailData): {
    subject: string;
    html: string;
} {
    const title = eventTitle(data.eventName, data.eventDate);
    const zoneSummary = `${ZONE_LABELS[data.zone]} · ${data.seatCount} ${pluralize(data.seatCount, 'seat')}`;
    const guests = data.guestNames.map(escapeHtml).join('<br>');
    const requirements = ENTRY_REQUIREMENTS.map((item) => `&bull;&nbsp;${item}`).join('<br>');

    const body = `<tr><td style="padding:0 0 28px;">
<div style="font-size:12px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:#15803d;">Registration confirmed</div>
<h1 style="margin:12px 0;font-family:${SERIF_FONT};font-weight:400;font-size:32px;line-height:1.15;color:#09090b;">Your entry pass for ${escapeHtml(title)}</h1>
<p style="margin:0;font-size:15px;line-height:1.6;color:#3f3f46;">This confirms the registration for <strong style="color:#09090b;">${escapeHtml(data.studentName)}</strong>, Group ${escapeHtml(data.studentGroup)}. Please present the QR code below at the gate. It is valid for a single entry of your entire party.</p>
</td></tr>
<tr><td style="padding:0 0 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:16px;"><tr><td align="center" style="padding:28px;">
<img src="cid:${escapeHtml(data.qrContentId)}" width="220" height="220" alt="Entry QR code" style="display:block;border:0;border-radius:10px;">
<div style="margin-top:14px;font-family:${SERIF_FONT};font-size:24px;color:#09090b;">${escapeHtml(zoneSummary)}</div>
${data.seatCount > 1 ? '<div style="margin-top:2px;font-size:13px;color:#71717a;">Seated together in one enclosure</div>' : ''}
</td></tr></table>
</td></tr>
<tr><td style="padding:0 0 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${detailRow('Date', escapeHtml(formatDate(data.eventDate, 'fullDate')))}
${detailRow('Gates open', escapeHtml(formatDate(data.gatesOpenAt, 'time')))}
${detailRow('Parade begins', escapeHtml(formatDate(data.eventDate, 'time')))}
${detailRow('Venue', escapeHtml(data.venue))}
${detailRow('Guests', guests, true)}
</table>
</td></tr>
<tr><td style="padding:0 0 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f4f5" style="background:#f4f4f5;border-radius:12px;"><tr><td style="padding:20px;">
<div style="font-size:14px;font-weight:600;color:#09090b;">Entry requirements</div>
<div style="margin-top:10px;font-size:14px;line-height:1.6;color:#3f3f46;">${requirements}</div>
</td></tr></table>
</td></tr>
<tr><td style="padding:0 0 32px;">
<a href="${escapeHtml(data.appUrl)}" style="display:inline-block;padding:13px 22px;background:#18181b;color:#fafafa;border-radius:10px;font-size:14px;font-weight:500;text-decoration:none;">View event details</a>
</td></tr>`;

    return {
        subject: `Your entry pass for ${title}`,
        html: renderLayout({
            title: `Your entry pass for ${title}`,
            preheader: `${zoneSummary}. Present the QR code at the gate.`,
            crestContentId: data.crestContentId,
            footerTitle: title,
            body,
        }),
    };
}

export function renderVerificationEmail(data: VerificationEmailData): {
    subject: string;
    html: string;
} {
    const title = eventTitle(data.eventName, data.eventDate);

    const body = `<tr><td style="padding:0 0 28px;">
<h1 style="margin:0 0 12px;font-family:${SERIF_FONT};font-weight:400;font-size:32px;line-height:1.15;color:#09090b;">Verify your email address</h1>
<p style="margin:0;font-size:15px;line-height:1.6;color:#3f3f46;">Use the following code to complete your registration for ${escapeHtml(title)}.</p>
</td></tr>
<tr><td style="padding:0 0 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f4f5" style="background:#f4f4f5;border-radius:12px;"><tr><td align="center" style="padding:22px;font-family:${MONO_FONT};font-size:36px;font-weight:600;letter-spacing:10px;color:#09090b;">${escapeHtml(data.code)}</td></tr></table>
</td></tr>
<tr><td style="padding:0 0 32px;font-size:14px;line-height:1.6;color:#52525b;">This code is valid for ${data.validMinutes} minutes. If you did not request it, please disregard this email.</td></tr>`;

    return {
        subject: `Your verification code for ${title}`,
        html: renderLayout({
            title: 'Verify your email address',
            preheader: `Your verification code is ${data.code}. It is valid for ${data.validMinutes} minutes.`,
            crestContentId: data.crestContentId,
            footerTitle: title,
            body,
        }),
    };
}
