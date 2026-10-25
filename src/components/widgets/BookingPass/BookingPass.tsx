'use client';
import { m } from 'motion/react';
import { CheckIcon, MailIcon } from 'lucide-react';
import './bookingPass.scss';
import { ZONE_LABELS, type BookingConfirmation, type StudentOption } from '@/types/booking';
import { DURATION, EASE_OUT } from '@/utils/motion';
import { pluralize } from '@/utils/text';

export function BookingPass({
    confirmation,
    student,
}: {
    confirmation: BookingConfirmation;
    student: StudentOption | null;
}) {
    return (
        <div className="booking-pass" role="status">
            <m.span
                className="booking-pass-check"
                aria-hidden="true"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 420, damping: 18 }}
            >
                <CheckIcon />
            </m.span>

            <div>
                <h3 className="booking-pass-title">Your seats are booked</h3>
                {student && (
                    <p className="booking-pass-student">
                        {student.name}
                        <span className="booking-pass-meta">Group {student.group}</span>
                    </p>
                )}
            </div>

            <m.div
                className="booking-pass-seats"
                data-zone={confirmation.zone}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: DURATION.base, ease: EASE_OUT, delay: 0.15 }}
            >
                <p className="booking-pass-label">Your zone</p>
                <p className="booking-pass-zone">{ZONE_LABELS[confirmation.zone]}</p>
                <p className="booking-pass-seat-count">
                    {confirmation.seatCount} {pluralize(confirmation.seatCount, 'seat')}
                </p>
            </m.div>

            <p className="booking-pass-email">
                <MailIcon aria-hidden="true" />
                <span>
                    Your QR pass is on its way to{' '}
                    <strong className="booking-pass-address">
                        {confirmation.primaryEmailMasked}
                    </strong>
                    . Show it at the gate; it admits your whole party once.
                </span>
            </p>
        </div>
    );
}
