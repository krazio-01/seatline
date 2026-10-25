'use client';
import { useCallback, useEffect, useId } from 'react';
import { useAppContext, useAppRuntime } from '@/context/appContext';
import { INITIAL_CONNECTION, type AppSliceKey, type AppSlices } from '@/context/appStore';
import { usePolling } from '@/hooks/usePolling';
import { ApiError, api } from '@/services/client/api';
import type { GateEvent } from '@/types/admin';

type SliceLoaders = Partial<{
    [Key in AppSliceKey]: (signal: AbortSignal) => Promise<AppSlices[Key]>;
}>;

type LivePollingOptions<T> = {
    intervalMs: number;
    initialData: T;
    onData?: (data: T) => void;
    immediate?: boolean;
};

const GATE_EVENT_HISTORY_LIMIT = 50;

const sliceLoaders: SliceLoaders = {
    dashboard: api.dashboard.get,
    gateProgress: api.checkIns.progress,
};

function LiveSlice<Key extends AppSliceKey>({
    sliceKey,
    intervalMs,
}: {
    sliceKey: Key;
    intervalMs: number;
}) {
    const { store } = useAppRuntime();
    const load = sliceLoaders[sliceKey] as
        ((signal: AbortSignal) => Promise<AppSlices[Key]>) | undefined;
    const initialData = store.getState()[sliceKey];

    if (!load) throw new Error(`App slice "${sliceKey}" has no loader`);

    if (!initialData) throw new Error(`App slice "${sliceKey}" is not provided`);

    const replaceChangedParts = useCallback(
        (value: AppSlices[Key]) => {
            const current = store.getState()[sliceKey];
            const merged = keepUnchangedParts<AppSlices[Key]>(current, value);

            if (merged !== current) store.replaceSlice(sliceKey, merged);
        },
        [store, sliceKey],
    );

    const { refresh } = useLivePolling(load, {
        intervalMs,
        initialData,
        onData: replaceChangedParts,
    });

    useEffect(() => store.registerRefresher(sliceKey, refresh), [refresh, sliceKey, store]);

    return null;
}

export function keepUnchangedParts<T extends object>(previous: T | undefined, next: T): T {
    if (!previous) return next;

    let hasChanges = false;
    const merged = { ...next };

    for (const key of Object.keys(next) as (keyof T)[]) {
        if (JSON.stringify(previous[key]) === JSON.stringify(next[key]))
            merged[key] = previous[key];
        else hasChanges = true;
    }

    const hasSameKeys = Object.keys(previous).length === Object.keys(next).length;

    return hasChanges || !hasSameKeys ? merged : previous;
}

export function mergeGateEvents(
    previous: GateEvent[],
    next: GateEvent[],
    limit = GATE_EVENT_HISTORY_LIMIT,
): { events: GateEvent[]; added: string[] } {
    const seenIds = new Set(previous.map((event) => event.id));
    const unseen = next.filter((event) => !seenIds.has(event.id));

    if (unseen.length === 0) return { events: previous, added: [] };

    return {
        events: [...unseen, ...previous].slice(0, limit),
        added: unseen.map((event) => event.id),
    };
}

export function useLivePolling<T>(
    load: (signal: AbortSignal) => Promise<T>,
    { onData, ...options }: LivePollingOptions<T>,
) {
    const { store, signInPath } = useAppRuntime();
    const { isSignedOut } = useAppContext('connection');
    const sourceId = useId();

    const setFailures = useCallback(
        (failures: number) => {
            const connection = store.getState().connection ?? INITIAL_CONNECTION;
            const { [sourceId]: previousFailures = 0, ...otherSources } =
                connection.failuresBySource;

            if (previousFailures === failures) return;

            store.replaceSlice('connection', {
                ...connection,
                failuresBySource:
                    failures > 0 ? { ...otherSources, [sourceId]: failures } : otherSources,
            });
        },
        [sourceId, store],
    );

    useEffect(() => () => setFailures(0), [setFailures]);

    const handleData = (data: T) => {
        setFailures(0);
        onData?.(data);
    };

    const handleError = (error: unknown) => {
        const connection = store.getState().connection ?? INITIAL_CONNECTION;

        if (connection.isSignedOut) return;

        if (error instanceof ApiError && error.status === 401) {
            store.replaceSlice('connection', { ...connection, isSignedOut: true });

            if (signInPath) window.location.replace(signInPath);

            return;
        }

        setFailures((connection.failuresBySource[sourceId] ?? 0) + 1);
    };

    return usePolling(load, {
        ...options,
        onData: handleData,
        onError: handleError,
        enabled: !isSignedOut,
    });
}

export function LiveSlices({ slices }: { slices: Partial<Record<AppSliceKey, number>> }) {
    const entries = Object.entries(slices) as [AppSliceKey, number][];

    return entries.map(([sliceKey, intervalMs]) => (
        <LiveSlice key={sliceKey} sliceKey={sliceKey} intervalMs={intervalMs} />
    ));
}
