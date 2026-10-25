export type FlightView = { verticalFov: number; aspect: number };

export type FlightPlan = {
    startX: number;
    endX: number;
    startY: number;
    endY: number;
    arc: number;
    startDepth: number;
    endDepth: number;
    weave: number;
    weaveWaves: number;
    duration: number;
    pause: number;
};

export type FlightPoint = { x: number; y: number; depth: number };

type StripeAxis = { x: number; y: number; z: number };

export const SMOKE_STRIPES = [
    { color: '#FF9933', offset: 0.6 },
    { color: '#FFFFFF', offset: 0 },
    { color: '#138808', offset: -0.6 },
];

export const SMOKE = {
    life: 2.4,
    startRadius: 0.22,
    endRadius: 0.6,
    sizeJitter: 0.25,
    startSpread: 0.25,
    maxDrift: 0.35,
};

export const JET_RADIUS = 2.3;
const WIDE_BAND = { top: 0.9, bottom: -0.3 };
const PORTRAIT_BAND = { top: 0.9, bottom: 0.15 };

export const FLIGHT_ENVELOPE = Math.max(
    JET_RADIUS,
    Math.max(...SMOKE_STRIPES.map((stripe) => Math.abs(stripe.offset))) +
        SMOKE.endRadius * (1 + SMOKE.sizeJitter) +
        SMOKE.maxDrift,
);

const PERSPECTIVE_ALLOWANCE = 1.15;
const EDGE_CLEARANCE = 0.03;
const WIDE_ASPECT = 1.1;
const NEAREST_DEPTH = 28;

function lerp(from: number, to: number, amount: number): number {
    return from + (to - from) * amount;
}

function envelopeOnScreen(depth: number, tanVertical: number): number {
    return (FLIGHT_ENVELOPE * PERSPECTIVE_ALLOWANCE) / (depth * tanVertical);
}

export function flightBand(aspect: number): { top: number; bottom: number } {
    return aspect < 1 ? PORTRAIT_BAND : WIDE_BAND;
}

export function planFlight(random: () => number, view: FlightView): FlightPlan {
    const direction = random() < 0.5 ? 1 : -1;
    const tanVertical = Math.tan((view.verticalFov * Math.PI) / 360);
    const tanHorizontal = tanVertical * view.aspect;
    const depthScale = Math.max(1, WIDE_ASPECT / view.aspect);

    const nearDepth = (NEAREST_DEPTH + random() * 6) * depthScale;
    const farDepth = nearDepth + (4 + random() * 12) * depthScale;
    const isReceding = random() < 0.6;
    const weave = (random() - 0.5) * 8 * depthScale;
    const nearestDepth = nearDepth - Math.abs(weave);
    const clampedNearest = Math.max(nearestDepth, NEAREST_DEPTH * 0.75 * depthScale);
    const weaveAmount = Math.sign(weave) * (nearDepth - clampedNearest);

    const band = flightBand(view.aspect);
    const envelope = envelopeOnScreen(clampedNearest, tanVertical);
    const lowest = band.bottom + envelope;
    const highest = Math.max(lowest, band.top - envelope);

    const startY = lerp(lowest, highest, random());
    const slopeLimit = 0.55 * Math.min(1, view.aspect);
    const freeEndY = lerp(lowest, highest, random());
    const endY = Math.min(startY + slopeLimit, Math.max(startY - slopeLimit, freeEndY));
    const isArcUp = random() < 0.65;
    const arcRoom = isArcUp ? highest - Math.max(startY, endY) : Math.min(startY, endY) - lowest;
    const arc = (isArcUp ? 1 : -1) * arcRoom * (0.4 + random() * 0.6) * Math.min(1, view.aspect);

    const startDepth = isReceding ? nearDepth : farDepth;
    const endDepth = isReceding ? farDepth : nearDepth;
    const edgeOffset = (depth: number) =>
        1 + (JET_RADIUS * PERSPECTIVE_ALLOWANCE) / (depth * tanHorizontal) + EDGE_CLEARANCE;

    return {
        startX: -direction * edgeOffset(startDepth),
        endX: direction * edgeOffset(endDepth),
        startY,
        endY,
        arc,
        startDepth,
        endDepth,
        weave: weaveAmount,
        weaveWaves: random() < 0.5 ? 1 : 2,
        duration: 3.4 + random() * 1.4,
        pause: 1.5 + random() * 2.5,
    };
}

export function flightPointAt(plan: FlightPlan, progress: number, out: FlightPoint): FlightPoint {
    const eased = progress * progress * (3 - 2 * progress);
    const weavePhase = Math.sin(Math.PI * progress * plan.weaveWaves);

    out.x = lerp(plan.startX, plan.endX, progress);
    out.y = lerp(plan.startY, plan.endY, eased) + plan.arc * Math.sin(Math.PI * progress);
    out.depth = lerp(plan.startDepth, plan.endDepth, progress) + plan.weave * weavePhase;

    return out;
}

export function orientStripeAxis<Axis extends StripeAxis>(axis: Axis): Axis {
    if (axis.y >= 0) return axis;

    axis.x = -axis.x;
    axis.y = -axis.y;
    axis.z = -axis.z;

    return axis;
}
