import 'server-only';
import mongoose, { type ClientSession, type Types } from 'mongoose';
import sharp from 'sharp';
import { z } from 'zod';
import { connectDb, pagingQueryFields, resolvePaging } from '@/lib/db';
import {
    AadhaarPhotoRejectedError,
    BookingsClosedError,
    IdempotencyKeyConflictError,
    NotEnoughSeatsError,
    NotFoundError,
    StudentAlreadyBookedError,
    TooManyGuestsError,
    ValidationError,
} from '@/lib/errors';
import { writeAudit } from '@/lib/logger';
import {
    decryptBytes,
    decryptField,
    encryptBytes,
    encryptField,
    hashField,
} from '@/lib/security/encryption';
import { generateQrToken, signPhotoToken, verifyPhotoToken } from '@/lib/security/tokens';
import {
    AadhaarPhotoModel,
    type BookingDocument,
    BookingModel,
    EVENT_SETTINGS_KEY,
    SettingsModel,
    StudentModel,
} from '@/models';
import type { RecognizedWord, TextRecognizer } from '@/providers/text-recognition';
import type { BookingListQuery, BookingPage, BookingRow } from '@/types/admin';
import {
    AADHAAR_GROUP_SIZE,
    AADHAAR_LENGTH,
    type BookingConfirmation,
    type CreateBookingInput,
    EVENT_ZONES,
    type ZoneName,
} from '@/types/booking';
import { escapeRegex, groupCharacters, maskEmail, maskStart } from '@/utils/text';
import { toEmailDelivery } from './emails';
import { pickZone } from './settings';

type BookingWithTimestamps = BookingDocument & { _id: unknown; createdAt: Date };
export type RevealedGuest = { name: string; aadhaar: string | null; hasPhoto: boolean };

type PhotoUpload = { image: Buffer; aadhaar: string; name: string };

type ReadCard = { image: Buffer; words: RecognizedWord[]; match: NumberMatch };

type GuestPhoto = { name: string; aadhaar: string; photoId: string };

export type NumberMatch =
    { status: 'match'; words: RecognizedWord[] } | { status: 'mismatch' } | { status: 'missing' };

type Box = RecognizedWord['box'];

export type MaskPlan = { visible: Box[]; covered: Box[] };

const DUPLICATE_KEY_ERROR_CODE = 11000;
const PHOTO_LONGEST_SIDE = 1600;
const PHOTO_JPEG_QUALITY = 80;
const RETRY_ROTATIONS = [90, 270];
const PENDING_PHOTO_MS = 60 * 60 * 1000;
const MASK_COLOR = '#000000';
const MAX_INPUT_PIXELS = 40_000_000;
const IMAGE_INPUT = { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS } as const;
const PHOTO_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MASK_ID = 'card-mask';
const COVER_FILL = 'white';
const KEEP_FILL = 'black';
const MAX_NUMBER_GROUPS = 3;
const MASK_PADDING = 4;

export const PHOTO_REJECTIONS = {
    missing:
        "We couldn't read the Aadhaar number on this photo. Retake it in good light with the whole card in view.",
    mismatch: "This card doesn't match the Aadhaar number you entered.",
    unreadable: "We couldn't open this photo. Take a new one or choose a JPEG, PNG or WebP photo.",
    name: "We couldn't read the name on this card. Retake it so the name and number are clear, and check the name matches the card.",
};

export const bookingListQuerySchema: z.ZodType<BookingListQuery, unknown> = z.object({
    search: z.string().trim().max(100).optional(),
    status: z.enum(['confirmed', 'checkedIn']).optional(),
    emailStatus: z.enum(['pending', 'sent', 'failed']).optional(),
    zone: z.enum(EVENT_ZONES).optional(),
    ...pagingQueryFields,
});

function toConfirmation(
    booking: {
        _id: unknown;
        studentId: unknown;
        zone: ZoneName;
        seatCount: number;
        guests: { email: string }[];
    },
    requestedStudentId: string,
): BookingConfirmation {
    if (String(booking.studentId) !== requestedStudentId) throw new IdempotencyKeyConflictError();

    return {
        bookingId: String(booking._id),
        zone: booking.zone,
        seatCount: booking.seatCount,
        primaryEmailMasked: maskEmail(booking.guests[0].email),
    };
}

