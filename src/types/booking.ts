import { z } from 'zod/mini';

export type CreateBookingInput = Omit<CreateBookingBody, 'botToken' | 'emailVerificationToken'> & {
    idempotencyKey: string;
};

export type EventZone = { name: ZoneName; capacity: number; allocated: number };

export type ZoneOccupancy = { name: ZoneName; capacity: number; booked: number; checkedIn: number };

export type ZoneBooking = { zone: ZoneName; seatCount: number };

export type EmailStatus = 'pending' | 'sent' | 'failed';

export type EmailDelivery = {
    status: EmailStatus;
    sentAt: string | null;
    attempts: number;
    lastError: string | null;
};

export type StudentOption = { id: string; name: string; group: string };

export type BookingConfirmation = {
    bookingId: string;
    primaryEmailMasked: string;
} & ZoneBooking;

export type CheckInGuest = {
    name: string;
    aadhaarMasked: string | null;
    photoToken: string | null;
};

export type CheckInBooking = {
    studentName: string;
    studentGroup: string;
    guests: CheckInGuest[];
} & ZoneBooking;

export type GateProgress = { guestsIn: number; guestsExpected: number; eventStartsAt: string };

export type CheckInResult =
    | ({ outcome: 'checked_in' } & CheckInBooking)
    | ({
          outcome: 'already_checked_in';
          checkedInAt: string;
          checkedInByName: string | null;
          isOwnCheckIn: boolean;
      } & CheckInBooking)
    | { outcome: 'invalid' };

export const MAX_GUESTS_HARD_LIMIT = 10;
export const VERIFICATION_CODE_LENGTH = 6;
export const AADHAAR_LENGTH = 12;
export const AADHAAR_GROUP_SIZE = 4;
export const PHONE_LENGTH = 10;
export const PHONE_GROUP_SIZES = [5, 5];
export const EVENT_ZONES = ['C', 'D'] as const;
export const ZONE_LABELS: Record<ZoneName, string> = { C: 'Zone C', D: 'Zone D' };
export const AADHAAR_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_AADHAAR_PHOTO_BYTES = 4 * 1024 * 1024;
const PHOTO_REQUIRED_MESSAGE = 'Upload the front of the Aadhaar card';

const trimmedText = z.string().check(z.trim());

const trimmedLowercase = z.string().check(z.trim(), z.toLowerCase());

const lowercaseText = z.string().check(z.toLowerCase());

const tokenText = z.string().check(z.maxLength(2048));

const aadhaarDigits = z.pipe(z.string(), z.transform(stripSeparators));

const phoneDigits = z.pipe(z.string(), z.transform(stripPhonePrefix));

export const emailSchema = z.pipe(
    trimmedLowercase,
    z.email('Enter a valid email address').check(z.maxLength(254)),
);

export const guestInputSchema = z.object({
    name: trimmedText.check(z.minLength(2, 'Enter the guest name'), z.maxLength(100)),
    aadhaar: z.pipe(
        aadhaarDigits,
        z.string().check(z.regex(/^[2-9]\d{11}$/, 'Enter a valid 12-digit Aadhaar number')),
    ),
    phone: z.pipe(
        phoneDigits,
        z.string().check(z.regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')),
    ),
    email: emailSchema,
    photoId: z
        .string(PHOTO_REQUIRED_MESSAGE)
        .check(z.regex(/^[a-f\d]{24}$/, PHOTO_REQUIRED_MESSAGE)),
});

export const aadhaarPhotoUploadSchema = z.object({
    image: z
        .file()
        .check(
            z.mime(AADHAAR_PHOTO_TYPES, 'Upload a JPEG, PNG or WebP photo'),
            z.maxSize(MAX_AADHAAR_PHOTO_BYTES, 'Upload a photo smaller than 4 MB'),
        ),
    name: guestInputSchema.shape.name,
    aadhaar: guestInputSchema.shape.aadhaar,
});

const guestListSchema = z
    .array(guestInputSchema)
    .check(z.minLength(1, 'Add at least one guest'), z.maxLength(MAX_GUESTS_HARD_LIMIT));

export const createBookingBodySchema = z
    .object({
        studentId: lowercaseText.check(z.regex(/^[a-f\d]{24}$/, 'Select a student')),
        guests: guestListSchema,
        botToken: z.optional(tokenText),
        emailVerificationToken: tokenText.check(
            z.minLength(20, 'Verify the email address of Guest 1'),
        ),
    })
    .check(
        z.superRefine((booking, context) => {
            const seenAadhaar = new Set<string>();
            booking.guests.forEach((guest, index) => {
                if (seenAadhaar.has(guest.aadhaar)) {
                    context.addIssue({
                        code: 'custom',
                        path: ['guests', index, 'aadhaar'],
                        message: 'This Aadhaar number is already used for another guest',
                    });
                }

                seenAadhaar.add(guest.aadhaar);
            });
        }),
    );

export const idempotencyKeySchema = z.uuid();

export const startEmailVerificationSchema = z.object({
    email: emailSchema,
    botToken: z.optional(tokenText),
});

export const confirmEmailVerificationSchema = z.object({
    code: z
        .string()
        .check(
            z.regex(
                new RegExp(`^\\d{${VERIFICATION_CODE_LENGTH}}$`),
                `Enter the ${VERIFICATION_CODE_LENGTH}-digit code`,
            ),
        ),
});

export type CreateBookingBody = z.output<typeof createBookingBodySchema>;

export type CreateBookingFormValues = z.input<typeof createBookingBodySchema>;

export type ZoneName = (typeof EVENT_ZONES)[number];

function stripSeparators(value: string): string {
    return value.replace(/[\s-]/g, '');
}

function stripPhonePrefix(value: string): string {
    return stripSeparators(value).replace(/^(\+91|0)/, '');
}
