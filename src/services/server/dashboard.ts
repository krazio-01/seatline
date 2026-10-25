import 'server-only';
import { Types } from 'mongoose';
import { connectDb } from '@/lib/db';
import { AuditLogModel, BookingModel, StudentModel, UserModel } from '@/models';
import type { DashboardSnapshot, DashboardStats, GateEvent } from '@/types/admin';
import type { ZoneName, ZoneOccupancy } from '@/types/booking';
import { countGuests } from './checkIns';
import { getEventSettings } from './settings';

type CheckerNameDocument = { _id: unknown; name: string };
type BookingSummaryDocument = { _id: unknown; studentName: string; seatCount: number };
type ZoneTotalsDocument = { _id: ZoneName; booked: number; checkedIn: number };

const GATE_EVENT_LIMIT = 20;
const CHECKER_ACTOR_PREFIX = 'checker:';

async function listGateEvents(): Promise<GateEvent[]> {
    const entries = await AuditLogModel.find(
        { action: { $in: ['checkin.success', 'checkin.duplicate'] } },
        null,
        { sort: { at: -1, _id: -1 }, limit: GATE_EVENT_LIMIT, lean: true },
    );

    const bookingIds = entries.flatMap((entry) =>
        entry.targetId && Types.ObjectId.isValid(entry.targetId) ? [entry.targetId] : [],
    );

    const checkerIdOf = (actor: string): string | undefined => {
        const candidate = actor.slice(CHECKER_ACTOR_PREFIX.length);

        return actor.startsWith(CHECKER_ACTOR_PREFIX) && Types.ObjectId.isValid(candidate)
            ? candidate
            : undefined;
    };

    const checkerIds = entries.flatMap((entry) => checkerIdOf(entry.actor) ?? []);

    const [bookings, checkers] = await Promise.all([
        BookingModel.find(
            { _id: { $in: bookingIds } },
            { studentName: 1, seatCount: 1 },
            { lean: true },
        ),
        UserModel.find({ _id: { $in: checkerIds } }, { name: 1 }, { lean: true }),
    ]);

    const bookingsById = new Map(
        (bookings as unknown as BookingSummaryDocument[]).map((booking) => [
            String(booking._id),
            booking,
        ]),
    );

    const checkerNamesById = new Map(
        (checkers as unknown as CheckerNameDocument[]).map((checker) => [
            String(checker._id),
            checker.name,
        ]),
    );

    return entries.map((entry) => {
        const booking = bookingsById.get(entry.targetId ?? '');
        const checkerId = checkerIdOf(entry.actor);

        return {
            id: String(entry._id),
            kind: entry.action === 'checkin.success' ? 'checkedIn' : 'alreadyCheckedIn',
            studentName: booking?.studentName ?? 'Unknown student',
            guestCount: booking?.seatCount ?? 0,
            checkerName: (checkerId && checkerNamesById.get(checkerId)) || 'Unknown checker',
            at: entry.at.toISOString(),
        };
    });
}

export async function getZoneOccupancy(): Promise<ZoneOccupancy[]> {
    await connectDb();

    const [settings, totals] = await Promise.all([
        getEventSettings(),
        BookingModel.aggregate<ZoneTotalsDocument>([
            {
                $group: {
                    _id: '$zone',
                    booked: { $sum: '$seatCount' },
                    checkedIn: {
                        $sum: { $cond: [{ $eq: ['$status', 'checkedIn'] }, '$seatCount', 0] },
                    },
                },
            },
        ]),
    ]);

    const totalsByZone = new Map(totals.map((total) => [total._id, total]));

    return settings.zones.map((zone) => ({
        name: zone.name,
        capacity: zone.capacity,
        booked: totalsByZone.get(zone.name)?.booked ?? 0,
        checkedIn: totalsByZone.get(zone.name)?.checkedIn ?? 0,
    }));
}

export async function getStats(): Promise<DashboardStats> {
    await connectDb();

    const [
        settings,
        bookings,
        checkedInBookings,
        emailPending,
        emailFailed,
        studentsTotal,
        studentsBooked,
        checkers,
        guestTotals,
    ] = await Promise.all([
        getEventSettings(),
        BookingModel.countDocuments(),
        BookingModel.countDocuments({ status: 'checkedIn' }),
        BookingModel.countDocuments({ 'email.status': 'pending' }),
        BookingModel.countDocuments({ 'email.status': 'failed' }),
        StudentModel.countDocuments(),
        StudentModel.countDocuments({ hasBooked: true }),
        UserModel.countDocuments({ role: 'checker', active: true }),
        countGuests(),
    ]);

    return {
        totalSeats: settings.totalSeats,
        seatsRemaining: settings.totalSeats - settings.allocatedSeats,
        bookings,
        guests: guestTotals.guests,
        checkedInBookings,
        checkedInGuests: guestTotals.checkedInGuests,
        emailPending,
        emailFailed,
        studentsTotal,
        studentsBooked,
        checkers,
    };
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
    await connectDb();

    const [settings, stats, zones, gateEvents] = await Promise.all([
        getEventSettings(),
        getStats(),
        getZoneOccupancy(),
        listGateEvents(),
    ]);

    return {
        event: {
            eventName: settings.eventName,
            eventDate: settings.eventDate.toISOString(),
            gatesOpenAt: settings.gatesOpenAt.toISOString(),
            venue: settings.venue,
        },
        stats,
        zones,
        gateEvents,
    };
}
