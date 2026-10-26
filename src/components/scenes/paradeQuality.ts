export type Tier = 'high' | 'balanced' | 'lite';

export type Quality = {
    ao: boolean;
    post: boolean;
    movingShadows: boolean;
    shadowSize: number;
    pixelRatio: number;
    minPixelRatio: number;
    samples: number;
    trees: number;
    isCalm: boolean;
};

export type TierInput = { gpu: string; memory: number; cores: number; isConstrained: boolean };

export type GovernorState = {
    quality: Quality;
    pixelRatio: number;
    frameCost: number;
    cpuCost: number;
    renderedFrames: number;
    lastAdjust: number;
    refreshInterval: number;
    pixelRatioCeiling: number;
};

export const TIERS: Record<Tier, Omit<Quality, 'isCalm'>> = {
    high: {
        ao: true,
        post: true,
        movingShadows: true,
        shadowSize: 2048,
        pixelRatio: 1.25,
        minPixelRatio: 0.85,
        samples: 4,
        trees: 100,
    },
    balanced: {
        ao: false,
        post: true,
        movingShadows: true,
        shadowSize: 2048,
        pixelRatio: 1,
        minPixelRatio: 0.75,
        samples: 2,
        trees: 80,
    },
    lite: {
        ao: false,
        post: false,
        movingShadows: false,
        shadowSize: 1024,
        pixelRatio: 1,
        minPixelRatio: 0.6,
        samples: 0,
        trees: 50,
    },
};

const CONSTRAINED_LITE_PIXEL_RATIO = 1.5;

const LOW_MEMORY_GB = 4;

const LOW_CORES = 4;

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software/i;

const INTEGRATED_GPU = /intel|mali|adreno|powervr|videocore|apple gpu/i;

const WARM_UP_FRAMES = 90;

const STEP_GAP_SECONDS = 1.5;

const STEP_UP_GAP_SECONDS = 5;

const SLOW_FRAME_MS = 21;

const CALM_FRAME_MS = 30;

const SLOW_SHARE_OF_REFRESH = 1.3;

const CALM_SHARE_OF_REFRESH = 1.8;

const FAST_SHARE_OF_REFRESH = 1.02;

const GPU_BOUND_SHARE = 0.55;

const PIXEL_RATIO_STEP = 0.1;

const PIXEL_RATIO_EPSILON = 0.01;

const IGNORED_GAP_MS = 250;

const FRAME_SMOOTHING = 0.05;

const REFRESH_FORGETTING = 1.002;

function nextStep(
    state: GovernorState,
    now: number,
    maxPixelRatio: number,
): Partial<Quality> | number | null {
    const { quality, pixelRatio, frameCost, cpuCost, refreshInterval } = state;
    const isSlow = frameCost > Math.max(SLOW_FRAME_MS, refreshInterval * SLOW_SHARE_OF_REFRESH);
    const isVerySlow = frameCost > Math.max(CALM_FRAME_MS, refreshInterval * CALM_SHARE_OF_REFRESH);
    const isGpuBound = cpuCost < frameCost * GPU_BOUND_SHARE;

    if (isSlow && quality.ao) return { ao: false };
    if (isSlow && isGpuBound && pixelRatio > quality.minPixelRatio + PIXEL_RATIO_EPSILON) {
        return Math.max(quality.minPixelRatio, pixelRatio - PIXEL_RATIO_STEP);
    }
    if (isSlow && quality.post) return { post: false };
    if (isSlow && quality.movingShadows) return { movingShadows: false };
    if (isVerySlow && !quality.isCalm) return { isCalm: true };

    const ceiling = Math.min(maxPixelRatio, state.pixelRatioCeiling);
    const isFast = frameCost < refreshInterval * FAST_SHARE_OF_REFRESH;
    const canStepUp =
        now - state.lastAdjust > STEP_UP_GAP_SECONDS &&
        pixelRatio + PIXEL_RATIO_STEP <= ceiling + PIXEL_RATIO_EPSILON;

    return isFast && canStepUp ? Math.min(ceiling, pixelRatio + PIXEL_RATIO_STEP) : null;
}

export function detectTier({ gpu, memory, cores, isConstrained }: TierInput): Tier {
    if (isConstrained || memory <= LOW_MEMORY_GB || cores <= LOW_CORES || SOFTWARE_GPU.test(gpu)) {
        return 'lite';
    }

    return INTEGRATED_GPU.test(gpu) ? 'balanced' : 'high';
}

export function qualityFor(tier: Tier, isConstrained: boolean): Quality {
    const pixelRatio =
        tier === 'lite' && isConstrained ? CONSTRAINED_LITE_PIXEL_RATIO : TIERS[tier].pixelRatio;

    return { ...TIERS[tier], pixelRatio, isCalm: false };
}

export function recordFrame(state: GovernorState, frameMs: number, cpuMs: number): void {
    if (frameMs > IGNORED_GAP_MS) return;

    const isFirstFrame = state.renderedFrames === 0;

    state.renderedFrames += 1;
    state.frameCost = isFirstFrame
        ? frameMs
        : state.frameCost + (frameMs - state.frameCost) * FRAME_SMOOTHING;
    state.cpuCost = state.cpuCost + (cpuMs - state.cpuCost) * FRAME_SMOOTHING;
    state.refreshInterval = Math.min(state.refreshInterval * REFRESH_FORGETTING, frameMs);
}

export function stepQuality(
    state: GovernorState,
    now: number,
    maxPixelRatio: number,
): Quality | null {
    if (state.renderedFrames < WARM_UP_FRAMES || now - state.lastAdjust < STEP_GAP_SECONDS) {
        return null;
    }

    const step = nextStep(state, now, maxPixelRatio);
    if (step === null) return null;

    if (typeof step === 'number') {
        if (step < state.pixelRatio) state.pixelRatioCeiling = step;
        state.pixelRatio = step;
    }

    state.quality = typeof step === 'number' ? { ...state.quality } : { ...state.quality, ...step };
    state.lastAdjust = now;

    return state.quality;
}
