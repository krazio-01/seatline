'use client';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import Image from 'next/image';
import { CameraIcon, CheckIcon, ImageUpIcon, LoaderCircleIcon, RotateCcwIcon } from 'lucide-react';
import './aadhaarPhotoField.scss';
import { FieldError } from '@/components/forms/FieldError/FieldError';
import { Button } from '@/components/ui/Button/Button';
import { ApiError, api, fieldErrorsOf } from '@/services/client/api';

type PhotoState =
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'accepted'; previewUrl: string }
    | { status: 'rejected'; message: string };

const LONGEST_SIDE = 1600;
const JPEG_QUALITY = 0.8;
const THUMBNAIL_SIZE = { width: 72, height: 46 };
const UNREADABLE_PHOTO_MESSAGE =
    "We couldn't open this photo. Take a new one or choose a JPEG, PNG or WebP photo.";

function describeUploadFailure(error: unknown): string {
    if (!(error instanceof ApiError)) return UNREADABLE_PHOTO_MESSAGE;

    const issues = fieldErrorsOf(error);

    return issues.image ?? issues.name ?? issues.aadhaar ?? error.message;
}

async function shrinkImage(file: Blob, longestSide: number, quality: number): Promise<Blob> {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, longestSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.floor(bitmap.width * scale);
    const height = Math.floor(bitmap.height * scale);

    if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(width, height);

        canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();

        return canvas.convertToBlob({ type: 'image/jpeg', quality });
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    return new Promise((resolve, reject) =>
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('Could not read the photo'))),
            'image/jpeg',
            quality,
        ),
    );
}

export function AadhaarPhotoField({
    aadhaar,
    name,
    isReady,
    photoId,
    errorMessage,
    onChange,
}: {
    aadhaar: string;
    name: string;
    isReady: boolean;
    photoId: string;
    errorMessage?: string;
    onChange: (photoId: string) => void;
}) {
    const fieldId = useId();
    const cameraInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadRef = useRef<AbortController | null>(null);
    const [state, setState] = useState<PhotoState>({ status: 'idle' });

    const previewUrl = state.status === 'accepted' ? state.previewUrl : null;
    const shownState: PhotoState =
        state.status === 'accepted' && !photoId ? { status: 'idle' } : state;
    const message = shownState.status === 'rejected' ? shownState.message : errorMessage;
    const labelId = `${fieldId}-label`;
    const hintId = `${fieldId}-hint`;
    const errorId = `${fieldId}-error`;

    useEffect(() => () => uploadRef.current?.abort(), []);

    useEffect(() => {
        if (!previewUrl) return;

        return () => URL.revokeObjectURL(previewUrl);
    }, [previewUrl]);

    const upload = async (file: File) => {
        uploadRef.current?.abort();

        const controller = new AbortController();
        uploadRef.current = controller;

        setState({ status: 'checking' });
        onChange('');

        try {
            const image = await shrinkImage(file, LONGEST_SIDE, JPEG_QUALITY);
            const accepted = await api.aadhaarPhotos.upload(
                { image, aadhaar, name },
                controller.signal,
            );

            setState({ status: 'accepted', previewUrl: URL.createObjectURL(image) });
            onChange(accepted.photoId);
        } catch (error) {
            if (controller.signal.aborted) return;

            setState({ status: 'rejected', message: describeUploadFailure(error) });
        }
    };

    const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
        const [file] = event.target.files ?? [];
        event.target.value = '';

        if (file) void upload(file);
    };

    const isChecking = shownState.status === 'checking';
    const canPick = isReady && !isChecking;

    return (
        <div
            className="aadhaar-photo-field"
            role="group"
            aria-labelledby={labelId}
            aria-describedby={message ? errorId : hintId}
            data-state={shownState.status}
        >
            <span id={labelId} className="aadhaar-photo-field-label">
                Aadhaar card (front)
            </span>

            <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="visually-hidden"
                tabIndex={-1}
                aria-hidden="true"
                onChange={pickFile}
            />
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="visually-hidden"
                tabIndex={-1}
                aria-hidden="true"
                onChange={pickFile}
            />

            {shownState.status === 'accepted' ? (
                <div className="aadhaar-photo-field-preview">
                    <Image
                        src={shownState.previewUrl}
                        alt="Your Aadhaar card photo"
                        width={THUMBNAIL_SIZE.width}
                        height={THUMBNAIL_SIZE.height}
                        unoptimized
                        className="aadhaar-photo-field-thumbnail"
                    />
                    <span className="aadhaar-photo-field-accepted">
                        <CheckIcon aria-hidden="true" />
                        Card checked
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => cameraInputRef.current?.click()}
                    >
                        <RotateCcwIcon />
                        Retake
                    </Button>
                </div>
            ) : (
                <div className="aadhaar-photo-field-actions">
                    <Button
                        variant="outline"
                        disabled={!canPick}
                        onClick={() => cameraInputRef.current?.click()}
                    >
                        <CameraIcon />
                        Take photo
                    </Button>
                    <Button
                        variant="outline"
                        disabled={!canPick}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <ImageUpIcon />
                        Choose photo
                    </Button>
                </div>
            )}

            <p id={hintId} className="aadhaar-photo-field-hint" aria-live="polite">
                {isChecking ? (
                    <>
                        <LoaderCircleIcon
                            className="aadhaar-photo-field-spinner"
                            aria-hidden="true"
                        />
                        Checking your card…
                    </>
                ) : isReady ? (
                    'The whole front of the card, in good light.'
                ) : (
                    'Enter the name and Aadhaar number first'
                )}
            </p>

            <FieldError id={errorId} message={message} />
        </div>
    );
}
