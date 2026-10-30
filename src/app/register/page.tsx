import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { ArrowLeftIcon, CalendarX2Icon, TicketXIcon } from 'lucide-react';
import './page.scss';
import { AppProvider } from '@/context/appContext';
import { BookingForm } from '@/components/forms/BookingForm/BookingForm';
import { Brand } from '@/components/layout/Brand/Brand';
import { Hero } from '@/components/layout/Hero/Hero';
import { LazyFlypast } from '@/components/scenes/LazyScenes';
import { LiveSeating } from '@/components/scenes/LiveSeating/LiveSeating';
import { Notice } from '@/components/widgets/Notice/Notice';
import { SeatsLeft } from '@/components/widgets/SeatsLeft/SeatsLeft';
import { StatTiles } from '@/components/widgets/StatTiles/StatTiles';
import { getEnv } from '@/lib/env';
import { readPublicSettings, registrationState } from '@/services/server/settings';
import { REGISTRATION_STATE_COPY } from '@/types/booking';
import { formatDate } from '@/utils/dates';

const CLOSED_ICONS = { closed: CalendarX2Icon, soldOut: TicketXIcon };

export async function generateMetadata(): Promise<Metadata> {
    const settings = await readPublicSettings();
    const state = registrationState(settings);

    return {
        title: `Register · ${settings.eventName}`,
        description:
            state === 'open'
                ? `Reserve seats for up to ${settings.maxGuestsPerBooking} guests at ${settings.eventName}.`
                : `${settings.eventName}. ${REGISTRATION_STATE_COPY[state].description}`,
    };
}

export default async function Page() {
    await connection();

    const settings = await readPublicSettings();
    const { TURNSTILE_SITE_KEY: turnstileSiteKey } = getEnv();

    const state = registrationState(settings);
    const isRegistrationOpen = state === 'open';

    const booking = {
        zones: settings.zones.map(({ name, capacity, allocated }) => ({
            name,
            capacity,
            booked: allocated,
            checkedIn: 0,
        })),
        ownBooking: null,
    };

    return (
        <AppProvider initialState={{ booking }}>
            <div className="registration-sky" aria-hidden="true">
                <LazyFlypast />
            </div>

            <div className="registration-hairline" aria-hidden="true" />

            <header className="registration-header">
                <Link href="/" className="registration-home">
                    <Brand name={settings.eventName} subtitle="Indian Air Force" />
                </Link>
                <Link href="/" className="registration-back">
                    <ArrowLeftIcon aria-hidden="true" />
                    Back to the parade
                </Link>
            </header>

            <main className="registration">
                <section className="registration-intro">
                    <Hero
                        eventName={settings.eventName}
                        eventYear={formatDate(settings.eventDate, 'year')}
                        isRegistrationOpen={isRegistrationOpen}
                        maxGuestsPerBooking={settings.maxGuestsPerBooking}
                    />
                    <StatTiles
                        tiles={[
                            {
                                label: 'Date',
                                value: formatDate(settings.eventDate, 'weekdayDayMonth'),
                            },
                            {
                                label: 'Gates open',
                                value: formatDate(settings.gatesOpenAt, 'time'),
                            },
                            { label: 'Seats left', value: <SeatsLeft /> },
                        ]}
                    />
                </section>

                <div className="registration-aside">
                    {state === 'open' ? (
                        <BookingForm
                            maxGuestsPerBooking={settings.maxGuestsPerBooking}
                            turnstileSiteKey={turnstileSiteKey}
                            event={{
                                name: settings.eventName,
                                date: settings.eventDate,
                                gatesOpenAt: settings.gatesOpenAt,
                                venue: settings.venue,
                            }}
                        />
                    ) : (
                        <Notice
                            icon={CLOSED_ICONS[state]}
                            title={REGISTRATION_STATE_COPY[state].title}
                            description={REGISTRATION_STATE_COPY[state].description}
                            footer={settings.eventName}
                        />
                    )}
                </div>

                <section className="registration-seating" aria-label="Live seating">
                    <LiveSeating />
                </section>
            </main>
        </AppProvider>
    );
}
