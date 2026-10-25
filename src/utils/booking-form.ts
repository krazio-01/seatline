import type { ZoneBooking, ZoneOccupancy } from '@/types/booking';

export type BookingStep = 'details' | 'verify' | 'pass';

export type BookingStepEvent = 'detailsValid' | 'codeConfirmed' | 'editDetails';

export type GuestValues = {
    name: string;
    aadhaar: string;
    phone: string;
    email: string;
    photoId: string;
};

export type BookingDetailsValues = { studentId: string; guests: GuestValues[] };

export type BookingState = { zones: ZoneOccupancy[]; ownBooking: ZoneBooking | null };

export const BOOKING_STEPS: { value: BookingStep; label: string }[] = [
    { value: 'details', label: 'Details' },
    { value: 'verify', label: 'Verify' },
    { value: 'pass', label: 'Pass' },
];

const TRANSITIONS: Record<BookingStep, Partial<Record<BookingStepEvent, BookingStep>>> = {
    details: { detailsValid: 'verify' },
    verify: { codeConfirmed: 'pass', editDetails: 'details' },
    pass: {},
};

export const EMPTY_GUEST: GuestValues = {
    name: '',
    aadhaar: '',
    phone: '',
    email: '',
    photoId: '',
};

export function nextStep(step: BookingStep, event: BookingStepEvent): BookingStep {
    return TRANSITIONS[step][event] ?? step;
}
