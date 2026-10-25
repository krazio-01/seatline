import type { Point3 } from '@/components/scenes/seatLayout';

export type ViewFraming = { target: Point3; distance: number };

type ViewRequest = {
    points: Point3[];
    yaw: number;
    elevation: number;
    verticalFov: number;
    aspect: number;
    margin: number;
};

type OrbitRange = { yaw: number; elevation: number };

type SpringState = { value: number; velocity: number };

type PointerRect = { left: number; top: number; width: number; height: number };

export type ScreenPoint = { x: number; y: number; depth: number };

export type OrbitProjection = {
    project: (point: Point3) => ScreenPoint;
    pixelsPerUnit: (depth: number) => number;
    cameraPosition: Point3;
    right: Point3;
    up: Point3;
};

type ViewBasis = {
    forward: Point3;
    right: Point3;
    up: Point3;
};

export const AUDITORIUM_CAMERA = {
    fov: 30,
    margin: 0.05,
    baseElevation: 0.72,
    highlightElevation: 0.08,
    highlightYaw: 0.12,
    tiltRange: { yaw: (6 * Math.PI) / 180, elevation: (3 * Math.PI) / 180 },
};

const CENTERING_PASSES = 4;
const SPRING_REST = 1e-4;

function viewBasis(yaw: number, elevation: number): ViewBasis {
    const forwardX = -Math.sin(yaw) * Math.cos(elevation);
    const forwardY = -Math.sin(elevation);
    const forwardZ = -Math.cos(yaw) * Math.cos(elevation);

    const rightLength = Math.hypot(forwardZ, forwardX) || 1;
    const rightX = -forwardZ / rightLength;
    const rightZ = forwardX / rightLength;

    return {
        forward: [forwardX, forwardY, forwardZ],
        right: [rightX, 0, rightZ],
        up: [-rightZ * forwardY, rightZ * forwardX - rightX * forwardZ, rightX * forwardY],
    };
}

function fitTangents(request: ViewRequest) {
    const tanVertical = Math.tan((request.verticalFov * Math.PI) / 360);

    return {
        vertical: tanVertical * (1 - request.margin),
        horizontal: tanVertical * request.aspect * (1 - request.margin),
    };
}

function requiredDistance(
    points: Point3[],
    target: Point3,
    basis: ViewBasis,
    tangents: { vertical: number; horizontal: number },
): number {
    const { forward, right, up } = basis;
    let distance = 0;

    for (const [x, y, z] of points) {
        const offsetX = x - target[0];
        const offsetY = y - target[1];
        const offsetZ = z - target[2];
        const across = offsetX * right[0] + offsetZ * right[2];
        const vertical = offsetX * up[0] + offsetY * up[1] + offsetZ * up[2];
        const along = offsetX * forward[0] + offsetY * forward[1] + offsetZ * forward[2];

        distance = Math.max(
            distance,
            Math.abs(across) / tangents.horizontal - along,
            Math.abs(vertical) / tangents.vertical - along,
        );
    }

    return distance;
}

export function viewDirection(yaw: number, elevation: number, out: Point3): Point3 {
    out[0] = Math.sin(yaw) * Math.cos(elevation);
    out[1] = Math.sin(elevation);
    out[2] = Math.cos(yaw) * Math.cos(elevation);

    return out;
}

export function frameView(request: ViewRequest, out: ViewFraming): ViewFraming {
    const { points } = request;
    const basis = viewBasis(request.yaw, request.elevation);
    const tangents = fitTangents(request);
    const { forward, right, up } = basis;
    const target: Point3 = [0, 0, 0];

    for (const [x, y, z] of points) {
        target[0] += x / points.length;
        target[1] += y / points.length;
        target[2] += z / points.length;
    }

    let distance = 0;

    for (let pass = 0; pass <= CENTERING_PASSES; pass += 1) {
        distance = requiredDistance(points, target, basis, tangents);

        if (pass === CENTERING_PASSES) break;

        let minAcross = Infinity;
        let maxAcross = -Infinity;
        let minVertical = Infinity;
        let maxVertical = -Infinity;

        for (const [x, y, z] of points) {
            const offsetX = x - target[0];
            const offsetY = y - target[1];
            const offsetZ = z - target[2];
            const depth =
                distance + offsetX * forward[0] + offsetY * forward[1] + offsetZ * forward[2];
            const across = (offsetX * right[0] + offsetZ * right[2]) / depth;
            const vertical = (offsetX * up[0] + offsetY * up[1] + offsetZ * up[2]) / depth;

            minAcross = Math.min(minAcross, across);
            maxAcross = Math.max(maxAcross, across);
            minVertical = Math.min(minVertical, vertical);
            maxVertical = Math.max(maxVertical, vertical);
        }

        const shiftAcross = ((minAcross + maxAcross) / 2) * distance;
        const shiftVertical = ((minVertical + maxVertical) / 2) * distance;

        target[0] += right[0] * shiftAcross + up[0] * shiftVertical;
        target[1] += up[1] * shiftVertical;
        target[2] += right[2] * shiftAcross + up[2] * shiftVertical;
    }

    out.target[0] = target[0];
    out.target[1] = target[1];
    out.target[2] = target[2];
    out.distance = distance;

    return out;
}

