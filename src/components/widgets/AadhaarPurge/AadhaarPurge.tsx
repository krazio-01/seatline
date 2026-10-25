'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { ConfirmRequest } from '@/components/dialogs/ConfirmDialog/ConfirmDialog';
import './aadhaarPurge.scss';
import { Button } from '@/components/ui/Button/Button';
import { useToast } from '@/components/ui/Toast/Toast';
import { api } from '@/services/client/api';
import { pluralize } from '@/utils/text';

const ConfirmDialog = dynamic(
    () =>
        import('@/components/dialogs/ConfirmDialog/ConfirmDialog').then(
            (module) => module.ConfirmDialog,
        ),
    { ssr: false },
);

const CONFIRM_PHRASE = 'DELETE';

export function AadhaarPurge() {
    const { toast } = useToast();
    const [request, setRequest] = useState<ConfirmRequest | null>(null);
    const [hasOpened, setHasOpened] = useState(false);

    const purge = async () => {
        const { bookingsUpdated } = await api.aadhaar.purge();

        toast({
            title: 'Aadhaar data removed',
            description: `${bookingsUpdated} ${pluralize(bookingsUpdated, 'booking')} updated.`,
            tone: 'success',
        });
    };

    const openConfirm = () => {
        setHasOpened(true);
        setRequest({
            title: 'Remove all Aadhaar data?',
            description:
                'Removes every Aadhaar number and card photo. Masked digits and gate photos go too, and reveals stop working. This cannot be undone.',
            confirmLabel: 'Remove all',
            tone: 'destructive',
            confirmPhrase: CONFIRM_PHRASE,
            onConfirm: purge,
        });
    };

    return (
        <div className="aadhaar-purge">
            <div>
                <h3 className="aadhaar-purge-title">Stored Aadhaar data</h3>
                <p className="aadhaar-purge-description">
                    Removes every Aadhaar number and card photo. Do this once the event is over.
                    Each removal is recorded in the audit log.
                </p>
            </div>

            <Button variant="destructive" onClick={openConfirm}>
                Remove Aadhaar data
            </Button>

            {hasOpened && <ConfirmDialog request={request} onClose={() => setRequest(null)} />}
        </div>
    );
}
