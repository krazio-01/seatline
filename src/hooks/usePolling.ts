'use client';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';

type Load<T> = (signal: AbortSignal) => Promise<T>;

type LoadOutcome<T> = { ok: true; data: T } | { ok: false; error: unknown };

export type Visibility = {
    isVisible: () => boolean;
    subscribe: (onChange: () => void) => () => void;
};

export type PollerOptions<T> = {
    load: Load<T>;
    intervalMs: number;
    timeoutMs?: number;
    onData: (data: T) => void;
    onError?: (error: unknown) => void;
    onBusyChange?: (isBusy: boolean) => void;
    visibility?: Visibility;
};

export type Poller<T> = {
    start: () => void;
    stop: () => void;
    refresh: () => void;
    setLoad: (load: Load<T>) => void;
};

type PollingOptions<T> = {
    intervalMs: number;
    initialData: T;
    onData?: (data: T) => void;
    onError?: (error: unknown) => void;
    immediate?: boolean;
    enabled?: boolean;
};

const TIMEOUT_INTERVALS = 2;

const documentVisibility: Visibility = {
    isVisible: () => document.visibilityState === 'visible',
    subscribe: (onChange) => {
        document.addEventListener('visibilitychange', onChange);

        return () => document.removeEventListener('visibilitychange', onChange);
    },
};

export function createPoller<T>({
    load: initialLoad,
    intervalMs,
    timeoutMs = intervalMs * TIMEOUT_INTERVALS,
    onData,
    onError,
    onBusyChange,
    visibility = documentVisibility,
}: PollerOptions<T>): Poller<T> {
    let load = initialLoad;
    let isActive = false;
    let isBusy = false;
    let isQueued = false;
    let generation = 0;
    let requestController: AbortController | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => void) | undefined;

    const attempt = async (currentLoad: Load<T>): Promise<LoadOutcome<T>> => {
        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(new DOMException('The request timed out', 'TimeoutError')),
            timeoutMs,
        );

        const aborted = new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
                once: true,
            });
        });

        requestController = controller;

        try {
            return {
                ok: true,
                data: await Promise.race([currentLoad(controller.signal), aborted]),
            };
        } catch (error) {
            return { ok: false, error };
        } finally {
            clearTimeout(timeout);
        }
    };

    const poll = async (queueWhenBusy: boolean) => {
        if (!isActive) return;

        if (isBusy) {
            isQueued ||= queueWhenBusy;

            return;
        }

        const runGeneration = generation;

        isBusy = true;
        onBusyChange?.(true);

        try {
            do {
                isQueued = false;

                const currentLoad = load;
                const outcome = await attempt(currentLoad);

                if (runGeneration !== generation) return;

                if (currentLoad !== load) continue;

                if (outcome.ok) onData(outcome.data);
                else onError?.(outcome.error);
            } while (isQueued);
        } finally {
            if (runGeneration === generation) {
                isBusy = false;
                requestController = undefined;
                onBusyChange?.(false);
            }
        }
    };

    const startTimer = () => {
        timer ??= setInterval(() => void poll(false), intervalMs);
    };

    const stopTimer = () => {
        clearInterval(timer);
        timer = undefined;
    };

    const handleVisibilityChange = () => {
        if (!visibility.isVisible()) return stopTimer();

        void poll(true);
        startTimer();
    };

    return {
        start: () => {
            if (isActive) return;

            isActive = true;
            unsubscribe = visibility.subscribe(handleVisibilityChange);

            if (visibility.isVisible()) startTimer();
        },
        stop: () => {
            if (isBusy) onBusyChange?.(false);

            isActive = false;
            isBusy = false;
            isQueued = false;
            generation += 1;
            requestController?.abort();
            requestController = undefined;
            stopTimer();
            unsubscribe?.();
            unsubscribe = undefined;
        },
        refresh: () => void poll(true),
        setLoad: (nextLoad) => {
            if (nextLoad === load) return;

            load = nextLoad;
            requestController?.abort();
            void poll(true);
        },
    };
}

export function usePolling<T>(
    load: Load<T>,
    {
        intervalMs,
        initialData,
        onData,
        onError,
        immediate = false,
        enabled = true,
    }: PollingOptions<T>,
): { data: T; error: unknown; refreshing: boolean; refresh: () => void } {
    const [state, setState] = useState<{ data: T; error: unknown }>({
        data: initialData,
        error: undefined,
    });
    const [refreshing, setRefreshing] = useState(false);
    const loadRef = useRef(load);
    const pollerRef = useRef<Poller<T>>(undefined);

    const handleData = useEffectEvent((data: T) => {
        setState({ data, error: undefined });
        onData?.(data);
    });

    const handleError = useEffectEvent((error: unknown) => {
        setState((current) => ({ ...current, error }));
        onError?.(error);
    });

    useEffect(() => {
        loadRef.current = load;
        pollerRef.current?.setLoad(load);
    }, [load]);

    useEffect(() => {
        if (!enabled) return;

        const poller = createPoller({
            load: loadRef.current,
            intervalMs,
            onData: (data) => handleData(data),
            onError: (error) => handleError(error),
            onBusyChange: setRefreshing,
        });

        pollerRef.current = poller;
        poller.start();

        if (immediate) poller.refresh();

        return () => {
            poller.stop();
            pollerRef.current = undefined;
        };
    }, [enabled, immediate, intervalMs]);

    const refresh = useCallback(() => pollerRef.current?.refresh(), []);

    return { data: state.data, error: state.error, refreshing, refresh };
}
