'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
    CameraIcon,
    CameraOffIcon,
    CircleDashedIcon,
    FlashlightIcon,
    FlashlightOffIcon,
    LockKeyholeIcon,
    VideoOffIcon,
    WebcamIcon,
    type LucideIcon,
} from 'lucide-react';
import type QrScanner from 'qr-scanner';
import './camera.scss';
import { SCANNER_SIGN_IN_HREF } from '@/components/layout/navigation';
import { CameraHud, type CameraHudState } from '@/components/media/Camera/CameraHud';
import { Button } from '@/components/ui/Button/Button';
import { Notice } from '@/components/widgets/Notice/Notice';
import {
    toScanOutcome,
    vibrationPattern,
    type ScanOutcome,
} from '@/components/widgets/ScanResult/ScanResult';
import { useAppContext, useAppRuntime, useUpdateAppContext } from '@/context/appContext';
import { admitGuests, recordCheckIn, recordCheckInFailure } from '@/context/appStore';
import { ApiError, api } from '@/services/client/api';
import type { CheckInResult } from '@/types/booking';

type CameraProblem = 'blocked' | 'missing' | 'busy' | 'insecure' | 'stalled';

type CameraState = 'starting' | 'live' | CameraProblem;

export type TokenRead = { lastSeenAt: number; failures: number; retryAt: number };

type TorchState = { isAvailable: boolean; isOn: boolean };

type FocusCapabilities = MediaTrackCapabilities & { focusMode?: string[] };

const SAME_TOKEN_WINDOW_MS = 2500;
const CHECK_IN_TIMEOUT_MS = 8000;
const RETRY_BACKOFF_MS = [2500, 5000, 10_000];
const MS_PER_SECOND = 1000;
const MAX_RETRY_AFTER_SECONDS = 60;
const FAILURE_COOL_DOWN_MS = 1000;
const FORGET_TOKEN_AFTER_MS = 30_000;
const LOST_REPLY_WINDOW_MS = 2 * 60_000;
const MAX_SCANS_PER_SECOND = 8;
const SCAN_REGION_SHARE = 0.85;
const SCAN_RESOLUTION_PX = 640;
const CONTINUOUS_FOCUS = { focusMode: 'continuous' } as MediaTrackConstraintSet;
const NO_TORCH: TorchState = { isAvailable: false, isOn: false };
const STARTING_HINT = 'Starting the camera…';
const CHECKING_HINT = 'Checking pass…';
const FAILED_HINT = 'Check failed, scan again';
const IDLE_HINT = "Point the camera at the guest's QR pass";

const OUTCOME_HINTS: Record<ScanOutcome, string> = {
    ok: 'Pass accepted',
    used: 'Pass already used',
    bad: 'Code not recognised',
};

const CAMERA_PROBLEMS: Record<
    CameraProblem,
    { icon: LucideIcon; title: string; description: string }
> = {
    blocked: {
        icon: CameraOffIcon,
        title: 'Allow camera access',
        description:
            'The scanner needs the camera to read guest passes. Allow camera access for this site in your browser settings, then try again.',
    },
    missing: {
        icon: VideoOffIcon,
        title: 'No camera found',
        description:
            'This device has no camera the scanner can use. Connect a camera or switch to a phone with one, then try again.',
    },
    busy: {
        icon: WebcamIcon,
        title: 'Camera is busy',
        description:
            'Another app or tab is using the camera. Close it, then try again to bring the viewfinder back.',
    },
    insecure: {
        icon: LockKeyholeIcon,
        title: 'Open this page over HTTPS',
        description:
            'Browsers only share the camera with secure pages. Open the scanner from its https:// address, then try again.',
    },
    stalled: {
        icon: CircleDashedIcon,
        title: "Camera didn't start, try again",
        description:
            'The camera is available but the viewfinder did not open. Try again, or reload the page if it keeps happening.',
    },
};

const CAMERA_PROBLEM_BY_ERROR: Record<string, CameraProblem> = {
    NotAllowedError: 'blocked',
    SecurityError: 'blocked',
    NotFoundError: 'missing',
    OverconstrainedError: 'missing',
    NotReadableError: 'busy',
    AbortError: 'busy',
};

const INVALID_RESULT: CheckInResult = { outcome: 'invalid' };

function subscribeToVisibility(onChange: () => void) {
    document.addEventListener('visibilitychange', onChange);

    return () => document.removeEventListener('visibilitychange', onChange);
}

