import { useSyncExternalStore } from 'react';

export type WebglSupport = { isSupported: boolean; isSoftware: boolean };

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const CONSTRAINED_DEVICE_QUERY = '(pointer: coarse), (max-width: 700px)';
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software/i;
const SERVER_WEBGL_SUPPORT: WebglSupport = { isSupported: false, isSoftware: false };
const FLYPAST_WAIT_MS = 6000;
let cachedWebglSupport: WebglSupport | null = null;
let flypastSignal: { promise: Promise<void>; resolve: () => void } | null = null;

function subscribeToReducedMotion(onChange: () => void) {
    const query = matchMedia(REDUCED_MOTION_QUERY);

    query.addEventListener('change', onChange);

    return () => query.removeEventListener('change', onChange);
}

export function readWebglSupport(): WebglSupport {
    if (cachedWebglSupport !== null) return cachedWebglSupport;

    const probe = document.createElement('canvas');
    const context = probe.getContext('webgl2') ?? probe.getContext('webgl');
    const debugInfo = context?.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo
        ? String(context?.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
        : '';

    cachedWebglSupport = {
        isSupported: context !== null,
        isSoftware: SOFTWARE_RENDERER.test(renderer),
    };

    context?.getExtension('WEBGL_lose_context')?.loseContext();

    return cachedWebglSupport;
}

export function readServerWebglSupport(): WebglSupport {
    return SERVER_WEBGL_SUPPORT;
}

export function subscribeToNothing() {
    return () => undefined;
}

export function isConstrainedDevice(): boolean {
    return matchMedia(CONSTRAINED_DEVICE_QUERY).matches;
}

export function canRunScenes({ allowReducedMotion = false } = {}): boolean {
    if (!allowReducedMotion && matchMedia(REDUCED_MOTION_QUERY).matches) return false;

    return readWebglSupport().isSupported;
}

function readFlypastSignal(): { promise: Promise<void>; resolve: () => void } {
    if (flypastSignal) return flypastSignal;

    let resolve = () => undefined as void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });

    flypastSignal = { promise, resolve };

    return flypastSignal;
}

export function resetFlypastReady(): void {
    flypastSignal = null;
}

export function markFlypastReady(): void {
    readFlypastSignal().resolve();
}

export function flypastReady(): Promise<void> {
    return Promise.race([
        readFlypastSignal().promise,
        new Promise<void>((resolve) => setTimeout(resolve, FLYPAST_WAIT_MS)),
    ]);
}

export function usePrefersReducedMotion(): boolean {
    return useSyncExternalStore(
        subscribeToReducedMotion,
        () => matchMedia(REDUCED_MOTION_QUERY).matches,
        () => false,
    );
}
