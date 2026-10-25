'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import {
    CheckIcon,
    CircleAlertIcon,
    LoaderCircleIcon,
    RotateCcwIcon,
    ScanLineIcon,
    XIcon,
    type LucideIcon,
} from 'lucide-react';
import './scanResult.scss';
import type { CardPhoto } from '@/components/dialogs/CardPhotoDialog/CardPhotoDialog';
import { Button } from '@/components/ui/Button/Button';
import { StatTiles } from '@/components/widgets/StatTiles/StatTiles';
import { useAppContext, useUpdateAppContext } from '@/context/appContext';
import { INITIAL_SCANNER, type CheckInCounts, type ScannerState } from '@/context/appStore';
import { api } from '@/services/client/api';
import { ZONE_LABELS, type CheckInGuest, type CheckInResult } from '@/types/booking';
import { formatDate } from '@/utils/dates';
import { pluralize } from '@/utils/text';

export type ScanOutcome = 'ok' | 'used' | 'bad';

type ScanCardState = ScanOutcome | 'checking' | 'error';

type ScanDetail = {
    label: string;
    value: ReactNode;
    isWide?: boolean;
    isMono?: boolean;
    isProminent?: boolean;
};

type ScanCopy = { title: string; subtitle: string; details: ScanDetail[] };

const OUTCOME_BY_RESULT: Record<CheckInResult['outcome'], ScanOutcome> = {
    checked_in: 'ok',
    already_checked_in: 'used',
    invalid: 'bad',
};

const OUTCOME_ICONS: Record<ScanOutcome, LucideIcon> = {
    ok: CheckIcon,
    used: CircleAlertIcon,
    bad: XIcon,
};

const TALLY_LABELS: Record<CheckInResult['outcome'], string> = {
    checked_in: 'Checked in',
    already_checked_in: 'Already used',
    invalid: 'Invalid',
};

const THUMBNAIL_SIZE = { width: 56, height: 36 };
const SINGLE_PULSE_MS = 60;
const WARNING_PULSE_MS = [80, 60, 80];
const COUNTS_STORAGE_PREFIX = 'scanner-counts:';

const CardPhotoDialog = dynamic(
    () =>
        import('@/components/dialogs/CardPhotoDialog/CardPhotoDialog').then(
            (module) => module.CardPhotoDialog,
        ),
    { ssr: false },
);

function GuestCards({ guests }: { guests: CheckInGuest[] }) {
    const [openPhoto, setOpenPhoto] = useState<CardPhoto | null>(null);
    const [hasOpened, setHasOpened] = useState(false);

    const showPhoto = (photo: CardPhoto) => {
        setHasOpened(true);
        setOpenPhoto(photo);
    };

    return (
        <>
            <ul className="scan-result-guests">
                {guests.map((guest, index) => {
                    const src = guest.photoToken
                        ? api.aadhaarPhotos.maskedUrl(guest.photoToken)
                        : null;

                    return (
                        <li key={index} className="scan-result-guest">
                            {src ? (
                                <button
                                    type="button"
                                    className="scan-result-guest-photo"
                                    aria-label={`Show the card photo of ${guest.name}`}
                                    onClick={() => showPhoto({ name: guest.name, src })}
                                >
                                    <Image
                                        src={src}
                                        alt=""
                                        width={THUMBNAIL_SIZE.width}
                                        height={THUMBNAIL_SIZE.height}
                                        unoptimized
                                        loading="eager"
                                        draggable={false}
                                    />
                                </button>
                            ) : (
                                <span className="scan-result-guest-photo" data-empty="true">
                                    No photo
                                </span>
                            )}
                            <span className="scan-result-guest-name">{guest.name}</span>
                        </li>
                    );
                })}
            </ul>

            {hasOpened && <CardPhotoDialog photo={openPhoto} onClose={() => setOpenPhoto(null)} />}
        </>
    );
}

function writeStoredCounts(storageKey: string, counts: CheckInCounts) {
    try {
        sessionStorage.setItem(storageKey, JSON.stringify(counts));
    } catch {
        return;
    }
}

function describeResult(result: CheckInResult): ScanCopy {
    if (result.outcome === 'invalid') {
        return {
            title: 'Invalid pass',
            subtitle: "This QR code isn't a booking for this event",
            details: [
                {
                    label: 'What to do',
                    value: 'Do not allow entry. Ask the guest to show the email with their pass.',
                    isWide: true,
                },
            ],
        };
    }

    const zoneDetails: ScanDetail[] = [
        { label: 'Zone', value: result.zone, isProminent: true },
        { label: 'Seats', value: result.seatCount, isProminent: true },
    ];

    if (result.outcome === 'already_checked_in') {
        const checkedInAt = result.checkedInAt
            ? ` at ${formatDate(new Date(result.checkedInAt), 'time')}`
            : '';

        return {
            title: 'Already checked in',
            subtitle: `Checked in${checkedInAt} by ${result.checkedInByName ?? 'another checker'}`,
            details: [
                ...zoneDetails,
                { label: 'Student', value: result.studentName, isWide: true },
                {
                    label: pluralize(result.guests.length, 'Guest'),
                    value: <GuestCards guests={result.guests} />,
                    isWide: true,
                },
                {
                    label: 'What to do',
                    value: 'Do not allow entry again. Ask the guest to speak to the event organizers.',
                    isWide: true,
                },
            ],
        };
    }

    const guestCount = result.guests.length;
    const leadAadhaar = result.guests[0]?.aadhaarMasked;

    return {
        title: `Allow entry · ${guestCount} ${pluralize(guestCount, 'guest')}`,
        subtitle: 'Checked in just now',
        details: [
            ...zoneDetails,
            { label: 'Student', value: result.studentName },
            { label: 'Group', value: result.studentGroup },
            ...(leadAadhaar
                ? [{ label: 'Guest 1 Aadhaar', value: leadAadhaar, isMono: true }]
                : []),
            {
                label: pluralize(guestCount, 'Guest'),
                value: <GuestCards guests={result.guests} />,
                isWide: true,
            },
        ],
    };
}

