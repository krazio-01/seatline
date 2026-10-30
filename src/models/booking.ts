import { type InferSchemaType, type Model, model, models, Schema } from 'mongoose';
import { CARD_CHECKS, EVENT_ZONES } from '@/types/booking';

const guestSchema = new Schema(
    {
        name: { type: String, required: true },
        aadhaarEncrypted: { type: String, default: null },
        aadhaarLast4: { type: String, default: null },
        phone: { type: String, required: true },
        email: { type: String, required: true },
        photoId: { type: Schema.Types.ObjectId, ref: 'AadhaarPhoto', default: null },
        cardCheck: { type: String, enum: CARD_CHECKS, default: null },
    },
    { _id: false },
);

const emailDeliverySchema = new Schema(
    {
        status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
        attempts: { type: Number, default: 0 },
        sentAt: Date,
        lastError: String,
    },
    { _id: false },
);

const bookingSchema = new Schema(
    {
        studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, unique: true },
        studentName: { type: String, required: true },
        studentGroup: { type: String, required: true },
        idempotencyKey: { type: String, required: true, unique: true },
        qrToken: { type: String, required: true, unique: true },
        zone: { type: String, enum: EVENT_ZONES, required: true },
        seatCount: { type: Number, required: true },
        guests: { type: [guestSchema], required: true },
        status: { type: String, enum: ['confirmed', 'checkedIn'], default: 'confirmed' },
        checkedInAt: Date,
        checkedInBy: String,
        checkedInByName: String,
        email: { type: emailDeliverySchema, required: true, default: () => ({}) },
    },
    { timestamps: true },
);

bookingSchema.index({ 'email.status': 1 });
bookingSchema.index({ 'email.sentAt': 1 });
bookingSchema.index({ createdAt: -1 });

export type BookingDocument = InferSchemaType<typeof bookingSchema>;

const BookingModel: Model<BookingDocument> = models.Booking || model('Booking', bookingSchema);

export default BookingModel;
