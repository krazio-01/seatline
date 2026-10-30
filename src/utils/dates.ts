export const APP_TIME_ZONE = 'Asia/Kolkata';
export const APP_LOCALE = 'en-IN';

const APP_UTC_OFFSET = '+05:30';

const DATE_FORMATS = {
    weekdayDayMonth: { weekday: 'short', day: 'numeric', month: 'short' },
    weekdayDayMonthTime: {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    },
    time: { hour: 'numeric', minute: '2-digit', hour12: true },
    year: { year: 'numeric' },
    fullDate: { dateStyle: 'full' },
    fullDateTime: { dateStyle: 'full', timeStyle: 'short' },
    inputDateTime: {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DateFormat = keyof typeof DATE_FORMATS;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(format: DateFormat, locale: string, timeZone: string) {
    const key = `${format}|${locale}|${timeZone}`;
    const cached = formatterCache.get(key);

    if (cached) return cached;

    const formatter = new Intl.DateTimeFormat(locale, { ...DATE_FORMATS[format], timeZone });
    formatterCache.set(key, formatter);

    return formatter;
}

function toCalendarTimestamp(date: Date): string {
    return date
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');
}

function escapeCalendarText(value: string): string {
    return value.replace(/[\\;,]/g, (character) => `\\${character}`).replace(/\r?\n/g, '\\n');
}

export function formatDate(
    date: Date,
    format: DateFormat,
    { locale = APP_LOCALE, timeZone = APP_TIME_ZONE } = {},
): string {
    const formatted = getFormatter(format, locale, timeZone).format(date);

    return formatted.replace(/\b[ap]m\b/i, (dayPeriod) => dayPeriod.toUpperCase());
}

export function minutesIntoDay(date: Date, timeZone = APP_TIME_ZONE): number {
    const [hours, minutes] = toDateTimeInputValue(date, timeZone).slice(-5).split(':');

    return Number(hours) * 60 + Number(minutes);
}

export function toDateTimeInputValue(date: Date, timeZone = APP_TIME_ZONE): string {
    return getFormatter('inputDateTime', 'sv-SE', timeZone).format(date).replace(' ', 'T');
}

export function fromDateTimeInputValue(value: string, utcOffset = APP_UTC_OFFSET): Date {
    return new Date(`${value}:00${utcOffset}`);
}

export function toCalendarEvent(event: {
    id: string;
    title: string;
    start: Date;
    location: string;
    description: string;
    createdAt?: Date;
}): string {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Campus Event//Registration//EN',
        'BEGIN:VEVENT',
        `UID:${event.id}`,
        `DTSTAMP:${toCalendarTimestamp(event.createdAt ?? new Date())}`,
        `DTSTART:${toCalendarTimestamp(event.start)}`,
        `SUMMARY:${escapeCalendarText(event.title)}`,
        `LOCATION:${escapeCalendarText(event.location)}`,
        `DESCRIPTION:${escapeCalendarText(event.description)}`,
        'END:VEVENT',
        'END:VCALENDAR',
    ];

    return `${lines.join('\r\n')}\r\n`;
}
