'use client';
import { Suspense, useRef, useState } from 'react';
import './page.scss';
import { PageHeading } from '@/components/layout/PageHeading/PageHeading';
import { AuditoriumFallback } from '@/components/scenes/AuditoriumFallback/AuditoriumFallback';
import { LazyAuditorium, useSceneGate } from '@/components/scenes/LazyScenes';
import { BookingsTable } from '@/components/tables/BookingsTable/BookingsTable';
import { CountUp } from '@/components/ui/Animations/ClientAnimations';
import { Badge } from '@/components/ui/Badge/Badge';
import { Card } from '@/components/ui/Card/Card';
import { Progress } from '@/components/ui/Progress/Progress';
import { Skeleton } from '@/components/ui/Skeleton/Skeleton';
import { EntryFeed } from '@/components/widgets/EntryFeed/EntryFeed';
import { StatTiles } from '@/components/widgets/StatTiles/StatTiles';
import { useAppContext } from '@/context/appContext';
import { consecutiveFailures } from '@/context/appStore';
import { diffSeatStates, zoneSeatStates } from '@/components/scenes/seatLayout';
import { formatDate } from '@/utils/dates';

const BOOKINGS_PAGE_SIZE = 10;
const RECONNECTING_AFTER_FAILURES = 2;

const LIVE_LABELS = {
    live: 'Live · updates every few seconds',
    reconnecting: 'Reconnecting…',
};

function percentOf(part: number, whole: number): number {
    return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export default function Page() {
    const { event, stats, zones, gateEvents } = useAppContext('dashboard');
    const connection = useAppContext('connection');
    const hallRef = useRef<HTMLDivElement>(null);
    const [isHallReady, setIsHallReady] = useState(false);
    const [seatHistory, setSeatHistory] = useState({ zones, pulseKeys: [] as string[] });

    const shouldLoadHall = useSceneGate(hallRef);

    if (seatHistory.zones !== zones) {
        setSeatHistory({
            zones,
            pulseKeys: diffSeatStates(zoneSeatStates(seatHistory.zones), zoneSeatStates(zones)),
        });
    }

    const liveState =
        consecutiveFailures(connection) >= RECONNECTING_AFTER_FAILURES ? 'reconnecting' : 'live';
    const emailsSent = stats.bookings - stats.emailPending - stats.emailFailed;
    const seatsFilledPercent = percentOf(stats.guests, stats.totalSeats);
    const checkedInPercent = percentOf(stats.checkedInGuests, stats.guests);
    const eventDate = new Date(event.eventDate);
    const gatesOpenAt = new Date(event.gatesOpenAt);

    return (
        <div className="dashboard">
            <PageHeading
                title="Event overview"
                description={
                    <span suppressHydrationWarning>
                        {formatDate(eventDate, 'weekdayDayMonth')} · {event.venue} · Gates open{' '}
                        {formatDate(gatesOpenAt, 'time')}
                    </span>
                }
                actions={
                    <span className="dashboard-live" data-state={liveState} role="status">
                        <span className="dashboard-live-dot" aria-hidden="true" />
                        {LIVE_LABELS[liveState]}
                    </span>
                }
            />

            <StatTiles
                variant="card"
                tiles={[
                    {
                        label: 'Bookings',
                        value: (
                            <span data-stat="bookings" data-value={stats.bookings}>
                                <CountUp value={stats.bookings} />
                            </span>
                        ),
                        footer: `${stats.studentsBooked} of ${stats.studentsTotal} students booked`,
                    },
                    {
                        label: 'Seats filled',
                        aside: <span className="dashboard-muted">{seatsFilledPercent}%</span>,
                        value: (
                            <span data-stat="seats-filled" data-value={stats.guests}>
                                <CountUp value={stats.guests} />
                                <span className="dashboard-stat-total"> / {stats.totalSeats}</span>
                            </span>
                        ),
                        footer: <Progress value={seatsFilledPercent} aria-label="Seats filled" />,
                    },
                    {
                        label: 'Checked in',
                        aside: <span className="dashboard-muted">{checkedInPercent}%</span>,
                        value: (
                            <span data-stat="checked-in" data-value={stats.checkedInGuests}>
                                <CountUp value={stats.checkedInGuests} />
                                <span className="dashboard-stat-total"> / {stats.guests}</span>
                            </span>
                        ),
                        footer: <Progress value={checkedInPercent} aria-label="Checked in" />,
                    },
                    {
                        label: 'Emails',
                        aside:
                            stats.emailFailed > 0 ? (
                                <Badge variant="failed">{stats.emailFailed} failed</Badge>
                            ) : undefined,
                        value: (
                            <span data-stat="emails-sent" data-value={emailsSent}>
                                <CountUp value={emailsSent} />
                            </span>
                        ),
                        footer:
                            stats.emailFailed > 0
                                ? `sent · ${stats.emailFailed} need a resend`
                                : `sent · ${stats.emailPending} pending`,
                    },
                ]}
            />

            <div className="dashboard-split">
                <Card className="dashboard-card">
                    <div className="dashboard-card-header">
                        <div>
                            <h2 className="dashboard-card-title">Live seating</h2>
                            <p className="dashboard-card-description">
                                Seats light up as guests are checked in at the gate.
                            </p>
                        </div>

                        <ul className="dashboard-legend" aria-label="Seat colours">
                            <li>
                                <span
                                    className="dashboard-swatch"
                                    data-state="available"
                                    aria-hidden="true"
                                />
                                Available
                            </li>
                            <li>
                                <span
                                    className="dashboard-swatch"
                                    data-state="booked"
                                    aria-hidden="true"
                                />
                                Booked
                            </li>
                            <li>
                                <span
                                    className="dashboard-swatch"
                                    data-state="checkedIn"
                                    aria-hidden="true"
                                />
                                Checked in
                            </li>
                        </ul>
                    </div>

                    <div
                        ref={hallRef}
                        className="dashboard-hall"
                        data-scene="auditorium"
                        data-scene-ready={isHallReady || undefined}
                    >
                        <AuditoriumFallback
                            zones={zones}
                            eventName={event.eventName}
                            variant="admin"
                        />

                        {shouldLoadHall && (
                            <LazyAuditorium
                                zones={zones}
                                eventName={event.eventName}
                                pulseKeys={seatHistory.pulseKeys}
                                variant="admin"
                                startsAtRest
                                onFirstFrame={() => setIsHallReady(true)}
                            />
                        )}
                    </div>
                </Card>

                <Card className="dashboard-card">
                    <EntryFeed events={gateEvents} />
                </Card>
            </div>

            <Card className="dashboard-card">
                <div className="dashboard-card-header">
                    <div>
                        <h2 className="dashboard-card-title">Bookings</h2>
                        <p className="dashboard-card-description">
                            Aadhaar numbers stay masked until you reveal them; every reveal is
                            logged.
                        </p>
                    </div>
                </div>

                <Suspense fallback={<Skeleton height={320} className="dashboard-table-fallback" />}>
                    <BookingsTable pageSize={BOOKINGS_PAGE_SIZE} />
                </Suspense>
            </Card>
        </div>
    );
}
