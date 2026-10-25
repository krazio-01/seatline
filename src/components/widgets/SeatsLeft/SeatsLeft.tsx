'use client';
import { CountUp } from '@/components/ui/Animations/ClientAnimations';
import { useAppContext } from '@/context/appContext';

export function SeatsLeft() {
    const { zones } = useAppContext('booking');

    const totalSeats = zones.reduce((seats, zone) => seats + zone.capacity, 0);
    const bookedSeats = zones.reduce((seats, zone) => seats + zone.booked, 0);
    const seatsLeft = Math.max(0, totalSeats - bookedSeats);

    return (
        <span data-stat="seats-left" data-value={seatsLeft}>
            <CountUp value={seatsLeft} /> / {totalSeats}
        </span>
    );
}
