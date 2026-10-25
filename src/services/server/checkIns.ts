import 'server-only';
import { connectDb } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { isWellFormedQrToken } from '@/lib/security/tokens';
import { type BookingDocument, BookingModel } from '@/models';
import {
    AADHAAR_GROUP_SIZE,
    AADHAAR_LENGTH,
    type CheckInBooking,
    type CheckInResult,
    type GateProgress,
} from '@/types/booking';
import { groupCharacters, maskStart } from '@/utils/text';
import { writeAudit } from '@/lib/logger';
import { issuePhotoToken } from './bookings';
import { findEventSettings } from './settings';

export type CheckerIdentity = { id: string; name: string };

export type GuestTotals = { guests: number; checkedInGuests: number };

async function summarize(booking: BookingDocument, checkerId: string): Promise<CheckInBooking> {
    const guests = await Promise.all(
        booking.guests.map(async (guest) => ({
            name: guest.name,
            aadhaarMasked: guest.aadhaarLast4
                ? groupCharacters(maskStart(guest.aadhaarLast4, AADHAAR_LENGTH), AADHAAR_GROUP_SIZE)
                : null,
            photoToken: guest.photoId
                ? await issuePhotoToken(String(guest.photoId), checkerId)
                : null,
        })),
    );

    return {
        studentName: booking.studentName,
        studentGroup: booking.studentGroup,
        zone: booking.zone,
        seatCount: booking.seatCount,
        guests,
    };
}

export async function checkInByToken(
    token: string,
    checker: CheckerIdentity,
    ip?: string,
): Promise<CheckInResult> {
    if (!isWellFormedQrToken(token)) return { outcome: 'invalid' };

    await connectDb();

    const actor = `checker:${checker.id}`;

    const checkedIn = await BookingModel.findOneAndUpdate(
        { qrToken: token, status: 'confirmed' },
        {
            $set: {
                status: 'checkedIn',
                checkedInAt: new Date(),
                checkedInBy: checker.id,
                checkedInByName: checker.name,
            },
        },
        { returnDocument: 'after', lean: true },
    );

    if (checkedIn) {
        await writeAudit({ actor, action: 'checkin.success', targetId: String(checkedIn._id), ip });
        return { outcome: 'checked_in', ...(await summarize(checkedIn, checker.id)) };
    }

    const existing = await BookingModel.findOne({ qrToken: token }, null, { lean: true });
    if (!existing) return { outcome: 'invalid' };

    await writeAudit({ actor, action: 'checkin.duplicate', targetId: String(existing._id), ip });

    return {
        outcome: 'already_checked_in',
        checkedInAt: existing.checkedInAt?.toISOString() ?? '',
        checkedInByName: existing.checkedInByName ?? null,
        isOwnCheckIn: existing.checkedInBy === checker.id,
        ...(await summarize(existing, checker.id)),
    };
}

export async function countGuests(): Promise<GuestTotals> {
    await connectDb();

    const [totals] = await BookingModel.aggregate<GuestTotals>([
        {
            $group: {
                _id: null,
                guests: { $sum: '$seatCount' },
                checkedInGuests: {
                    $sum: { $cond: [{ $eq: ['$status', 'checkedIn'] }, '$seatCount', 0] },
                },
            },
        },
    ]);

    return { guests: totals?.guests ?? 0, checkedInGuests: totals?.checkedInGuests ?? 0 };
}

export async function findGateProgress(): Promise<GateProgress | null> {
    const [settings, totals] = await Promise.all([findEventSettings(), countGuests()]);

    if (!settings) return null;

    return {
        guestsIn: totals.checkedInGuests,
        guestsExpected: totals.guests,
        eventStartsAt: settings.eventDate.toISOString(),
    };
}

export async function getGateProgress(): Promise<GateProgress> {
    const progress = await findGateProgress();
    if (!progress) throw new NotFoundError('Event settings are not configured');

    return progress;
}