function readIsPageVisible(): boolean {
    return document.visibilityState === 'visible';
}

function readIsPageVisibleOnServer(): boolean {
    return true;
}

async function readCameraPermission(): Promise<PermissionState | null> {
    try {
        const status = await navigator.permissions.query({ name: 'camera' as PermissionName });

        return status.state;
    } catch {
        return null;
    }
}

async function diagnoseCamera(): Promise<CameraProblem | 'available'> {
    if (!window.isSecureContext) return 'insecure';

    if (!navigator.mediaDevices) return 'missing';

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();

        if (!devices.some((device) => device.kind === 'videoinput')) return 'missing';
    } catch {
        return 'stalled';
    }

    const permission = await readCameraPermission();

    if (permission === 'denied' || permission === 'prompt') return 'blocked';

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });

        stream.getTracks().forEach((track) => track.stop());

        return 'available';
    } catch (error) {
        return CAMERA_PROBLEM_BY_ERROR[(error as Error).name] ?? 'blocked';
    }
}

function centredScanRegion(video: HTMLVideoElement): QrScanner.ScanRegion {
    const size = Math.round(SCAN_REGION_SHARE * Math.min(video.videoWidth, video.videoHeight));
    const resolution = Math.min(size, SCAN_RESOLUTION_PX);

    return {
        x: Math.round((video.videoWidth - size) / 2),
        y: Math.round((video.videoHeight - size) / 2),
        width: size,
        height: size,
        downScaledWidth: resolution,
        downScaledHeight: resolution,
    };
}

async function keepFocusContinuous(track: MediaStreamTrack) {
    const capabilities: FocusCapabilities = track.getCapabilities?.() ?? {};

    if (!capabilities.focusMode?.includes('continuous')) return;

    try {
        await track.applyConstraints({ advanced: [CONTINUOUS_FOCUS] });
    } catch {
        return;
    }
}

function stopVideoStream(video: HTMLVideoElement) {
    const stream = video.srcObject;

    if (!(stream instanceof MediaStream)) return;

    stream.getTracks().forEach((track) => track.stop());
}

function forgetStaleReads(reads: Map<string, TokenRead>, now: number) {
    for (const [token, read] of reads) {
        const isForgotten = now - read.lastSeenAt > FORGET_TOKEN_AFTER_MS;

        if (isForgotten && now >= read.retryAt) reads.delete(token);
    }
}

export function recoverLostCheckIn(
    result: CheckInResult,
    wasRetry: boolean,
    now: number,
): CheckInResult {
    if (result.outcome !== 'already_checked_in' || !wasRetry || !result.isOwnCheckIn) return result;

    if (now - Date.parse(result.checkedInAt) > LOST_REPLY_WINDOW_MS) return result;

    const { studentName, studentGroup, zone, seatCount, guests } = result;

    return { outcome: 'checked_in', studentName, studentGroup, zone, seatCount, guests };
}

export function isReadDue(read: TokenRead | undefined, now: number): boolean {
    if (!read) return true;

    if (read.failures > 0) return now >= read.retryAt;

    return now - read.lastSeenAt >= SAME_TOKEN_WINDOW_MS;
}

export function retryDelayMs(failures: number, retryAfterSeconds?: number): number {
    if (retryAfterSeconds) {
        return Math.min(retryAfterSeconds, MAX_RETRY_AFTER_SECONDS) * MS_PER_SECOND;
    }

    return RETRY_BACKOFF_MS[Math.min(failures, RETRY_BACKOFF_MS.length) - 1];
}

export function coolDownUntil(failedAt: number, retryAfterSeconds?: number): number {
    return (
        failedAt + (retryAfterSeconds ? retryDelayMs(1, retryAfterSeconds) : FAILURE_COOL_DOWN_MS)
    );
}

