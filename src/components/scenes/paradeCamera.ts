import { PerspectiveCamera, Vector3 } from 'three';
import { ENCLOSURE_X } from '@/components/scenes/paradeLayout';
import type { Point3 } from '@/components/scenes/seatLayout';
import type { ZoneName } from '@/types/booking';

export type ShotName =
    | 'hero'
    | 'facts'
    | 'programme'
    | 'paradeStart'
    | 'paradeMid'
    | 'paradeEnd'
    | 'seating'
    | 'guide'
    | 'cta';

export type Shot = {
    position: Point3;
    target: Point3;
    fov: number;
    dark: number;
    bloom: number;
    tilt: number;
    fogNear: number;
    fogFar: number;
};

export type ShotAnchor = { name: ShotName; at: number };

export type SeatingFocus = 'overview' | ZoneName;

export type SeatingShot = { position: Point3; target: Point3; fov: number };

export type ShotAlign = 'top' | 'center' | 'bottom';

export type ReadoutClock = { startMinutes: number; endMinutes: number };

export const SHOTS: Record<ShotName, Shot> = {
    hero: {
        position: [0, 198, 98],
        target: [6, 222, -60],
        fov: 42,
        dark: 1,
        bloom: 0.62,
        tilt: 0,
        fogNear: 300,
        fogFar: 1500,
    },
    facts: {
        position: [-60, 190, 110],
        target: [60, 214, -320],
        fov: 42,
        dark: 0.95,
        bloom: 0.55,
        tilt: 0,
        fogNear: 300,
        fogFar: 1600,
    },
    programme: {
        position: [-96, 64, 70],
        target: [-10, 0, -44],
        fov: 32,
        dark: 0.3,
        bloom: 0.2,
        tilt: 2,
        fogNear: 260,
        fogFar: 1100,
    },
    paradeStart: {
        position: [-30, 29, 2],
        target: [3, 0, -56],
        fov: 32,
        dark: 0,
        bloom: 0,
        tilt: 3.2,
        fogNear: 90,
        fogFar: 560,
    },
    paradeMid: {
        position: [-46, 3.4, -30],
        target: [4, 1.5, -52],
        fov: 21,
        dark: 0,
        bloom: 0,
        tilt: 1.4,
        fogNear: 90,
        fogFar: 560,
    },
    paradeEnd: {
        position: [-24, 4.2, -28],
        target: [-6, 2.2, -64],
        fov: 30,
        dark: 0,
        bloom: 0,
        tilt: 1.2,
        fogNear: 90,
        fogFar: 560,
    },
    seating: {
        position: [-42, 15, -20],
        target: [-8, 1.5, -64],
        fov: 34,
        dark: 0,
        bloom: 0,
        tilt: 1.8,
        fogNear: 90,
        fogFar: 560,
    },
    guide: {
        position: [40, 60, 60],
        target: [0, 60, -100],
        fov: 42,
        dark: 0.6,
        bloom: 0.45,
        tilt: 0,
        fogNear: 300,
        fogFar: 1500,
    },
    cta: {
        position: [0, 6, 30],
        target: [200, 80, 20],
        fov: 42,
        dark: 1,
        bloom: 0.85,
        tilt: 0,
        fogNear: 300,
        fogFar: 1500,
    },
};

export const SEATING_SHOTS: Record<SeatingFocus, SeatingShot> = {
    overview: { position: [18, 46, 6], target: [0, 1.6, -66], fov: 40 },
    C: { position: [ENCLOSURE_X.C + 9.9, 26, -26.4], target: [ENCLOSURE_X.C, 1.6, -66], fov: 36 },
    D: { position: [ENCLOSURE_X.D + 9.9, 26, -26.4], target: [ENCLOSURE_X.D, 1.6, -66], fov: 36 },
};

const NARROWEST_ASPECT = 1.2;

const FIT_STEPS = 24;

const NEAREST_FIT_SHARE = 0.25;

const FARTHEST_FIT_SHARE = 1.25;

const MAX_FIT_LIFT = 40;

const CENTRING_PASSES = 3;

const LANE_SEARCH_X = 200;

const SQUAD_HALF_DEPTH = 3;

const SQUAD_HEIGHT = 1.8;

const SQUAD_BODY_HALF_WIDTH = 0.4;

const WIDEST_FOV = 78;

const FEET_PER_METRE = 3.281;

const FEET_FORMAT = new Intl.NumberFormat('en-IN');

const NUMERIC_KEYS = ['fov', 'dark', 'bloom', 'tilt', 'fogNear', 'fogFar'] as const;

const smoothstep = (t: number) => t * t * (3 - 2 * t);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const pad = (value: number, length: number) => String(value).padStart(length, '0');

export function anchorScroll(
    align: ShotAlign,
    top: number,
    height: number,
    viewportHeight: number,
    maxScroll: number,
): number {
    const offsets: Record<ShotAlign, number> = {
        top: 0,
        center: height / 2 - viewportHeight / 2,
        bottom: height - viewportHeight,
    };

    return clamp(top + offsets[align], 0, maxScroll);
}

