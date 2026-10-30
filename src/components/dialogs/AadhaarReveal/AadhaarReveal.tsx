'use client';
import { Suspense, use, useState } from 'react';
import Image from 'next/image';
import { Trash2Icon } from 'lucide-react';
import './aadhaarReveal.scss';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/Dialog/Dialog';
import { Alert, AlertDescription } from '@/components/ui/Alert/Alert';
import { Button } from '@/components/ui/Button/Button';
import { Skeleton } from '@/components/ui/Skeleton/Skeleton';
import { useToast } from '@/components/ui/Toast/Toast';
import { ApiError, api } from '@/services/client/api';
import { AADHAAR_GROUP_SIZE, type CardCheck } from '@/types/booking';
import { groupCharacters } from '@/utils/text';

type RevealedGuest = {
    name: string;
    aadhaar: string | null;
    hasPhoto: boolean;
    cardCheck: CardCheck | null;
};

type RevealResult =
    { status: 'loaded'; guests: RevealedGuest[] } | { status: 'failed'; message: string };

type RevealTarget = {
    bookingId: string;
    studentName: string;
    guestCount: number;
    result: Promise<RevealResult>;
};

type DeleteState = 'idle' | 'confirming' | 'deleting' | 'deleted';

const CARD_PHOTO_SIZE = { width: 320, height: 202 };
const CARD_CHECK_LABELS: Record<Exclude<CardCheck, 'verified'>, string> = {
    mismatch: 'The number on the card did not match the one entered',
    unverified: 'The card could not be read automatically',
};

function GuestSkeletons({ count }: { count: number }) {
    return (
        <ul className="aadhaar-reveal-list" aria-busy="true">
            {Array.from({ length: count }, (_, index) => (
                <li key={index} className="aadhaar-reveal-guest">
                    <Skeleton width="40%" height={14} />
                    <Skeleton width={128} height={14} />
                </li>
            ))}
        </ul>
    );
}

function DeletePhotos({
    bookingId,
    state,
    onStateChange,
}: {
    bookingId: string;
    state: DeleteState;
    onStateChange: (state: DeleteState) => void;
}) {
    const { toast } = useToast();

    const deletePhotos = async () => {
        onStateChange('deleting');

        try {
            await api.aadhaarPhotos.deleteForBooking(bookingId);

            onStateChange('deleted');
            toast({ title: 'Aadhaar photos deleted', tone: 'success' });
        } catch (error) {
            if (!(error instanceof ApiError)) throw error;

            onStateChange('idle');
            toast({ title: 'Photos were not deleted', description: error.message, tone: 'error' });
        }
    };

    if (state === 'idle') {
        return (
            <Button variant="outline" onClick={() => onStateChange('confirming')}>
                <Trash2Icon />
                Delete Aadhaar photos
            </Button>
        );
    }

    return (
        <div className="aadhaar-reveal-confirm" role="group" aria-label="Confirm photo deletion">
            <p className="aadhaar-reveal-confirm-text">
                Delete this booking&apos;s card photos? This cannot be undone.
            </p>
            <Button variant="ghost" onClick={() => onStateChange('idle')}>
                Cancel
            </Button>
            <Button
                variant="destructive"
                loading={state === 'deleting'}
                onClick={() => void deletePhotos()}
            >
                Delete photos
            </Button>
        </div>
    );
}

function RevealedGuests({ target }: { target: RevealTarget }) {
    const reveal = use(target.result);
    const [deleteState, setDeleteState] = useState<DeleteState>('idle');

    if (reveal.status === 'failed') {
        return (
            <Alert variant="destructive">
                <AlertDescription>{reveal.message}</AlertDescription>
            </Alert>
        );
    }

    const hasPhotos = reveal.guests.some((guest) => guest.hasPhoto) && deleteState !== 'deleted';

    return (
        <>
            <ul className="aadhaar-reveal-list">
                {reveal.guests.map((guest, index) => (
                    <li key={index} className="aadhaar-reveal-guest">
                        <div className="aadhaar-reveal-guest-row">
                            <span className="aadhaar-reveal-name">{guest.name}</span>
                            {guest.aadhaar ? (
                                <span className="aadhaar-reveal-number">
                                    {groupCharacters(guest.aadhaar, AADHAAR_GROUP_SIZE)}
                                </span>
                            ) : (
                                <span className="aadhaar-reveal-purged">Removed</span>
                            )}
                        </div>

                        {guest.cardCheck && guest.cardCheck !== 'verified' && (
                            <span className="aadhaar-reveal-card-check">
                                {CARD_CHECK_LABELS[guest.cardCheck]}
                            </span>
                        )}

                        {guest.hasPhoto && deleteState !== 'deleted' ? (
                            <Image
                                src={api.aadhaarPhotos.originalUrl(target.bookingId, index)}
                                alt={`Aadhaar card of ${guest.name}`}
                                width={CARD_PHOTO_SIZE.width}
                                height={CARD_PHOTO_SIZE.height}
                                unoptimized
                                className="aadhaar-reveal-photo"
                            />
                        ) : (
                            <span className="aadhaar-reveal-purged">
                                {deleteState === 'deleted' ? 'Photos deleted' : 'No card photo'}
                            </span>
                        )}
                    </li>
                ))}
            </ul>

            {hasPhotos && (
                <DeletePhotos
                    bookingId={target.bookingId}
                    state={deleteState}
                    onStateChange={setDeleteState}
                />
            )}
        </>
    );
}

export function AadhaarReveal({
    target,
    onClose,
}: {
    target: RevealTarget | null;
    onClose: () => void;
}) {
    const [shownTarget, setShownTarget] = useState(target);

    if (target && target !== shownTarget) setShownTarget(target);

    return (
        <Dialog
            open={target !== null}
            onOpenChange={(isOpen) => !isOpen && onClose()}
            onOpenChangeComplete={(isOpen) => !isOpen && setShownTarget(null)}
        >
            <DialogContent className="aadhaar-reveal">
                <DialogHeader>
                    <DialogTitle>Aadhaar details</DialogTitle>
                    <DialogDescription>
                        {shownTarget?.studentName}. This reveal is recorded in the audit log.
                    </DialogDescription>
                </DialogHeader>

                {shownTarget && (
                    <Suspense fallback={<GuestSkeletons count={shownTarget.guestCount} />}>
                        <RevealedGuests key={shownTarget.bookingId} target={shownTarget} />
                    </Suspense>
                )}

                <DialogFooter showCloseButton />
            </DialogContent>
        </Dialog>
    );
}

export type { RevealResult, RevealTarget };