async function bookInTransaction(
    input: CreateBookingInput,
    session: ClientSession,
): Promise<BookingConfirmation> {
    const replay = await BookingModel.findOne({ idempotencyKey: input.idempotencyKey }, null, {
        session,
        lean: true,
    });
    if (replay) return toConfirmation(replay, input.studentId);

    const settings = await SettingsModel.findOne({ key: EVENT_SETTINGS_KEY }, null, { session });
    if (!settings) throw new NotFoundError('Event settings are not configured');
    if (!settings.bookingsOpen) throw new BookingsClosedError();

    if (input.guests.length > settings.maxGuestsPerBooking) {
        throw new TooManyGuestsError(settings.maxGuestsPerBooking);
    }

    const zone = pickZone(settings.zones, input.guests.length);
    if (!zone) throw new NotEnoughSeatsError();

    await SettingsModel.updateOne(
        { key: EVENT_SETTINGS_KEY, 'zones.name': zone },
        { $inc: { 'zones.$.allocated': input.guests.length } },
        { session },
    );

    const student = await StudentModel.findOneAndUpdate(
        { _id: input.studentId, hasBooked: false },
        { $set: { hasBooked: true } },
        { session },
    );
    if (!student) throw new StudentAlreadyBookedError();

    const [booking] = await BookingModel.create(
        [
            {
                studentId: student._id,
                studentName: student.name,
                studentGroup: student.group,
                idempotencyKey: input.idempotencyKey,
                qrToken: generateQrToken(),
                email: { status: 'pending', attempts: 0 },
                zone,
                seatCount: input.guests.length,
                guests: input.guests.map((guest) => ({
                    name: guest.name,
                    aadhaarEncrypted: encryptField(guest.aadhaar),
                    aadhaarLast4: guest.aadhaar.slice(-4),
                    phone: guest.phone,
                    email: guest.email,
                    photoId: guest.photoId,
                })),
            },
        ],
        { session },
    );

    await attachGuestPhotos(booking._id, input.guests, session);

    return toConfirmation(booking, input.studentId);
}

function toRow(booking: BookingWithTimestamps): BookingRow {
    return {
        id: String(booking._id),
        studentName: booking.studentName,
        studentGroup: booking.studentGroup,
        zone: booking.zone,
        seatCount: booking.seatCount,
        status: booking.status,
        email: toEmailDelivery(booking.email),
        checkedInAt: booking.checkedInAt?.toISOString() ?? null,
        checkedInByName: booking.checkedInByName ?? null,
        createdAt: booking.createdAt.toISOString(),
        guests: booking.guests.map((guest) => ({
            name: guest.name,
            phone: guest.phone,
            email: guest.email,
            aadhaarMasked: guest.aadhaarLast4
                ? groupCharacters(maskStart(guest.aadhaarLast4, AADHAAR_LENGTH), AADHAAR_GROUP_SIZE)
                : null,
            hasPhoto: Boolean(guest.photoId),
        })),
    };
}

function digitsOf(word: RecognizedWord): string | null {
    if (/\p{L}/u.test(word.text)) return null;

    const digits = word.text.replace(/\D/g, '');

    return digits.length > 0 ? digits : null;
}

function isNumberGroup(word: RecognizedWord | undefined): boolean {
    return word !== undefined && /^\d{4}$/.test(word.text.trim());
}

function isLettersOnly(text: string): boolean {
    return /^\p{L}+$/u.test(text.replace(/[^\p{L}\p{N}]/gu, ''));
}

function overlaps(box: Box, area: Box): boolean {
    return (
        box.x < area.x + area.width &&
        box.x + box.width > area.x &&
        box.y < area.y + area.height &&
        box.y + box.height > area.y
    );
}

function lettersOf(text: string): string {
    return text.toLowerCase().replace(/[^\p{L}]/gu, '');
}

function padBox({ x, y, width, height }: Box): Box {
    const left = Math.max(0, x - MASK_PADDING);
    const top = Math.max(0, y - MASK_PADDING);

    return {
        x: left,
        y: top,
        width: x + width + MASK_PADDING - left,
        height: y + height + MASK_PADDING - top,
    };
}