export function frameOrbit(request: ViewRequest, range: OrbitRange, out: ViewFraming): ViewFraming {
    frameView(request, out);

    const tangents = fitTangents(request);
    let distance = out.distance;

    for (const yawSide of [-1, 0, 1]) {
        for (const elevationSide of [-1, 0, 1]) {
            const basis = viewBasis(
                request.yaw + yawSide * range.yaw,
                request.elevation + elevationSide * range.elevation,
            );

            distance = Math.max(
                distance,
                requiredDistance(request.points, out.target, basis, tangents),
            );
        }
    }

    out.distance = distance;

    return out;
}

export function stepSpring(
    state: SpringState,
    target: number,
    angularFrequency: number,
    delta: number,
): boolean {
    const offset = state.value - target;
    const decay = Math.exp(-angularFrequency * delta);
    const carry = (state.velocity + angularFrequency * offset) * delta;

    state.value = target + (offset + carry) * decay;
    state.velocity = (state.velocity - angularFrequency * carry) * decay;

    return Math.abs(state.value - target) < SPRING_REST && Math.abs(state.velocity) < SPRING_REST;
}

export function normalizePointer(
    clientX: number,
    clientY: number,
    rect: PointerRect,
    out: { x: number; y: number },
): { x: number; y: number } {
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const y = ((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;

    out.x = Math.min(1, Math.max(-1, x));
    out.y = Math.min(1, Math.max(-1, y));

    return out;
}

export function auditoriumRestView(highlightYaw: number | null): {
    yaw: number;
    elevation: number;
} {
    return {
        yaw: highlightYaw ?? 0,
        elevation:
            AUDITORIUM_CAMERA.baseElevation +
            (highlightYaw === null ? 0 : AUDITORIUM_CAMERA.highlightElevation),
    };
}

export function createOrbitProjection(
    request: ViewRequest,
    range: OrbitRange,
    size: { width: number; height: number },
): OrbitProjection {
    const framing = frameOrbit(request, range, { target: [0, 0, 0], distance: 0 });
    const direction = viewDirection(request.yaw, request.elevation, [0, 0, 0]);
    const { forward, right, up } = viewBasis(request.yaw, request.elevation);
    const tanVertical = Math.tan((request.verticalFov * Math.PI) / 360);
    const focalPixels = size.height / (2 * tanVertical);
    const cameraPosition: Point3 = [
        framing.target[0] + direction[0] * framing.distance,
        framing.target[1] + direction[1] * framing.distance,
        framing.target[2] + direction[2] * framing.distance,
    ];

    return {
        cameraPosition,
        right,
        up,
        pixelsPerUnit: (depth) => focalPixels / depth,
        project: ([x, y, z]) => {
            const offsetX = x - cameraPosition[0];
            const offsetY = y - cameraPosition[1];
            const offsetZ = z - cameraPosition[2];
            const depth = offsetX * forward[0] + offsetY * forward[1] + offsetZ * forward[2];
            const across = offsetX * right[0] + offsetY * right[1] + offsetZ * right[2];
            const vertical = offsetX * up[0] + offsetY * up[1] + offsetZ * up[2];

            return {
                x: size.width / 2 + (across * focalPixels) / depth,
                y: size.height / 2 - (vertical * focalPixels) / depth,
                depth,
            };
        },
    };
}