function ScanResultBody({ result, error, isChecking }: ScannerState) {
    if (isChecking || error || !result) {
        const message = isChecking
            ? { icon: LoaderCircleIcon, title: 'Checking pass…', text: 'Hold the pass steady.' }
            : error
              ? {
                    icon: RotateCcwIcon,
                    title: 'Could not check this pass, scan again',
                    text: error,
                }
              : {
                    icon: ScanLineIcon,
                    title: 'Waiting for a scan…',
                    text: 'Results appear here instantly.',
                };
        const MessageIcon = message.icon;

        return (
            <div className="scan-result-message">
                <MessageIcon className="scan-result-message-icon" aria-hidden="true" />
                <p className="scan-result-message-title">{message.title}</p>
                <p className="scan-result-message-text">{message.text}</p>
            </div>
        );
    }

    const outcome = toScanOutcome(result);
    const OutcomeIcon = OUTCOME_ICONS[outcome];
    const copy = describeResult(result);

    return (
        <>
            <div className="scan-result-head">
                <span className="scan-result-icon" aria-hidden="true">
                    <OutcomeIcon />
                </span>
                <div className="scan-result-heading">
                    <h2 className="scan-result-title">{copy.title}</h2>
                    <p className="scan-result-subtitle">{copy.subtitle}</p>
                </div>
            </div>

            <dl className="scan-result-details">
                {copy.details.map((detail) => (
                    <div
                        key={detail.label}
                        className="scan-result-detail"
                        data-wide={detail.isWide || undefined}
                    >
                        <dt className="scan-result-detail-label">{detail.label}</dt>
                        <dd
                            className="scan-result-detail-value"
                            data-mono={detail.isMono || undefined}
                            data-prominent={detail.isProminent || undefined}
                        >
                            {detail.value}
                        </dd>
                    </div>
                ))}
            </dl>
        </>
    );
}

function readCardState({ result, error, isChecking }: ScannerState): ScanCardState | undefined {
    if (isChecking) return 'checking';

    if (error) return 'error';

    return result ? toScanOutcome(result) : undefined;
}

export function describeAnnouncement({ result, error, isChecking }: ScannerState): string {
    if (isChecking) return 'Checking pass';

    if (error) return 'Could not check this pass, scan again';

    if (!result) return '';

    const { title } = describeResult(result);
    if (result.outcome !== 'checked_in') return title;

    return `${title} · ${ZONE_LABELS[result.zone]}, ${result.seatCount} ${pluralize(result.seatCount, 'seat')}`;
}

export function readStoredCounts(storageKey: string): CheckInCounts | null {
    try {
        const stored = sessionStorage.getItem(storageKey);

        return stored ? { ...INITIAL_SCANNER.counts, ...JSON.parse(stored) } : null;
    } catch {
        return null;
    }
}

export function toScanOutcome(result: CheckInResult): ScanOutcome {
    return OUTCOME_BY_RESULT[result.outcome];
}

export function vibrationPattern(outcome: ScanOutcome): number | number[] {
    return outcome === 'ok' ? SINGLE_PULSE_MS : WARNING_PULSE_MS;
}

export function ScanTally({ checkerId }: { checkerId: string }) {
    const { counts } = useAppContext('scanner');
    const updateAppContext = useUpdateAppContext();
    const hasRestoredRef = useRef(false);

    const storageKey = `${COUNTS_STORAGE_PREFIX}${checkerId}`;

    useEffect(() => {
        if (!hasRestoredRef.current) {
            hasRestoredRef.current = true;

            const storedCounts = readStoredCounts(storageKey);

            if (storedCounts) {
                updateAppContext('scanner', { counts: storedCounts });
                return;
            }
        }

        writeStoredCounts(storageKey, counts);
    }, [counts, storageKey, updateAppContext]);

    const outcomes = Object.keys(TALLY_LABELS) as CheckInResult['outcome'][];

    return (
        <StatTiles
            variant="counter"
            tiles={outcomes.map((outcome) => ({
                label: TALLY_LABELS[outcome],
                value: counts[outcome],
            }))}
        />
    );
}

export function ScanResult() {
    const scanner = useAppContext('scanner');
    const updateAppContext = useUpdateAppContext();

    const hasContent = scanner.result !== null || scanner.error !== null;

    return (
        <section className="scan-result" aria-label="Scan result">
            <p className="visually-hidden" role="status">
                {describeAnnouncement(scanner)}
            </p>

            <div
                key={scanner.scanKey}
                className="scan-result-card"
                data-outcome={readCardState(scanner)}
            >
                <ScanResultBody {...scanner} />
            </div>

            <Button
                className="scan-result-next"
                size="lg"
                data-visible={hasContent || undefined}
                disabled={!hasContent}
                onClick={() => updateAppContext('scanner', { result: null, error: null })}
            >
                Scan next guest
            </Button>
        </section>
    );
}