async function readImageFormat(image: Buffer): Promise<string | undefined> {
    try {
        const metadata = await sharp(image, IMAGE_INPUT).metadata();

        return metadata.format;
    } catch {
        return undefined;
    }
}

async function normalizeImage(image: Buffer): Promise<Buffer> {
    const format = await readImageFormat(image);
    if (!format || !PHOTO_FORMATS.has(format)) {
        throw new AadhaarPhotoRejectedError(PHOTO_REJECTIONS.unreadable);
    }

    const pipeline = sharp(image, IMAGE_INPUT);

    pipeline.rotate();
    pipeline.resize({
        width: PHOTO_LONGEST_SIDE,
        height: PHOTO_LONGEST_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
    });
    pipeline.jpeg({ quality: PHOTO_JPEG_QUALITY });

    return pipeline.toBuffer().catch(() => {
        throw new AadhaarPhotoRejectedError(PHOTO_REJECTIONS.unreadable);
    });
}

async function rotateImage(image: Buffer, degrees: number): Promise<Buffer> {
    const pipeline = sharp(image);

    pipeline.rotate(degrees);
    pipeline.jpeg({ quality: PHOTO_JPEG_QUALITY });

    return pipeline.toBuffer();
}

async function readCard(
    upright: Buffer,
    aadhaar: string,
    recognizer: TextRecognizer,
): Promise<ReadCard> {
    let read = { image: upright, words: await recognizer.recognize(upright) };
    let match = findAadhaarNumber(read.words, aadhaar);

    for (const degrees of RETRY_ROTATIONS) {
        if (match.status !== 'missing') break;

        const image = await rotateImage(upright, degrees);
        read = { image, words: await recognizer.recognize(image) };
        match = findAadhaarNumber(read.words, aadhaar);
    }

    return { ...read, match };
}

function svgRect(box: Box, fill: string): string {
    return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${fill}"/>`;
}

