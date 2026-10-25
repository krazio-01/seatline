import { unstable_cache } from 'next/cache';
import { connection } from 'next/server';
import { CalendarX2Icon, TicketXIcon } from 'lucide-react';
import './page.scss';
import { AppProvider } from '@/context/appContext';
import { BookingForm } from '@/components/forms/BookingForm/BookingForm';
import { Notice } from '@/components/widgets/Notice/Notice';
import { SeatsLeft } from '@/components/widgets/SeatsLeft/SeatsLeft';
import { StatTiles } from '@/components/widgets/StatTiles/StatTiles';
import { Hero } from '@/components/layout/Hero/Hero';
import { SeatMap } from '@/components/scenes/SeatMap/SeatMap';
import { LazyFlypast } from '@/components/scenes/LazyScenes';
import { getEnv } from '@/lib/env';
import { getEventSettings, pickZone } from '@/services/server/settings';
import { formatDate } from '@/utils/dates';

const SETTINGS_CACHE_SECONDS = 15;

const CLOSED_NOTICES = {
    closed: {
        icon: CalendarX2Icon,
        title: 'Registrations are closed',
        description: 'Seats are not being reserved right now. Please check back later.',
    },
    soldOut: {
        icon: TicketXIcon,
        title: 'All seats are taken',
        description: 'Every seat has been reserved. Thank you for your interest.',
    },
};

const readRegistrationSettings = unstable_cache(
    async () => {
        const settings = await getEventSettings();

        return {
            eventName: settings.eventName,
            eventDay: formatDate(settings.eventDate, 'weekdayDayMonth'),
            eventYear: formatDate(settings.eventDate, 'year'),
            gatesOpenTime: formatDate(settings.gatesOpenAt, 'time'),
            venue: settings.venue,
            zones: settings.zones,
            maxGuestsPerBooking: settings.maxGuestsPerBooking,
            bookingsOpen: settings.bookingsOpen,
        };
    },
    ['registration-settings'],
    { revalidate: SETTINGS_CACHE_SECONDS },
);

export default async function Page() {
    await connection();

    const settings = await readRegistrationSettings();
    const { TURNSTILE_SITE_KEY: turnstileSiteKey } = getEnv();

    const isSoldOut = pickZone(settings.zones, 1) === null;
    const isRegistrationOpen = settings.bookingsOpen && !isSoldOut;

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

            <main className="registration">
                <section className="registration-intro">
                    <Hero
                        eventName={settings.eventName}
                        eventYear={settings.eventYear}
                        isRegistrationOpen={isRegistrationOpen}
                        maxGuestsPerBooking={settings.maxGuestsPerBooking}
                    />
                    <StatTiles
                        tiles={[
                            { label: 'Date', value: settings.eventDay },
                            { label: 'Gates open', value: settings.gatesOpenTime },
                            {
                                label: 'Seats left',
                                value: <SeatsLeft />,
                            },
                        ]}
                    />
                    <SeatMap venue={settings.venue} eventName={settings.eventName} />
                </section>

                <div className="registration-aside">
                    {isRegistrationOpen ? (
                        <BookingForm
                            maxGuestsPerBooking={settings.maxGuestsPerBooking}
                            turnstileSiteKey={turnstileSiteKey}
                        />
                    ) : (
                        <Notice
                            {...CLOSED_NOTICES[isSoldOut ? 'soldOut' : 'closed']}
                            footer={settings.eventName}
                        />
                    )}
                </div>
            </main>
        </AppProvider>
    );
}