export function Camera() {
    const { result, scanKey, error, isChecking } = useAppContext('scanner');
    const { store } = useAppRuntime();
    const updateAppContext = useUpdateAppContext();
    const videoRef = useRef<HTMLVideoElement>(null);
    const readsRef = useRef(new Map<string, TokenRead>());
    const coolDownUntilRef = useRef(0);
    const hasAutoRetriedRef = useRef(false);
    const scannerRef = useRef<QrScanner | null>(null);
    const [cameraState, setCameraState] = useState<CameraState>('starting');
    const [torch, setTorch] = useState<TorchState>(NO_TORCH);
    const [isTorchUnavailable, setIsTorchUnavailable] = useState(false);
    const [isCameraOn, setIsCameraOn] = useState(true);
    const [startAttempt, setStartAttempt] = useState(0);

    const isPageVisible = useSyncExternalStore(
        subscribeToVisibility,
        readIsPageVisible,
        readIsPageVisibleOnServer,
    );

    const outcome = result && !isChecking ? toScanOutcome(result) : null;
    const guestCount = result && result.outcome !== 'invalid' ? result.guests.length : 0;
    const problem = cameraState === 'starting' || cameraState === 'live' ? null : cameraState;

    const statusHint = isChecking
        ? CHECKING_HINT
        : error
          ? FAILED_HINT
          : outcome
            ? OUTCOME_HINTS[outcome]
            : IDLE_HINT;

    const hint = cameraState === 'starting' ? STARTING_HINT : statusHint;

    const statusHudState: CameraHudState = isChecking
        ? 'checking'
        : error
          ? 'error'
          : (outcome ?? 'idle');

    const hudState = cameraState === 'live' ? statusHudState : 'starting';

    const checkIn = useCallback(
        async (token: string) => {
            const now = Date.now();
            const reads = readsRef.current;

            forgetStaleReads(reads, now);

            const read = reads.get(token);

            if (read && !isReadDue(read, now)) {
                read.lastSeenAt = now;
                return;
            }

            const isBusy = store.getState().scanner?.isChecking;

            if (isBusy || now < coolDownUntilRef.current) return;

            const sentRead = { lastSeenAt: now, failures: read?.failures ?? 0, retryAt: 0 };

            reads.set(token, sentRead);
            updateAppContext('scanner', { isChecking: true });

            let checkInResult = INVALID_RESULT;

            try {
                checkInResult = await api.checkIns.create(
                    token,
                    AbortSignal.timeout(CHECK_IN_TIMEOUT_MS),
                );
            } catch (requestError) {
                const status = requestError instanceof ApiError ? requestError.status : null;

                if (status === 401) {
                    window.location.replace(SCANNER_SIGN_IN_HREF);
                    return;
                }

                if (status !== 400) {
                    const retryAfterSeconds =
                        requestError instanceof ApiError
                            ? requestError.retryAfterSeconds
                            : undefined;
                    const failedAt = Date.now();

                    sentRead.failures += 1;
                    sentRead.lastSeenAt = failedAt;
                    sentRead.retryAt =
                        failedAt + retryDelayMs(sentRead.failures, retryAfterSeconds);
                    coolDownUntilRef.current = coolDownUntil(failedAt, retryAfterSeconds);
                    updateAppContext('scanner', (current) =>
                        recordCheckInFailure(current, (requestError as Error).message),
                    );
                    return;
                }
            }

            checkInResult = recoverLostCheckIn(checkInResult, sentRead.failures > 0, Date.now());
            sentRead.failures = 0;
            sentRead.lastSeenAt = Date.now();
            updateAppContext('scanner', (current) => recordCheckIn(current, checkInResult));

            if (checkInResult.outcome === 'checked_in') {
                const admittedGuests = checkInResult.guests.length;

                updateAppContext('gateProgress', (current) => admitGuests(current, admittedGuests));
            }

            if ('vibrate' in navigator)
                navigator.vibrate(vibrationPattern(toScanOutcome(checkInResult)));
        },
        [store, updateAppContext],
    );

    useEffect(() => {
        if (result || error || isChecking) return;

        readsRef.current.clear();
    }, [result, error, isChecking]);

    useEffect(() => {
        const video = videoRef.current;

        if (!video || !isPageVisible || !isCameraOn) return;

        let isStopped = false;
        let scanner: QrScanner | undefined;

        const reportProblem = async () => {
            const diagnosis = await diagnoseCamera();

            if (isStopped) return;

            if (diagnosis !== 'available') {
                setCameraState(diagnosis);
                return;
            }

            if (hasAutoRetriedRef.current) {
                setCameraState('stalled');
                return;
            }

            hasAutoRetriedRef.current = true;
            setStartAttempt((attempt) => attempt + 1);
        };

        const reportLostCamera = () => {
            if (!isStopped) setCameraState('busy');
        };

        const markLive = () => {
            const stream = video.srcObject;

            if (stream instanceof MediaStream) {
                for (const track of stream.getVideoTracks()) {
                    track.addEventListener('ended', reportLostCamera, { once: true });
                    void keepFocusContinuous(track);
                }
            }

            hasAutoRetriedRef.current = false;
            setCameraState('live');

            void scanner?.hasFlash().then((isAvailable) => {
                if (!isStopped) setTorch({ isAvailable, isOn: false });
            });
        };

        const start = async () => {
            const { default: QrScannerEngine } = await import('qr-scanner');

            if (isStopped) return;

            scanner = new QrScannerEngine(video, (scan) => void checkIn(scan.data), {
                returnDetailedScanResult: true,
                preferredCamera: 'environment',
                maxScansPerSecond: MAX_SCANS_PER_SECOND,
                calculateScanRegion: centredScanRegion,
            });

            scanner.setInversionMode('both');
            scannerRef.current = scanner;

            await scanner.start().catch(reportProblem);
        };

        video.addEventListener('playing', markLive);
        void start();

        return () => {
            isStopped = true;
            video.removeEventListener('playing', markLive);
            stopVideoStream(video);
            scanner?.destroy();
            setCameraState('starting');
            setTorch(NO_TORCH);

            if (scannerRef.current === scanner) scannerRef.current = null;
        };
    }, [checkIn, isCameraOn, isPageVisible, startAttempt]);

    const toggleTorch = async () => {
        const scanner = scannerRef.current;

        if (!scanner) return;

        try {
            await scanner.toggleFlash();
        } catch {
            setTorch(NO_TORCH);
            setIsTorchUnavailable(true);
            return;
        }

        setTorch({ isAvailable: true, isOn: scanner.isFlashOn() });

        const stream = videoRef.current?.srcObject;

        if (stream instanceof MediaStream) {
            for (const track of stream.getVideoTracks()) void keepFocusContinuous(track);
        }
    };

    const retry = () => {
        hasAutoRetriedRef.current = false;
        setStartAttempt((attempt) => attempt + 1);
    };

    const turnCameraOn = () => {
        hasAutoRetriedRef.current = false;
        setIsCameraOn(true);
    };

    const problemCopy = problem && isCameraOn ? CAMERA_PROBLEMS[problem] : null;

    return (
        <div className="camera" data-camera-state={isCameraOn ? cameraState : 'off'}>
            <div className="camera-viewfinder">
                {isCameraOn ? (
                    <>
                        <video
                            key={`${startAttempt}:${isPageVisible}`}
                            ref={videoRef}
                            className="camera-video"
                            muted
                            playsInline
                        />

                        <CameraHud state={hudState} guestCount={guestCount} scanKey={scanKey} />
                    </>
                ) : (
                    <div className="camera-off" role="status">
                        <CameraOffIcon className="camera-off-icon" aria-hidden="true" />
                        <p className="camera-off-title">Camera is off</p>
                        <p className="camera-off-text">
                            Turn it on when the next guest reaches the gate.
                        </p>
                        <Button variant="secondary" onClick={turnCameraOn}>
                            <CameraIcon aria-hidden="true" />
                            Turn camera on
                        </Button>
                    </div>
                )}

                {isCameraOn && !problem && (
                    <p className="camera-hint">
                        <span className="camera-hint-text">{hint}</span>
                    </p>
                )}
            </div>

            {isCameraOn && !problemCopy && (
                <div className="camera-controls">
                    <Button
                        variant="secondary"
                        className="camera-controls-button"
                        onClick={() => setIsCameraOn(false)}
                    >
                        <CameraOffIcon aria-hidden="true" />
                        Turn camera off
                    </Button>

                    {cameraState === 'live' && torch.isAvailable && (
                        <Button
                            variant={torch.isOn ? 'default' : 'secondary'}
                            className="camera-controls-button"
                            onClick={() => void toggleTorch()}
                        >
                            {torch.isOn ? (
                                <FlashlightOffIcon aria-hidden="true" />
                            ) : (
                                <FlashlightIcon aria-hidden="true" />
                            )}
                            {torch.isOn ? 'Turn torch off' : 'Turn torch on'}
                        </Button>
                    )}

                    {isTorchUnavailable && (
                        <p className="camera-controls-notice" role="status">
                            <FlashlightOffIcon aria-hidden="true" />
                            The torch is not available on this camera.
                        </p>
                    )}
                </div>
            )}

            {problemCopy && (
                <div className="camera-error" data-camera-error={problem}>
                    <Notice
                        icon={problemCopy.icon}
                        title={problemCopy.title}
                        description={problemCopy.description}
                        density="compact"
                        footer={
                            <Button variant="outline" onClick={retry}>
                                Try again
                            </Button>
                        }
                    />
                </div>
            )}
        </div>
    );
}
