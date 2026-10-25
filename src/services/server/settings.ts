import 'server-only';
import { z } from 'zod';
import { connectDb } from '@/lib/db';
import { NotFoundError, SettingsConflictError } from '@/lib/errors';
import { EVENT_SETTINGS_KEY, SettingsModel, type SettingsDocument } from '@/models';
import type { EventSettings, EventSettingsFields } from '@/types/admin';
import { EVENT_ZONES, type EventZone, type ZoneName } from '@/types/booking';

const trimmedText = z.string().trim();

const wholeNumber = z.number().int();

const zoneCapacity = wholeNumber.min(0).max(1000);

const zoneCapacitiesSchema = z.object(
    Object.fromEntries(EVENT_ZONES.map((zone) => [zone, zoneCapacity])) as Record<
        ZoneName,
        typeof zoneCapacity
    >,
);

const settingsFields = z.object({
    eventName: trimmedText.min(1).max(120),
    eventDate: z.coerce.date(),
    gatesOpenAt: z.coerce.date(),
    venue: trimmedText.min(1).max(160),
    zoneCapacities: zoneCapacitiesSchema,
    maxGuestsPerBooking: wholeNumber.min(1).max(10),
    bookingsOpen: z.boolean(),
});

const settingsWithSeats = settingsFields.refine(
    (settings) => Object.values(settings.zoneCapacities).some((capacity) => capacity > 0),
    { message: 'Give at least one zone some seats', path: ['zoneCapacities'] },
);

export const updateSettingsSchema: z.ZodType<EventSettingsFields, unknown> =
    settingsWithSeats.refine((settings) => settings.gatesOpenAt <= settings.eventDate, {
        message: 'Gates must open on or before the event starts',
        path: ['gatesOpenAt'],
    });

function toEventSettings(settings: SettingsDocument): EventSettings {
    const zones: EventZone[] = settings.zones.map((zone) => ({
        name: zone.name,
        capacity: zone.capacity,
        allocated: zone.allocated,
    }));

    return {
        eventName: settings.eventName,
        eventDate: settings.eventDate,
        gatesOpenAt: settings.gatesOpenAt ?? settings.eventDate,
        venue: settings.venue,
        maxGuestsPerBooking: settings.maxGuestsPerBooking,
        bookingsOpen: settings.bookingsOpen,
        zones,
        totalSeats: zones.reduce((seats, zone) => seats + zone.capacity, 0),
        allocatedSeats: zones.reduce((seats, zone) => seats + zone.allocated, 0),
    };
}

export function pickZone(zones: EventZone[], partySize: number): ZoneName | null {
    const zoneWithRoom = EVENT_ZONES.find((name) => {
        const zone = zones.find((candidate) => candidate.name === name);

        return zone !== undefined && zone.capacity - zone.allocated >= partySize;
    });

    return zoneWithRoom ?? null;
}

export async function findEventSettings(): Promise<EventSettings | null> {
    await connectDb();

    const settings = await SettingsModel.findOne({ key: EVENT_SETTINGS_KEY }).lean();

    return settings ? toEventSettings(settings) : null;
}

export async function getEventSettings(): Promise<EventSettings> {
    const settings = await findEventSettings();
    if (!settings) throw new NotFoundError('Event settings are not configured');

    return settings;
}

export async function updateEventSettings(input: EventSettingsFields): Promise<EventSettings> {
    await connectDb();

    const { zoneCapacities, ...fields } = input;

    if (input.maxGuestsPerBooking > Math.max(...Object.values(zoneCapacities))) {
        throw new SettingsConflictError('The guest limit cannot be larger than the biggest zone.');
    }

    const capacityUpdates = Object.fromEntries(
        EVENT_ZONES.map((zone) => [`zones.$[zone${zone}].capacity`, zoneCapacities[zone]]),
    );

    const updated = await SettingsModel.findOneAndUpdate(
        {
            key: EVENT_SETTINGS_KEY,
            zones: {
                $all: EVENT_ZONES.map((zone) => ({
                    $elemMatch: { name: zone, allocated: { $lte: zoneCapacities[zone] } },
                })),
            },
        },
        { $set: { ...fields, ...capacityUpdates } },
        {
            returnDocument: 'after',
            arrayFilters: EVENT_ZONES.map((zone) => ({ [`zone${zone}.name`]: zone })),
        },
    ).lean();
    if (updated) return toEventSettings(updated);

    await getEventSettings();

    throw new SettingsConflictError(
        'A zone cannot shrink below the seats already allocated in it.',
    );
}
