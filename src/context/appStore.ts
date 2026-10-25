import type { DashboardSnapshot } from '@/types/admin';
import type { CheckInResult, GateProgress, ZoneBooking } from '@/types/booking';
import type { BookingState } from '@/utils/booking-form';

export type ConnectionState = { failuresBySource: Record<string, number>; isSignedOut: boolean };

export type SignInPhase = 'idle' | 'focused' | 'submitting' | 'failed' | 'succeeded';

export type SignInPulseTone = 'soft' | 'error' | 'success';

export type SignInState = { phase: SignInPhase; pulse: number; pulseTone: SignInPulseTone };

export type SignInEvent = 'focus' | 'blur' | 'keystroke' | 'submit' | 'fail' | 'succeed';

export type CheckInCounts = Record<CheckInResult['outcome'], number>;

export type ScannerState = {
    result: CheckInResult | null;
    scanKey: number;
    counts: CheckInCounts;
    error: string | null;
    isChecking: boolean;
};

export type AppSlices = {
    booking: BookingState;
    dashboard: DashboardSnapshot;
    connection: ConnectionState;
    signIn: SignInState;
    scanner: ScannerState;
    gateProgress: GateProgress;
};

export type AppSliceKey = keyof AppSlices;

export type AppState = Partial<AppSlices>;

export type SlicePatch<Key extends AppSliceKey> =
    Partial<AppSlices[Key]> | ((current: AppSlices[Key]) => Partial<AppSlices[Key]>);

export type AppStore = {
    getState: () => AppState;
    subscribe: (listener: () => void) => () => void;
    updateSlice: <Key extends AppSliceKey>(key: Key, patch: SlicePatch<Key>) => void;
    replaceSlice: <Key extends AppSliceKey>(key: Key, value: AppSlices[Key]) => void;
    registerRefresher: (key: AppSliceKey, refresh: () => void) => () => void;
    refreshSlice: (key: AppSliceKey) => void;
};

export const INITIAL_CONNECTION: ConnectionState = { failuresBySource: {}, isSignedOut: false };
export const INITIAL_SIGN_IN: SignInState = { phase: 'idle', pulse: 0, pulseTone: 'soft' };
export const INITIAL_SCANNER: ScannerState = {
    result: null,
    scanKey: 0,
    counts: { checked_in: 0, already_checked_in: 0, invalid: 0 },
    error: null,
    isChecking: false,
};

const LOCKED_SIGN_IN_PHASES = new Set<SignInPhase>(['submitting', 'succeeded']);

export function consecutiveFailures(connection: ConnectionState): number {
    return Math.max(0, ...Object.values(connection.failuresBySource));
}

export function advanceSignIn(state: SignInState, event: SignInEvent): SignInState {
    const isLocked = LOCKED_SIGN_IN_PHASES.has(state.phase);
    const nextPulse = state.pulse + 1;

    switch (event) {
        case 'focus':
            return state.phase === 'idle' ? { ...state, phase: 'focused' } : state;
        case 'blur':
            return isLocked ? state : { ...state, phase: 'idle' };
        case 'keystroke':
            return {
                phase: state.phase === 'failed' ? 'focused' : state.phase,
                pulse: nextPulse,
                pulseTone: 'soft',
            };
        case 'submit':
            return { ...state, phase: 'submitting' };
        case 'fail':
            return { phase: 'failed', pulse: nextPulse, pulseTone: 'error' };
        case 'succeed':
            return { phase: 'succeeded', pulse: nextPulse, pulseTone: 'success' };
    }
}

export function recordCheckIn(state: ScannerState, result: CheckInResult): ScannerState {
    return {
        result,
        scanKey: state.scanKey + 1,
        counts: { ...state.counts, [result.outcome]: state.counts[result.outcome] + 1 },
        error: null,
        isChecking: false,
    };
}

export function recordCheckInFailure(state: ScannerState, error: string): ScannerState {
    const isRepeat = state.result === null && state.error === error;

    return {
        ...state,
        result: null,
        scanKey: isRepeat ? state.scanKey : state.scanKey + 1,
        error,
        isChecking: false,
    };
}

export function admitBooking(booking: BookingState, confirmation: ZoneBooking): BookingState {
    const ownBooking = { zone: confirmation.zone, seatCount: confirmation.seatCount };
    const zones = booking.zones.map((zone) =>
        zone.name === ownBooking.zone
            ? { ...zone, booked: Math.min(zone.capacity, zone.booked + ownBooking.seatCount) }
            : zone,
    );

    return { zones, ownBooking };
}

export function admitGuests(progress: GateProgress, guestCount: number): GateProgress {
    return {
        ...progress,
        guestsIn: Math.min(progress.guestsIn + guestCount, progress.guestsExpected),
    };
}

export function createAppStore(initialState: AppState): AppStore {
    let state = initialState;
    const listeners = new Set<() => void>();
    const refreshers = new Map<AppSliceKey, () => void>();

    const setState = (nextState: AppState) => {
        state = nextState;
        listeners.forEach((listener) => listener());
    };

    return {
        getState: () => state,
        subscribe: (listener) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        updateSlice: (key, patch) => {
            const current = state[key];

            if (!current) throw new Error(`App slice "${key}" is not provided`);

            const changes = typeof patch === 'function' ? patch(current) : patch;
            if (changes === current) return;

            setState({ ...state, [key]: { ...current, ...changes } });
        },
        replaceSlice: (key, value) => setState({ ...state, [key]: value }),
        registerRefresher: (key, refresh) => {
            refreshers.set(key, refresh);

            return () => {
                if (refreshers.get(key) === refresh) refreshers.delete(key);
            };
        },
        refreshSlice: (key) => refreshers.get(key)?.(),
    };
}
