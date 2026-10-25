'use client';
import { useEffect, useState, type RefObject } from 'react';
import dynamic from 'next/dynamic';
import { canRunScenes } from '@/components/scenes/sceneSupport';

const NEAR_VIEWPORT_MARGIN = '200px';
const IDLE_TIMEOUT_MS = 2000;
const IDLE_FALLBACK_DELAY_MS = 200;

const FlypastScene = dynamic(
    () => import('@/components/scenes/Flypast/Flypast').then((module) => module.Flypast),
    { ssr: false },
);

export const LazyAuditorium = dynamic(
    () => import('@/components/scenes/Auditorium/Auditorium').then((module) => module.Auditorium),
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

export function useSceneGate(nearViewportRef?: RefObject<HTMLElement | null>): boolean {
    const [shouldLoad, setShouldLoad] = useState(false);

    useEffect(() => {
        if (!canRunScenes()) return;

        const target = nearViewportRef?.current;
        const load = () => setShouldLoad(true);

        if (!target) return whenIdle(load);

        let cancelIdle: (() => void) | undefined;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting) return;

                observer.disconnect();
                cancelIdle = whenIdle(load);
            },
            { rootMargin: NEAR_VIEWPORT_MARGIN },
        );

        observer.observe(target);

        return () => {
            observer.disconnect();
            cancelIdle?.();
        };
    }, [nearViewportRef]);

    return shouldLoad;
}

export function LazyFlypast() {
    const shouldLoad = useSceneGate();

    return shouldLoad ? <FlypastScene /> : null;
}
