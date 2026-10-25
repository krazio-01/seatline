'use client';
import { useState, type CSSProperties } from 'react';
import { PlaneIcon } from 'lucide-react';
import './gateProgress.scss';
import { useAppContext } from '@/context/appContext';
import { formatDate } from '@/utils/dates';

type Milestone = { ratio: number; title: string };

type Celebration = Milestone & { detail: string; key: number };

type ConfettiTone = 'saffron' | 'white' | 'green';

const MILESTONES: Milestone[] = [
    { ratio: 0.25, title: 'A quarter in' },
    { ratio: 0.5, title: 'Halfway there' },
    { ratio: 0.75, title: 'Three quarters in' },
    { ratio: 1, title: 'Full house' },
];

const RUNWAY_MARKS = [0, 0.25, 0.5, 0.75, 1];
const CONFETTI_TONES: ConfettiTone[] = ['saffron', 'white', 'green'];
const CONFETTI_COUNT = 36;

const CONFETTI_PIECES = Array.from({ length: CONFETTI_COUNT }, (_, index) => ({
    tone: CONFETTI_TONES[index % CONFETTI_TONES.length],
    style: {
        '--gate-progress-confetti-left': `${(index * 37) % 100}%`,
        '--gate-progress-confetti-drift': `${((index * 53) % 120) - 60}px`,
        '--gate-progress-confetti-delay': `${(index % 9) * 45}ms`,
    } as CSSProperties,
}));

function toRatio(guestsIn: number, guestsExpected: number): number {
    return guestsExpected > 0 ? Math.min(guestsIn / guestsExpected, 1) : 0;
}

export function findCrossedMilestone(previousRatio: number, nextRatio: number): Milestone | null {
    const crossed = MILESTONES.filter(
        (milestone) => previousRatio < milestone.ratio && nextRatio >= milestone.ratio,
    );

    return crossed.at(-1) ?? null;
}

export function GateProgress() {
    const { guestsIn, guestsExpected, eventStartsAt } = useAppContext('gateProgress');
    const ratio = toRatio(guestsIn, guestsExpected);
    const [highestRatio, setHighestRatio] = useState(ratio);
    const [celebration, setCelebration] = useState<Celebration | null>(null);

    if (ratio > highestRatio) {
        const crossed = findCrossedMilestone(highestRatio, ratio);

        setHighestRatio(ratio);

        if (crossed) {
            const guestsAtMark = Math.round(guestsExpected * crossed.ratio);

            setCelebration({
                ...crossed,
                detail:
                    crossed.ratio === 1
                        ? 'Every guest is through the gate'
                        : `${guestsAtMark} guests through the gate`,
                key: (celebration?.key ?? 0) + 1,
            });
        }
    }

    const percent = Math.round(ratio * 100);
    const progressStyle = { '--gate-progress-ratio': ratio } as CSSProperties;

    return (
        <section className="gate-progress" aria-label="Guests through the gate">
            <div className="gate-progress-head">
                <p className="gate-progress-count">
                    <strong className="gate-progress-count-value">{guestsIn}</strong>
                    <span className="gate-progress-count-total">of {guestsExpected} guests in</span>
                </p>

                <p className="gate-progress-percent">{percent}%</p>
            </div>

            {guestsExpected > 0 ? (
                <>
                    <div
                        className="gate-progress-runway"
                        role="progressbar"
                        aria-label="Guests through the gate"
                        aria-valuemin={0}
                        aria-valuemax={guestsExpected}
                        aria-valuenow={guestsIn}
                        style={progressStyle}
                    >
                        <span className="gate-progress-runway-covered" />
                        <PlaneIcon className="gate-progress-plane" aria-hidden="true" />
                    </div>

                    <div className="gate-progress-marks" aria-hidden="true">
                        {RUNWAY_MARKS.map((mark) => (
                            <span key={mark} className="gate-progress-mark">
                                {mark * 100}%
                            </span>
                        ))}
                    </div>
                </>
            ) : (
                <p className="gate-progress-empty">No bookings yet</p>
            )}

            <p className="gate-progress-event">
                Event starts {formatDate(new Date(eventStartsAt), 'time')}
            </p>

            <p className="visually-hidden" role="status">
                {celebration ? `${celebration.title}. ${celebration.detail}` : ''}
            </p>

            {celebration && (
                <div key={celebration.key} className="gate-progress-celebration">
                    <div className="gate-progress-confetti" aria-hidden="true">
                        {CONFETTI_PIECES.map((piece, index) => (
                            <span
                                key={index}
                                className="gate-progress-confetti-piece"
                                data-tone={piece.tone}
                                style={piece.style}
                            />
                        ))}
                    </div>

                    <p
                        className="gate-progress-banner"
                        aria-hidden="true"
                        onAnimationEnd={() => setCelebration(null)}
                    >
                        <strong className="gate-progress-banner-title">{celebration.title}</strong>
                        <span className="gate-progress-banner-detail">{celebration.detail}</span>
                    </p>
                </div>
            )}
        </section>
    );
}
