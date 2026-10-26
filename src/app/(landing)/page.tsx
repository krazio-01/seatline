import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { connection } from 'next/server';
import { ArrowRightIcon } from 'lucide-react';
import './page.scss';
import { Brand } from '@/components/layout/Brand/Brand';
import { Header } from '@/components/layout/Header/Header';
import { SectionNav } from '@/components/layout/SectionNav/SectionNav';
import { LazyParadeWorld } from '@/components/scenes/LazyScenes';
import { Button, ButtonLink } from '@/components/ui/Button/Button';
import {
    buildEventTimeline,
    readPublicSettings,
    registrationState,
    type PublicSettings,
} from '@/services/server/settings';
import { REGISTRATION_STATE_COPY, ZONE_LABELS, type RegistrationState } from '@/types/booking';
import { formatDate } from '@/utils/dates';
import { pluralize } from '@/utils/text';

type CallToActionProps = {
    label: string;
    state: RegistrationState;
    tone: 'light' | 'dark';
};

const REGISTER_HREF = '/register';

const ZONE_COUNT_WORDS = ['No zones', 'One zone', 'Two zones'];

const NAVIGATION = [
    { href: '#programme', label: 'Programme' },
    { href: '#seating', label: 'Seating' },
    { href: '#guide', label: 'Guest guide' },
    { href: '#gallery', label: 'Gallery' },
];

const INTERLUDE_LINES = [
    <>Months of drill.</>,
    <>
        One morning on the <em>parade ground</em>.
    </>,
    <>And your family in the stands.</>,
];

const PROGRAMME_PHOTO = {
    src: '/images/parade-review.webp',
    width: 1280,
    height: 853,
    alt: 'Flight cadets marching past at the Air Force Academy, Dundigal',
    credit: 'Combined Graduation Parade, Air Force Academy, Dundigal · Ministry of Defence (GODL-India)',
};

const GALLERY = [
    {
        src: '/images/gallery-surya-kiran.webp',
        height: 795,
        alt: 'Surya Kiran aerobatic display over the parade',
        credit: 'Surya Kiran over the Combined Graduation Parade, 2019 · Indian Air Force (GODL-India)',
    },
    {
        src: '/images/gallery-flying-officers.webp',
        height: 853,
        alt: 'Newly commissioned officers celebrating',
        credit: 'New Flying Officers after passing out · Indian Air Force (GODL-India)',
    },
    {
        src: '/images/gallery-dundigal.webp',
        height: 758,
        alt: 'Cadets on the parade ground at Dundigal',
        credit: 'The parade ground at Dundigal, 2017 · Ministry of Defence (GODL-India)',
    },
    {
        src: '/images/gallery-sarang.webp',
        height: 853,
        alt: 'Sarang helicopter display over the parade',
        credit: 'Sarang over the Combined Graduation Parade, 2019 · Indian Air Force (GODL-India)',
    },
    {
        src: '/images/gallery-tejas.webp',
        height: 853,
        alt: 'Two Tejas fighters in formation',
        credit: 'Tejas pair in formation · Indian Air Force (GODL-India)',
    },
];

const GUIDE_ICONS = {
    card: (
        <>
            <rect pathLength={1} x="2" y="5" width="20" height="14" rx="2" />
            <circle pathLength={1} cx="8" cy="12" r="2.2" />
            <path pathLength={1} d="M13 10h5M13 14h4" />
        </>
    ),
    pass: (
        <>
            <rect pathLength={1} x="3" y="3" width="6" height="6" rx="1" />
            <rect pathLength={1} x="15" y="3" width="6" height="6" rx="1" />
            <rect pathLength={1} x="3" y="15" width="6" height="6" rx="1" />
            <path
                pathLength={1}
                d="M15 15h2v2h-2zM19 19h2v2h-2zM19 15h2M15 19v2M12 3v4M12 11h-3M3 12h2M12 12v3"
            />
        </>
    ),
    clock: (
        <>
            <circle pathLength={1} cx="12" cy="12" r="9" />
            <path pathLength={1} d="M12 7v5l3 2" />
        </>
    ),
    bag: (
        <>
            <path
                pathLength={1}
                d="M5 10a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"
            />
            <path
                pathLength={1}
                d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6M9 13h6"
            />
        </>
    ),
};