async function maskImage(image: Buffer, plan: MaskPlan, width: number, height: number) {
    const keep = plan.visible.map((box) => svgRect(box, KEEP_FILL)).join('');
    const covered = plan.covered.map((box) => svgRect(box, MASK_COLOR)).join('');
    const page = { x: 0, y: 0, width, height };
    const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><mask id="${MASK_ID}">${svgRect(page, COVER_FILL)}${keep}</mask></defs><rect width="${width}" height="${height}" fill="${MASK_COLOR}" mask="url(#${MASK_ID})"/>${covered}</svg>`;

    const pipeline = sharp(image);

    pipeline.composite([{ input: Buffer.from(overlay), top: 0, left: 0 }]);
    pipeline.jpeg({ quality: PHOTO_JPEG_QUALITY });

    return pipeline.toBuffer();
}

export async function createBooking(input: CreateBookingInput): Promise<BookingConfirmation> {
    await connectDb();

    try {
        return await mongoose.connection.transaction((session) =>
            bookInTransaction(input, session),
        );
    } catch (error) {
        if (
            !(error instanceof mongoose.mongo.MongoServerError) ||
            error.code !== DUPLICATE_KEY_ERROR_CODE
        ) {
            throw error;
        }

        const existing = await BookingModel.findOne(
            { idempotencyKey: input.idempotencyKey },
            null,
            { lean: true },
        );
        if (existing) return toConfirmation(existing, input.studentId);

        throw new StudentAlreadyBookedError();
    }
}

export async function listBookings(query: BookingListQuery): Promise<BookingPage> {
    await connectDb();

    const { page, pageSize, skip } = resolvePaging(query);
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.emailStatus) filter['email.status'] = query.emailStatus;
    if (query.zone) filter.zone = query.zone;

    const search = query.search?.trim();
    if (search) {
        const pattern = new RegExp(escapeRegex(search), 'i');
        filter.$or = [
            { studentName: pattern },
            { 'guests.name': pattern },
            { 'guests.phone': pattern },
            { 'guests.email': pattern },
        ];
    }

    const [bookings, total] = await Promise.all([
        BookingModel.find(filter, null, {
            sort: { createdAt: -1, _id: -1 },
            skip,
            limit: pageSize,
            lean: true,
        }),
        BookingModel.countDocuments(filter),
    ]);

    return {
        items: (bookings as unknown as BookingWithTimestamps[]).map(toRow),
        total,
        page,
        pageSize,
    };
}

export async function purgeAadhaar(
    actor: string,
    ip?: string,
): Promise<{ bookingsUpdated: number }> {
    await connectDb();
    await writeAudit({ actor, action: 'admin.purge_aadhaar', ip });

    const result = await BookingModel.updateMany(
        {},
        {
            $set: {
                'guests.$[].aadhaarEncrypted': null,
                'guests.$[].aadhaarLast4': null,
                'guests.$[].photoId': null,
            },
        },
    );

    await AadhaarPhotoModel.deleteMany({});

    return { bookingsUpdated: result.modifiedCount };
}

export async function revealAadhaar(
    bookingId: string,
    actor: string,
    ip?: string,
): Promise<RevealedGuest[]> {
    if (!mongoose.isValidObjectId(bookingId)) throw new NotFoundError('Booking not found');

    await connectDb();

    const booking = await BookingModel.findById(bookingId, null, { lean: true });
    if (!booking) throw new NotFoundError('Booking not found');

    await writeAudit({ actor, action: 'admin.reveal_aadhaar', targetId: bookingId, ip });

    return booking.guests.map((guest) => ({
        name: guest.name,
        aadhaar: guest.aadhaarEncrypted ? decryptField(guest.aadhaarEncrypted) : null,
        hasPhoto: Boolean(guest.photoId),
    }));
}

export function findAadhaarNumber(words: RecognizedWord[], aadhaar: string): NumberMatch {
    let hasOtherNumber = false;

    for (let start = 0; start < words.length; start += 1) {
        let digits = '';

        for (let end = start; end < Math.min(words.length, start + MAX_NUMBER_GROUPS); end += 1) {
            const wordDigits = digitsOf(words[end]);
            if (!wordDigits) break;

            digits += wordDigits;
            if (digits.length > AADHAAR_LENGTH) break;
            if (digits.length < AADHAAR_LENGTH) continue;

            if (digits === aadhaar) return { status: 'match', words: words.slice(start, end + 1) };

            const isPartOfLongerNumber =
                isNumberGroup(words[start - 1]) || isNumberGroup(words[end + 1]);

            if (/^[2-9]/.test(digits) && !isPartOfLongerNumber) hasOtherNumber = true;
        }
    }

    return hasOtherNumber ? { status: 'mismatch' } : { status: 'missing' };
}

export function maskPlan(
    words: RecognizedWord[],
    guestName: string,
    numberWords: RecognizedWord[],
    size: { width: number; height: number },
): MaskPlan | null {
    const typedWords = guestName.split(/\s+/);
    const nameParts = new Set(typedWords.map(lettersOf).filter((part) => part.length > 0));
    const numberSet = new Set(numberWords);

    const nameWords = words.filter(
        (word) =>
            !numberSet.has(word) && isLettersOnly(word.text) && nameParts.has(lettersOf(word.text)),
    );
    if (nameWords.length === 0) return null;

    const faceRight = Math.min(...nameWords.map((word) => word.box.x)) - MASK_PADDING * 2;
    const numberTop = Math.min(size.height, ...numberWords.map((word) => word.box.y));
    const faceBottom = numberTop - MASK_PADDING * 2;
    const face =
        faceRight > 0 && faceBottom > 0
            ? { x: 0, y: 0, width: Math.min(faceRight, size.width), height: faceBottom }
            : null;

    const covered = face
        ? words.filter((word) => !nameWords.includes(word) && overlaps(word.box, face))
        : [];

    return {
        visible: [...(face ? [face] : []), ...nameWords.map((word) => word.box)],
        covered: covered.map((word) => padBox(word.box)),
    };
}

export function guestNameHash(name: string): string {
    const words = name.toLowerCase().split(/\s+/);

    return hashField(`name:${words.filter((word) => word.length > 0).join(' ')}`);
}

export async function storeAadhaarPhoto(
    upload: PhotoUpload,
    recognizer: TextRecognizer,
): Promise<{ photoId: string }> {
    const upright = await normalizeImage(upload.image);
    const { image, words, match } = await readCard(upright, upload.aadhaar, recognizer);

    if (match.status !== 'match')
        throw new AadhaarPhotoRejectedError(PHOTO_REJECTIONS[match.status]);

    const { width = 0, height = 0 } = await sharp(image).metadata();
    const plan = maskPlan(words, upload.name, match.words, { width, height });
    if (!plan) throw new AadhaarPhotoRejectedError(PHOTO_REJECTIONS.name);

    const masked = await maskImage(image, plan, width, height);

    await connectDb();

    const photo = await AadhaarPhotoModel.create({
        original: encryptBytes(image),
        masked: encryptBytes(masked),
        aadhaarHash: hashField(upload.aadhaar),
        nameHash: guestNameHash(upload.name),
        expiresAt: new Date(Date.now() + PENDING_PHOTO_MS),
    });

    return { photoId: String(photo._id) };
}

export async function attachGuestPhotos(
    bookingId: Types.ObjectId,
    guests: GuestPhoto[],
    session: ClientSession,
): Promise<void> {
    const now = new Date();

    for (const [guestIndex, guest] of guests.entries()) {
        const { matchedCount } = await AadhaarPhotoModel.updateOne(
            {
                _id: guest.photoId,
                status: 'pending',
                expiresAt: { $gt: now },
                aadhaarHash: hashField(guest.aadhaar),
                nameHash: guestNameHash(guest.name),
            },
            { $set: { status: 'attached', bookingId, guestIndex, expiresAt: null } },
            { session },
        );

        if (matchedCount === 0) {
            throw new ValidationError([
                { path: `guests.${guestIndex}.photoId`, message: 'Upload the Aadhaar card again' },
            ]);
        }
    }
}

export function issuePhotoToken(photoId: string, checkerId: string): Promise<string> {
    return signPhotoToken({ photoId, checkerId });
}

export async function readMaskedPhoto(
    token: string,
    checkerId: string,
    ip?: string,
): Promise<Buffer> {
    const claims = await verifyPhotoToken(token);
    if (!claims || claims.checkerId !== checkerId) throw new NotFoundError('Photo not found');

    await connectDb();

    const photo = await AadhaarPhotoModel.findOne(
        { _id: claims.photoId, status: 'attached' },
        { masked: 1, bookingId: 1 },
    );
    if (!photo) throw new NotFoundError('Photo not found');

    await writeAudit({
        actor: `checker:${checkerId}`,
        action: 'checker.view_aadhaar_photo',
        targetId: String(photo.bookingId),
        ip,
    });

    return decryptBytes(photo.masked);
}

export async function readOriginalPhoto(
    bookingId: string,
    guestIndex: number,
    actor: string,
    ip?: string,
): Promise<Buffer> {
    if (!mongoose.isValidObjectId(bookingId)) throw new NotFoundError('Photo not found');

    await connectDb();

    const photo = await AadhaarPhotoModel.findOne(
        { bookingId, guestIndex, status: 'attached' },
        { original: 1 },
    );
    if (!photo) throw new NotFoundError('Photo not found');

    await writeAudit({ actor, action: 'admin.view_aadhaar_photo', targetId: bookingId, ip });

    return decryptBytes(photo.original);
}

export async function deleteBookingPhotos(
    bookingId: string,
    actor: string,
    ip?: string,
): Promise<{ deleted: number }> {
    if (!mongoose.isValidObjectId(bookingId)) throw new NotFoundError('Booking not found');

    await connectDb();

    const booking = await BookingModel.findByIdAndUpdate(bookingId, {
        $set: { 'guests.$[].photoId': null },
    });
    if (!booking) throw new NotFoundError('Booking not found');

    const { deletedCount } = await AadhaarPhotoModel.deleteMany({ bookingId });

    await writeAudit({ actor, action: 'admin.delete_aadhaar_photos', targetId: bookingId, ip });

    return { deleted: deletedCount };
}
