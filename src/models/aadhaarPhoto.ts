import { type InferSchemaType, type Model, model, models, Schema } from 'mongoose';
import { CARD_CHECKS } from '@/types/booking';

export const AADHAAR_PHOTO_STATUSES = ['pending', 'attached'] as const;

const aadhaarPhotoSchema = new Schema(
    {
        original: { type: Buffer, required: true },
        masked: { type: Buffer, default: null },
        cardCheck: { type: String, enum: CARD_CHECKS, default: 'verified' },
        aadhaarHash: { type: String, required: true },
        nameHash: { type: String, required: true },
        status: { type: String, enum: AADHAAR_PHOTO_STATUSES, default: 'pending' },
        bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
        guestIndex: { type: Number, default: null },
        expiresAt: { type: Date, default: null },
    },
    { timestamps: true },
);

aadhaarPhotoSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
aadhaarPhotoSchema.index({ bookingId: 1 });

export type AadhaarPhotoDocument = InferSchemaType<typeof aadhaarPhotoSchema>;

const AadhaarPhotoModel: Model<AadhaarPhotoDocument> =
    models.AadhaarPhoto || model('AadhaarPhoto', aadhaarPhotoSchema);

export default AadhaarPhotoModel;
