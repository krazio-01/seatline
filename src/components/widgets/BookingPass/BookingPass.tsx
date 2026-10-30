'use client';
import { m } from 'motion/react';
import {
    ArrowRightIcon,
    CalendarPlusIcon,
    CircleCheckIcon,
    Clock3Icon,
    IdCardIcon,
    MailIcon,
} from 'lucide-react';
import './bookingPass.scss';
import { Button, ButtonLink } from '@/components/ui/Button/Button';
import {
    AADHAAR_GROUP_SIZE,
    AADHAAR_LENGTH,
    type BookingConfirmation,
    type StudentOption,
} from '@/types/booking';
import { formatDate, toCalendarEvent } from '@/utils/dates';
import { DURATION, EASE_OUT } from '@/utils/motion';
import { groupCharacters, maskStart, pluralize } from '@/utils/text';

export type PassEvent = { name: string; date: Date; gatesOpenAt: Date; venue: string };

export type PassGuest = { name: string; aadhaar: string };

const CALENDAR_FILE_TYPE = 'text/calendar;charset=utf-8';

function downloadCalendarEvent(event: PassEvent, confirmation: BookingConfirmation) {
    const calendar = toCalendarEvent({
        id: `${confirmation.bookingId}@campus-event`,
        title: event.name,
        start: event.date,
        location: event.venue,
        description: `Zone ${confirmation.zone}, ${confirmation.seatCount} ${pluralize(confirmation.seatCount, 'seat')}. Gates open at ${formatDate(event.gatesOpenAt, 'time')}.`,
    });
    const url = URL.createObjectURL(new Blob([calendar], { type: CALENDAR_FILE_TYPE }));
    const link = document.createElement('a');

    link.href = url;
    link.download = `${event.name}.ics`;
    link.click();
    URL.revokeObjectURL(url);
}

export function BookingPass({
    confirmation,
    student,
    event,
    guests,
}: {
    confirmation: BookingConfirmation;
    student: StudentOption | null;
    event: PassEvent;
    guests: PassGuest[];
}) {
    const details = [
        { label: 'Date', value: formatDate(event.date, 'weekdayDayMonth') },
        { label: 'Gates open', value: formatDate(event.gatesOpenAt, 'time') },
        { label: 'Parade begins', value: formatDate(event.date, 'time') },
        { label: 'Venue', value: event.venue },
    ];

    return (
        <div className="booking-pass" role="status">
            <div className="booking-pass-heading">
                <m.span
                    className="booking-pass-badge"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 22 }}
                >
                    <CircleCheckIcon aria-hidden="true" />
                    Registration confirmed
                </m.span>
                <h3 className="booking-pass-title">Your seats are reserved</h3>
                {student && (
                    <p className="booking-pass-student">
                        Booking for <strong>{student.name}</strong> · Group {student.group}
                    </p>
                )}
            </div>

            <m.div
                className="booking-pass-ticket"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: DURATION.base, ease: EASE_OUT, delay: 0.1 }}
            >
                <div className="booking-pass-ticket-main">
                    <div className="booking-pass-zone">
                        <span className="booking-pass-label">Zone</span>
                        <span className="booking-pass-zone-name">{confirmation.zone}</span>
                        <span className="booking-pass-seat-count">
                            {confirmation.seatCount} {pluralize(confirmation.seatCount, 'seat')}{' '}
                            reserved
                        </span>
                    </div>

                    <dl className="booking-pass-details">
                        {details.map((detail) => (
                            <div key={detail.label} className="booking-pass-detail">
                                <dt>{detail.label}</dt>
                                <dd>{detail.value}</dd>
                            </div>
                        ))}
                    </dl>
                </div>

                <div className="booking-pass-guests">
                    <span className="booking-pass-label">Guests</span>
                    <ul>
                        {guests.map((guest, index) => (
                            <li key={index} className="booking-pass-guest">
                                <span className="booking-pass-guest-name">{guest.name}</span>
                                <span className="booking-pass-guest-aadhaar">
                                    {groupCharacters(
                                        maskStart(guest.aadhaar.slice(-4), AADHAAR_LENGTH),
                                        AADHAAR_GROUP_SIZE,
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            </m.div>

            <p className="booking-pass-email">
                <MailIcon aria-hidden="true" />
                <span>
                    Your entry pass has been sent to{' '}
                    <strong className="booking-pass-address">
                        {confirmation.primaryEmailMasked}
                    </strong>
                    . Please present it at the gate. It is valid for a single entry of your entire
                    party.
                </span>
            </p>

            <div className="booking-pass-requirements">
                <span className="booking-pass-label">Entry requirements</span>
                <ul>
                    <li>
                        <IdCardIcon aria-hidden="true" />
                        Each guest must carry their original Aadhaar card
                    </li>
                    <li>
                        <Clock3Icon aria-hidden="true" />
                        Gates open at {formatDate(event.gatesOpenAt, 'time')}
                    </li>
                </ul>
            </div>

            <div className="booking-pass-actions">
                <Button
                    variant="outline"
                    onClick={() => downloadCalendarEvent(event, confirmation)}
                >
                    <CalendarPlusIcon />
                    Add to calendar
                </Button>
                <ButtonLink href="/">
                    Return to event page
                    <ArrowRightIcon />
                </ButtonLink>
            </div>
        </div>
    );
}
