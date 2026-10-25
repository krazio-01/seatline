import './hero.scss';
import { SplitReveal } from '@/components/ui/Animations/Animations';
import { Badge } from '@/components/ui/Badge/Badge';
import { LETTER_INTERVAL } from '@/utils/motion';
import { pluralize } from '@/utils/text';

export function Hero({
    eventName,
    eventYear,
    isRegistrationOpen,
    maxGuestsPerBooking,
}: {
    eventName: string;
    eventYear: string;
    isRegistrationOpen: boolean;
    maxGuestsPerBooking: number;
}) {
    const brandLetter = eventName.trim().charAt(0).toUpperCase();
    const yearDelay = Array.from(eventName).length * LETTER_INTERVAL;

    return (
        <header className="hero">
            <div className="hero-brand">
                <span className="hero-mark" aria-hidden="true">
                    {brandLetter}
                </span>
                {eventName}
            </div>

            <div className="hero-heading">
                <Badge variant="outline" className="hero-badge">
                    <span
                        className="hero-dot"
                        data-state={isRegistrationOpen ? 'open' : 'closed'}
                        aria-hidden="true"
                    />
                    {isRegistrationOpen ? 'Registrations open' : 'Registrations closed'}
                </Badge>

                <h1 className="hero-title">
                    <SplitReveal text={eventName} />
                    <br />
                    <SplitReveal text={eventYear} delay={yearDelay} className="hero-year" />
                </h1>

                <p className="hero-lead">
                    Reserve seats for up to {maxGuestsPerBooking}{' '}
                    {pluralize(maxGuestsPerBooking, 'guest')}. Your party sits together in one zone
                    and your QR pass arrives by email.
                </p>
            </div>
        </header>
    );
}