const CREDITS =
    'Photos from Wikimedia Commons: Indian Air Force and Ministry of Defence (GODL-India). Crest: Indian Air Force (GODL-India). Roundel: public domain. The 3D parade ground is drawn in your browser, with no model downloads.';

function heroLine(settings: PublicSettings, state: RegistrationState): string {
    const guests = `${settings.maxGuestsPerBooking} ${pluralize(settings.maxGuestsPerBooking, 'guest')}`;
    const invitation = `Join us at ${settings.venue} on ${formatDate(settings.eventDate, 'weekdayDayMonth')} as the new course passes out.`;

    return state === 'open'
        ? `${invitation} Reserve seats for up to ${guests} and receive your QR pass by email.`
        : `${invitation} ${REGISTRATION_STATE_COPY[state].description}`;
}

function countStyle(value: number): CSSProperties {
    return { '--count-to': value } as CSSProperties;
}

function CallToAction({ label, state, tone }: CallToActionProps) {
    if (state !== 'open') {
        return (
            <Button className="landing-button" data-tone={tone} size="lg" disabled>
                {REGISTRATION_STATE_COPY[state].action}
            </Button>
        );
    }

    return (
        <ButtonLink
            href={REGISTER_HREF}
            className="landing-button"
            data-tone={tone}
            size="lg"
            data-call-to-action
        >
            {label}
            <ArrowRightIcon aria-hidden="true" />
        </ButtonLink>
    );
}

export async function generateMetadata(): Promise<Metadata> {
    const settings = await readPublicSettings();
    const description = heroLine(settings, registrationState(settings));

    return { title: settings.eventName, description: `${settings.eventName}. ${description}` };
}

