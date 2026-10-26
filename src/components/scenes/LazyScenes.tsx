'use client';
import { useEffect, useState, type RefObject } from 'react';
import dynamic from 'next/dynamic';
import type { LiveSeatingSceneProps } from '@/components/scenes/LiveSeating/LiveSeatingScene';
import type { ParadeWorldProps } from '@/components/scenes/ParadeWorld/ParadeWorld';
import { canRunScenes } from '@/components/scenes/sceneSupport';

const NEAR_VIEWPORT_MARGIN = '200px';
const IDLE_TIMEOUT_MS = 2000;
const IDLE_FALLBACK_DELAY_MS = 200;
const FLYPAST_START_DELAY_MS = 2000;

export const LazyAuditorium = dynamic(
    () => import('@/components/scenes/Auditorium/Auditorium').then((module) => module.Auditorium),
    { ssr: false },
);

const FlypastScene = dynamic(
    () => import('@/components/scenes/Flypast/Flypast').then((module) => module.Flypast),
    { ssr: false },
);

export const LazyLiveSeatingScene = dynamic<LiveSeatingSceneProps>(
    () =>
        import('@/components/scenes/LiveSeating/LiveSeatingScene').then(
            (module) => module.LiveSeatingScene,
        ),
    { ssr: false },
);

const ParadeWorldScene = dynamic(
    () =>
        import('@/components/scenes/ParadeWorld/ParadeWorld').then((module) => module.ParadeWorld),
    { ssr: false },
);

export const LazyDotTerrainScene = dynamic(
    () =>
        import('@/components/scenes/DotTerrain/DotTerrainScene').then(
            (module) => module.DotTerrainScene,
        ),
    { ssr: false },
);

function whenIdle(callback: () => void): () => void {
    if ('requestIdleCallback' in window) {
        const handle = requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });

        return () => cancelIdleCallback(handle);
    }

    const handle = setTimeout(callback, IDLE_FALLBACK_DELAY_MS);

    return () => clearTimeout(handle);
}

function whenNearViewport(target: HTMLElement, start: () => () => void): () => void {
    let cancelStart: (() => void) | undefined;
    const observer = new IntersectionObserver(
        ([entry]) => {
            if (!entry.isIntersecting) return;

            observer.disconnect();
            cancelStart = start();
        },
        { rootMargin: NEAR_VIEWPORT_MARGIN },
    );

    observer.observe(target);

    return () => {
        observer.disconnect();
        cancelStart?.();
    };
}

function afterDelay(delayMs: number, start: () => () => void): () => void {
    let cancelStart: (() => void) | undefined;
    const handle = setTimeout(() => {
        cancelStart = start();
    }, delayMs);

    return () => {
        clearTimeout(handle);
        cancelStart?.();
    };
}

export function useSceneGate(
    nearViewportRef?: RefObject<HTMLElement | null>,
    {
        allowReducedMotion = false,
        startDelayMs = 0,
        waitFor,
    }: { allowReducedMotion?: boolean; startDelayMs?: number; waitFor?: () => Promise<void> } = {},
): boolean {
    const [shouldLoad, setShouldLoad] = useState(false);

    useEffect(() => {
        if (!canRunScenes({ allowReducedMotion })) return;

        const target = nearViewportRef?.current;
        const load = () => setShouldLoad(true);
        const openWhenIdle = () => whenIdle(load);
        const openWhenNear = () =>
            target ? whenNearViewport(target, openWhenIdle) : openWhenIdle();
        const open = () =>
            startDelayMs > 0 ? afterDelay(startDelayMs, openWhenNear) : openWhenNear();

        if (!waitFor) return open();

        let isCancelled = false;
        let cancelOpen: (() => void) | undefined;

        void waitFor().then(() => {
            if (!isCancelled) cancelOpen = open();
        });

        return () => {
            isCancelled = true;
            cancelOpen?.();
        };
    }, [nearViewportRef, allowReducedMotion, startDelayMs, waitFor]);

    return shouldLoad;
}

export function LazyFlypast() {
    const shouldLoad = useSceneGate(undefined, { startDelayMs: FLYPAST_START_DELAY_MS });

    return shouldLoad ? <FlypastScene /> : null;
}

export function LazyParadeWorld(props: ParadeWorldProps) {
    const shouldLoad = useSceneGate(undefined, { allowReducedMotion: true });

    return shouldLoad ? <ParadeWorldScene {...props} /> : null;
}