export function interpolateShots(anchors: ShotAnchor[], scroll: number, out: Shot): Shot {
    const nextIndex = anchors.findIndex((anchor) => anchor.at > scroll);
    const toIndex = nextIndex === -1 ? anchors.length - 1 : nextIndex;
    const fromIndex = nextIndex === -1 ? toIndex : Math.max(0, nextIndex - 1);
    const from = anchors[fromIndex];
    const to = anchors[toIndex];
    const span = Math.max(to.at - from.at, 1);
    const t = smoothstep(clamp((scroll - from.at) / span, 0, 1));
    const a = SHOTS[from.name];
    const b = SHOTS[to.name];

    for (let axis = 0; axis < 3; axis += 1) {
        out.position[axis] = a.position[axis] + (b.position[axis] - a.position[axis]) * t;
        out.target[axis] = a.target[axis] + (b.target[axis] - a.target[axis]) * t;
    }

    for (const key of NUMERIC_KEYS) out[key] = a[key] + (b[key] - a[key]) * t;

    return out;
}

export function fitFov(fov: number, aspect: number): number {
    if (aspect >= NARROWEST_ASPECT) return fov;

    const halfWidth = Math.tan(toRadians(fov / 2)) * NARROWEST_ASPECT;

    return Math.min(WIDEST_FOV, (2 * Math.atan(halfWidth / aspect) * 180) / Math.PI);
}

export function readoutValues(
    cameraHeight: number,
    heading: number,
    progress: number,
    clock: ReadoutClock,
): { altitude: string; heading: string; clock: string } {
    const feet = Math.max(0, Math.round((cameraHeight * FEET_PER_METRE) / 10) * 10);
    const wrappedHeading = ((Math.round(heading) % 360) + 360) % 360;
    const minutes =
        clock.startMinutes +
        Math.round(clamp(progress, 0, 1) * (clock.endMinutes - clock.startMinutes));

    return {
        altitude: `${FEET_FORMAT.format(feet)} FT`,
        heading: `${pad(wrappedHeading, 3)}°`,
        clock: `${pad(Math.floor(minutes / 60), 2)}:${pad(minutes % 60, 2)}`,
    };
}

export function seatingCamera(shot: SeatingShot, aspect: number): PerspectiveCamera {
    const camera = new PerspectiveCamera(fitFov(shot.fov, aspect), aspect, 0.3, 400);

    camera.position.set(...shot.position);
    camera.lookAt(...shot.target);
    camera.updateMatrixWorld();

    return camera;
}

export function fitSeatingShot(
    shot: SeatingShot,
    points: Point3[],
    aspect: number,
    margin: number,
): SeatingShot {
    const projected = new Vector3();
    const offset = shot.position.map((value, axis) => value - shot.target[axis]);
    const shotAt = (share: number, lift: number): SeatingShot => ({
        ...shot,
        target: [shot.target[0], shot.target[1] + lift, shot.target[2]],
        position: shot.position.map(
            (value, axis) => shot.target[axis] + offset[axis] * share + (axis === 1 ? lift : 0),
        ) as Point3,
    });
    const projectAll = (share: number, lift: number) => {
        const camera = seatingCamera(shotAt(share, lift), aspect);

        return points.map((point) =>
            projected
                .set(...point)
                .project(camera)
                .clone(),
        );
    };
    const fits = (share: number, lift: number) =>
        projectAll(share, lift).every(
            (point) => Math.abs(point.x) <= margin && Math.abs(point.y) <= margin,
        );
    const verticalCentre = (share: number, lift: number) => {
        const ys = projectAll(share, lift).map((point) => point.y);

        return (Math.min(...ys) + Math.max(...ys)) / 2;
    };
    const fitShare = (lift: number) => {
        if (!fits(FARTHEST_FIT_SHARE, lift)) return FARTHEST_FIT_SHARE;

        let near = NEAREST_FIT_SHARE;
        let far = FARTHEST_FIT_SHARE;

        for (let step = 0; step < FIT_STEPS; step += 1) {
            const middle = (near + far) / 2;

            if (fits(middle, lift)) far = middle;
            else near = middle;
        }

        return far;
    };
    const centreLift = (share: number) => {
        let low = -MAX_FIT_LIFT;
        let high = MAX_FIT_LIFT;

        for (let step = 0; step < FIT_STEPS; step += 1) {
            const middle = (low + high) / 2;

            if (verticalCentre(share, middle) > 0) low = middle;
            else high = middle;
        }

        return (low + high) / 2;
    };

    let share = fitShare(0);
    let lift = 0;

    for (let pass = 0; pass < CENTRING_PASSES; pass += 1) {
        lift = centreLift(share);
        share = fitShare(lift);
    }

    return shotAt(share, lift);
}

export function laneFrameEdges(
    shot: SeatingShot,
    aspect: number,
    laneZ: number,
): { left: number; right: number } {
    const camera = seatingCamera(shot, aspect);
    const projected = new Vector3();
    const squadXs = (x: number) =>
        [laneZ - SQUAD_HALF_DEPTH, laneZ + SQUAD_HALF_DEPTH].flatMap((z) =>
            [0, SQUAD_HEIGHT].map((y) => projected.set(x, y, z).project(camera).x),
        );
    const search = (isInside: (x: number) => boolean, outside: number, inside: number) => {
        let out = outside;
        let into = inside;

        for (let step = 0; step < FIT_STEPS; step += 1) {
            const middle = (out + into) / 2;

            if (isInside(middle)) into = middle;
            else out = middle;
        }

        return out;
    };
    const left = search((x) => Math.max(...squadXs(x)) >= -1, -LANE_SEARCH_X, shot.target[0]);
    const right = search((x) => Math.min(...squadXs(x)) <= 1, LANE_SEARCH_X, shot.target[0]);

    return { left: left - SQUAD_BODY_HALF_WIDTH, right: right + SQUAD_BODY_HALF_WIDTH };
}
