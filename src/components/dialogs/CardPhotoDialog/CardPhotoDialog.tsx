'use client';
import Image from 'next/image';
import './cardPhotoDialog.scss';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/Dialog/Dialog';

type CardPhoto = { name: string; src: string };

const LARGE_PHOTO_SIZE = { width: 640, height: 404 };

export function CardPhotoDialog({
    photo,
    onClose,
}: {
    photo: CardPhoto | null;
    onClose: () => void;
}) {
    return (
        <Dialog open={photo !== null} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="card-photo-dialog">
                <DialogHeader>
                    <DialogTitle>{photo?.name}</DialogTitle>
                    <DialogDescription>
                        Aadhaar details are hidden. Match the face and the name.
                    </DialogDescription>
                </DialogHeader>

                {photo && (
                    <Image
                        src={photo.src}
                        alt={`Masked Aadhaar card of ${photo.name}`}
                        width={LARGE_PHOTO_SIZE.width}
                        height={LARGE_PHOTO_SIZE.height}
                        unoptimized
                        draggable={false}
                        className="card-photo-dialog-image"
                    />
                )}

                <DialogFooter showCloseButton />
            </DialogContent>
        </Dialog>
    );
}

export type { CardPhoto };
