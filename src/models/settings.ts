import { type InferSchemaType, type Model, model, models, Schema } from 'mongoose';
import { EVENT_ZONES } from '@/types/booking';

export const EVENT_SETTINGS_KEY = 'event';

export const EVENT_DEFAULTS = {
    eventName: 'Passing Out Parade',
    startsAt: { hour: 7, minute: 30 },
    gatesOpenMinutesBefore: 30,
    maxGuestsPerBooking: 2,
    zones: [
        { name: 'C', capacity: 115 },
        { name: 'D', capacity: 115 },
    ],
} as const;

const zoneSchema = new Schema(
    {
        name: { type: String, enum: EVENT_ZONES, required: true },
        capacity: { type: Number, required: true, min: 0 },
        allocated: { type: Number, default: 0, min: 0 },
    },
    { _id: false },
);

const settingsSchema = new Schema(
    {
        key: { type: String, required: true, unique: true, default: EVENT_SETTINGS_KEY },
        eventName: { type: String, required: true },
        eventDate: { type: Date, required: true },
        gatesOpenAt: { type: Date, required: true },
        venue: { type: String, required: true },
        zones: {
            type: [zoneSchema],
            default: () => EVENT_DEFAULTS.zones.map((zone) => ({ ...zone, allocated: 0 })),
        },
        maxGuestsPerBooking: { type: Number, default: EVENT_DEFAULTS.maxGuestsPerBooking, min: 1 },
        bookingsOpen: { type: Boolean, default: true },
    },
    { timestamps: true },
);

export type SettingsDocument = InferSchemaType<typeof settingsSchema>;

const SettingsModel: Model<SettingsDocument> = models.Settings || model('Settings', settingsSchema);

export default SettingsModel;