export default async function Page() {
    await connection();

    const settings = await readPublicSettings();
    const state = registrationState(settings);
    const timeline = buildEventTimeline(settings);

    const totalSeats = settings.zones.reduce((seats, zone) => seats + zone.capacity, 0);
    const seatsLeft = settings.zones.reduce(
        (seats, zone) => seats + zone.capacity - zone.allocated,
        0,
    );
    const activeZones = settings.zones.filter((zone) => zone.capacity > 0);
    const eventDay = formatDate(settings.eventDate, 'weekdayDayMonth');
    const titleWords = settings.eventName.split(/\s+/);
    const liveLabel =
        state === 'open'
            ? `${seatsLeft} of ${totalSeats} seats left`
            : REGISTRATION_STATE_COPY[state].action;

    const guide = [
        {
            icon: GUIDE_ICONS.card,
            title: 'Bring the Aadhaar card',
            text: 'The original card for every guest, matching the photo uploaded at registration.',
        },
        {
            icon: GUIDE_ICONS.pass,
            title: 'Keep the QR pass ready',
            text: 'On your phone or printed. One pass covers your whole party.',
        },
        {
            icon: GUIDE_ICONS.clock,
            title: `Arrive by ${timeline.gatesOpen}`,
            text: `Gates open at ${timeline.gatesOpen} and the parade begins at ${timeline.paradeBegins}.`,
        },
        {
            icon: GUIDE_ICONS.bag,
            title: 'Bring only what you need',
            text: 'Travel light so the walk from the gate to your seat is easy.',
        },
    ];

    return (
        <div className="landing">
            <div className="landing-progress" aria-hidden="true" />

            <LazyParadeWorld
                zones={settings.zones}
                eventName={settings.eventName}
                eventYear={formatDate(settings.eventDate, 'year')}
                paradeBegins={timeline.paradeBegins}
                clock={timeline.clock}
            />

            <Header
                className="landing-header"
                start={
                    <Link href="#top" className="landing-brand">
                        <Brand name={settings.eventName} subtitle="Indian Air Force" />
                    </Link>
                }
                end={
                    <SectionNav
                        items={NAVIGATION}
                        action={
                            state === 'open'
                                ? { href: REGISTER_HREF, label: 'Register guests' }
                                : { href: null, label: REGISTRATION_STATE_COPY[state].action }
                        }
                    />
                }
            />

            <main className="landing-main">
                <section
                    className="landing-hero landing-window"
                    id="top"
                    data-shot="hero"
                    data-align="top"
                    data-window
                >
                    <div className="world-poster" data-poster="night" aria-hidden="true" />
                    <div className="landing-hero-inner" data-world-blocker>
                        <p className="landing-eyebrow">
                            <Image src="/images/roundel.svg" width={20} height={20} alt="" />
                            Indian Air Force · {eventDay}
                        </p>
                        <h1 className="landing-hero-title">
                            {titleWords.map((word, index) => (
                                <span
                                    key={`${word}-${index}`}
                                    className="landing-hero-word"
                                    style={{ '--i': index } as CSSProperties}
                                >
                                    {index === titleWords.length - 1 && titleWords.length > 1 ? (
                                        <em>{word}</em>
                                    ) : (
                                        word
                                    )}
                                    {index < titleWords.length - 1 && ' '}
                                </span>
                            ))}
                        </h1>
                        <p className="landing-hero-lede">{heroLine(settings, state)}</p>
                        <div className="landing-hero-actions">
                            <CallToAction label="Register your guests" state={state} tone="light" />
                            <ButtonLink
                                href="#programme"
                                className="landing-button"
                                data-tone="ghost"
                                size="lg"
                            >
                                See the programme
                            </ButtonLink>
                        </div>
                    </div>
                    <p className="landing-live" data-world-blocker data-state={state}>
                        <span className="landing-live-dot" aria-hidden="true" />
                        {liveLabel}
                    </p>
                    <p className="landing-scroll-cue" aria-hidden="true">
                        <span />
                        Scroll
                    </p>
                </section>

                <section
                    className="landing-facts landing-window"
                    data-shot="facts"
                    data-align="center"
                    data-window
                >
                    <div className="world-poster" data-poster="night" aria-hidden="true" />
                    <p className="landing-facts-intro" data-world-blocker>
                        Gates open at {timeline.gatesOpen}. The parade begins at{' '}
                        {timeline.paradeBegins}.
                    </p>
                    <dl className="landing-fact-grid" data-world-blocker>
                        {[
                            ['Date', eventDay],
                            ['Gates open', timeline.gatesOpen],
                            ['Parade begins', timeline.paradeBegins],
                            ['Venue', settings.venue],
                        ].map(([label, value], index) => (
                            <div
                                key={label}
                                className="landing-fact"
                                style={{ '--i': index } as CSSProperties}
                            >
                                <dt className="landing-fact-label">{label}</dt>
                                <dd className="landing-fact-value">{value}</dd>
                            </div>
                        ))}
                        <div className="landing-fact" style={{ '--i': 4 } as CSSProperties}>
                            <dt className="landing-fact-label">Seats left</dt>
                            <dd className="landing-fact-value">
                                <span
                                    className="landing-count"
                                    style={countStyle(seatsLeft)}
                                    aria-hidden="true"
                                />
                                <span className="visually-hidden">{seatsLeft}</span>
                                <span className="landing-fact-total"> / {totalSeats}</span>
                            </dd>
                        </div>
                    </dl>
                </section>

                <section
                    className="landing-sheet landing-sheet-top landing-sheet-bottom"
                    id="programme"
                    data-shot="programme"
                    data-align="center"
                >
                    <div className="landing-programme">
                        <div>
                            <p className="landing-kicker">Programme</p>
                            <h2 className="landing-title">
                                The morning,
                                <br />
                                step by step
                            </h2>
                            <ol className="landing-timeline">
                                {timeline.steps.map((step) => (
                                    <li key={step.title}>
                                        <time>{step.label}</time>
                                        <span>
                                            <strong>{step.title}</strong>
                                            {step.description}
                                        </span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                        <figure className="landing-figure">
                            <div className="landing-photo">
                                <Image
                                    src={PROGRAMME_PHOTO.src}
                                    width={PROGRAMME_PHOTO.width}
                                    height={PROGRAMME_PHOTO.height}
                                    sizes="(max-width: 960px) 100vw, 45vw"
                                    alt={PROGRAMME_PHOTO.alt}
                                />
                            </div>
                            <figcaption className="landing-caption">
                                {PROGRAMME_PHOTO.credit}
                            </figcaption>
                        </figure>
                    </div>
                </section>

                <section className="landing-interlude landing-window" id="parade" data-window>
                    <span data-shot="paradeStart" data-align="top" hidden />
                    <div className="landing-interlude-sticky">
                        <div className="world-poster" data-poster="day" aria-hidden="true" />
                        {INTERLUDE_LINES.map((line, index) => (
                            <p key={index} className="landing-interlude-line">
                                {line}
                            </p>
                        ))}
                        <p className="landing-drag-hint" data-world-blocker>
                            <span className="landing-drag-hint-icon" aria-hidden="true" />
                            <span className="landing-drag-hint-pointer">
                                Drag to look around · hover the stands
                            </span>
                            <span className="landing-drag-hint-touch">
                                Swipe sideways to look around · tap the stands
                            </span>
                        </p>
                        <button type="button" className="landing-flypast" data-flypast-trigger>
                            <svg
                                className="landing-flypast-icon"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                            >
                                <path d="M12 2.5c.8 0 1.3 1.2 1.3 3.2v3.6l7.7 4.6v2l-7.7-2.2v4.1l2.4 1.9v1.6L12 20.4l-3.7.9v-1.6l2.4-1.9v-4.1L3 15.9v-2l7.7-4.6V5.7c0-2 .5-3.2 1.3-3.2z" />
                            </svg>
                            <span className="landing-flypast-idle">Call the flypast</span>
                            <span className="landing-flypast-busy">Flypast in progress</span>
                        </button>
                    </div>
                    <span data-shot="paradeMid" data-align="center" hidden />
                    <span data-shot="paradeEnd" data-align="bottom" hidden />
                </section>

                <section
                    className="landing-seating landing-window"
                    id="seating"
                    data-shot="seating"
                    data-align="center"
                    data-window
                >
                    <div className="world-poster" data-poster="day" aria-hidden="true" />
                    <div className="landing-seating-panel" data-world-blocker>
                        <p className="landing-kicker">Seating</p>
                        <h2 className="landing-title">
                            {ZONE_COUNT_WORDS[activeZones.length] ?? `${activeZones.length} zones`}.
                            <br />
                            {totalSeats} seats.
                        </h2>
                        <p className="landing-lede">
                            Your party always sits together in one zone. The zone is printed on your
                            pass and in the confirmation email.
                        </p>
                        <div className="landing-zone-cards">
                            {settings.zones.map((zone) => {
                                const left = zone.capacity - zone.allocated;
                                const isUnused = zone.capacity === 0;
                                const meta = isUnused
                                    ? 'Not in use'
                                    : left === 0
                                      ? 'Full'
                                      : `of ${zone.capacity} seats left`;

                                return (
                                    <button
                                        key={zone.name}
                                        type="button"
                                        className="landing-zone-card"
                                        data-world-view={zone.name}
                                        data-seats-left={left}
                                        disabled={isUnused}
                                    >
                                        <span className="landing-zone-card-title">
                                            {ZONE_LABELS[zone.name]}
                                        </span>
                                        <span className="landing-zone-card-meta">
                                            {!isUnused && left > 0 && (
                                                <>
                                                    <span
                                                        className="landing-count landing-zone-card-count"
                                                        style={countStyle(left)}
                                                        aria-hidden="true"
                                                    />
                                                    <span className="visually-hidden">
                                                        {left}
                                                    </span>{' '}
                                                </>
                                            )}
                                            {meta}
                                        </span>
                                        <span className="landing-zone-bar" aria-hidden="true">
                                            <span
                                                style={
                                                    {
                                                        '--fill': zone.capacity
                                                            ? zone.allocated / zone.capacity
                                                            : 0,
                                                    } as CSSProperties
                                                }
                                            />
                                        </span>
                                        {!isUnused && (
                                            <span className="landing-zone-card-view">
                                                See the view
                                                <ArrowRightIcon aria-hidden="true" />
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="landing-zone-hint">
                            Hover a zone to find its enclosure, or open the view from its next free
                            seat.
                        </p>
                        <CallToAction label="Register your guests" state={state} tone="dark" />
                    </div>
                </section>

                <section
                    className="landing-sheet landing-sheet-top"
                    id="guide"
                    data-shot="guide"
                    data-align="center"
                >
                    <p className="landing-kicker">Guest guide</p>
                    <h2 className="landing-title">Before you come</h2>
                    <p className="landing-lede">
                        A few things that make the morning smooth for everyone at the gate.
                    </p>
                    <div className="landing-guide-grid">
                        {guide.map((card, index) => (
                            <article
                                key={card.title}
                                className="landing-guide-card"
                                style={{ '--i': index } as CSSProperties}
                            >
                                <div className="landing-guide-icon">
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                        {card.icon}
                                    </svg>
                                </div>
                                <strong>{card.title}</strong>
                                <p>{card.text}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="landing-gallery" id="gallery">
                    <div className="landing-gallery-sticky">
                        <div className="landing-gallery-head">
                            <div>
                                <p className="landing-kicker">Gallery</p>
                                <h2 className="landing-title">From past parades</h2>
                            </div>
                            <span className="landing-gallery-hint">
                                Keep scrolling to move through
                            </span>
                        </div>
                        <div className="landing-gallery-track">
                            {GALLERY.map((photo) => (
                                <figure key={photo.src} className="landing-gallery-item">
                                    <div className="landing-photo">
                                        <Image
                                            src={photo.src}
                                            width={1280}
                                            height={photo.height}
                                            sizes="(max-width: 960px) 82vw, 64vw"
                                            alt={photo.alt}
                                        />
                                    </div>
                                    <figcaption className="landing-caption">
                                        {photo.credit}
                                    </figcaption>
                                </figure>
                            ))}
                        </div>
                    </div>
                </section>

                <section
                    className="landing-cta landing-window"
                    id="register"
                    data-shot="cta"
                    data-align="center"
                    data-window
                >
                    <div className="world-poster" data-poster="night" aria-hidden="true" />
                    <div className="landing-cta-inner" data-world-blocker>
                        <p className="landing-eyebrow">
                            <Image src="/images/roundel.svg" width={20} height={20} alt="" />
                            {state === 'open'
                                ? 'Registrations open'
                                : REGISTRATION_STATE_COPY[state].action}
                        </p>
                        <h2 className="landing-cta-title">
                            {state === 'open' ? (
                                <>
                                    Reserve your <em>seats</em>
                                </>
                            ) : (
                                REGISTRATION_STATE_COPY[state].title
                            )}
                        </h2>
                        <p className="landing-cta-lede">
                            {state === 'open'
                                ? "It takes about three minutes. Keep each guest's Aadhaar card handy for the photo."
                                : REGISTRATION_STATE_COPY[state].description}
                        </p>
                        <CallToAction label="Register your guests" state={state} tone="light" />
                    </div>
                </section>
            </main>

            <footer className="landing-footer">
                <div className="landing-footer-flash" aria-hidden="true" />
                <div className="landing-footer-row">
                    <Brand name={settings.eventName} />
                    <nav className="landing-footer-links" aria-label="Footer">
                        {NAVIGATION.slice(0, 3).map((item) => (
                            <a key={item.href} href={item.href}>
                                {item.label}
                            </a>
                        ))}
                        <Link href="/admin/login">Admin sign in</Link>
                    </nav>
                </div>
                <p className="landing-credits">{CREDITS}</p>
            </footer>
        </div>
    );
}
