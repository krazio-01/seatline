import { EVENT_ZONES, ZONE_LABELS, type ZoneName, type ZoneOccupancy } from '@/types/booking';

type ZoneSeating = { name: ZoneName; capacity: number };

type SeatPlacement = {
    key: string;
    zone: ZoneName;
    x: number;
    y: number;
    z: number;
    row: number;
    delay: number;
};

export type Point3 = [number, number, number];

export type HighlightFocus = { indices: number[]; center: Point3; radius: number; yaw: number };

export type SeatState = 'booked' | 'checkedIn';

export type SeatStatus = 'available' | SeatState;

export type HallLayout = {
    width: number;
    seating: { frontZ: number; backZ: number; topHeight: number };
    floor: { width: number; depth: number; z: number };
    runnerWidth: number;
    stage: { width: number; depth: number; height: number; z: number; frontZ: number };
    backWall: { width: number; height: number; z: number };
    curtain: { width: number; height: number; x: number; z: number };
    valance: { height: number; y: number };
    screen: { width: number; height: number; y: number; z: number };
    extents: Point3[];
};

export const SEAT_STATUS_LABEL: Record<SeatStatus, string> = {
    available: 'Available',
    booked: 'Booked',
    checkedIn: 'Checked in',
};

export const SEAT_COLORS = {
    available: '#d4d4d8',
    booked: '#3f3f46',
    adminBooked: '#71717a',
    checkedIn: '#09090b',
    glow: '#16a34a',
};

export const CHAIR_PROFILE = {
    width: 0.7,
    cushion: { y: 0.47, z: -0.06, height: 0.17, depth: 0.52, tilt: -0.06 },
    backrest: { y: 0.92, z: 0.25, tilt: 0.17, height: 0.8, depth: 0.13, bend: 0.28 },
    shell: { offsetY: -0.18, offsetZ: 0.085, height: 0.5, depth: 0.05, extraWidth: 0.05 },
    arm: { y: 0.65, z: -0.02, width: 0.085, height: 0.06, depth: 0.56 },
};

export const ROW_SPACING = 1.05;
export const ROW_RISE = 0.22;
export const SEAT_SPACING = 0.82;
const AISLE_WIDTH = 1.8;
export const FRONT_ROW_Z = -3.6;
export const SEATS_PER_ZONE_ROW = 12;
const CHAIR_HEIGHT = 1.02;
const SIDE_MARGIN = 2.5;
const STAGE_DEPTH = 4.95;
const STAGE_HEIGHT = 0.8;
const STAGE_FRONT_GAP = 1.8;
const STAGE_FLOOR_DEPTH = 3.2;
const SCREEN_ASPECT = 0.26;
const SCREEN_LIFT = 0.75;
const BACK_FLOOR_MARGIN = 0.6;
const ZONE_SIGN_GAP = 0.95;
const GRID_SEATS_PER_ROW = SEATS_PER_ZONE_ROW * 2;

function seatX(seat: number, gridWidth: number): number {
    const leftCount = Math.ceil(gridWidth / 2);
    const halfAisle = AISLE_WIDTH / 2;

    if (seat < leftCount) return -(halfAisle + (leftCount - 1 - seat) * SEAT_SPACING);

    return halfAisle + (seat - leftCount) * SEAT_SPACING;
}

function zoneSeatX(zone: ZoneName, positionFromAisle: number): number {
    const side = EVENT_ZONES.indexOf(zone) === 0 ? -1 : 1;

    return side * (AISLE_WIDTH / 2 + positionFromAisle * SEAT_SPACING);
}

function rowSeatCount(capacity: number, row: number): number {
    return Math.min(SEATS_PER_ZONE_ROW, Math.max(0, capacity - row * SEATS_PER_ZONE_ROW));
}

function zoneKey(zone: ZoneName, indexInZone: number): string {
    return `${zone}:${indexInZone}`;
}

export function zoneRowCount(zones: ZoneSeating[]): number {
    return Math.max(1, ...zones.map((zone) => Math.ceil(zone.capacity / SEATS_PER_ZONE_ROW)));
}

export function computeSeatLayout(zones: ZoneSeating[]): SeatPlacement[] {
    const layout: SeatPlacement[] = [];

    for (const zone of zones) {
        for (let index = 0; index < zone.capacity; index += 1) {
            const row = Math.floor(index / SEATS_PER_ZONE_ROW);
            const x = zoneSeatX(zone.name, index % SEATS_PER_ZONE_ROW);

            layout.push({
                key: zoneKey(zone.name, index),
                zone: zone.name,
                x,
                y: row * ROW_RISE,
                z: FRONT_ROW_Z + row * ROW_SPACING,
                row,
                delay: row * 0.07 + Math.abs(x) * 0.012,
            });
        }
    }

    return layout;
}

export function zoneSeatStates(zones: ZoneOccupancy[]): Record<string, SeatState> {
    const states: Record<string, SeatState> = {};

    for (const zone of zones) {
        const booked = Math.min(Math.max(zone.booked, 0), zone.capacity);
        const checkedIn = Math.min(Math.max(zone.checkedIn, 0), zone.capacity);

        for (let index = 0; index < Math.max(booked, checkedIn); index += 1) {
            states[zoneKey(zone.name, index)] = index < checkedIn ? 'checkedIn' : 'booked';
        }
    }

    return states;
}

export function diffSeatStates(
    previous: Record<string, SeatState>,
    next: Record<string, SeatState>,
): string[] {
    return Object.keys(next).filter(
        (key) => next[key] === 'checkedIn' && previous[key] !== 'checkedIn',
    );
}

export function zoneSeatKeys(layout: SeatPlacement[], zone: ZoneName): string[] {
    return layout.flatMap((placement) => (placement.zone === zone ? [placement.key] : []));
}

export function zoneSignPositions(layout: SeatPlacement[]): { zone: ZoneName; position: Point3 }[] {
    return EVENT_ZONES.flatMap((zone) => {
        const frontRow = layout.filter(
            (placement) => placement.zone === zone && placement.row === 0,
        );
        if (frontRow.length === 0) return [];

        const xs = frontRow.map((placement) => placement.x);
        const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;

        return [{ zone, position: [centerX, 0.02, FRONT_ROW_Z - ZONE_SIGN_GAP] as Point3 }];
    });
}

export function seatStatus(key: string, seatStates: Record<string, SeatState>): SeatStatus {
    return seatStates[key] ?? 'available';
}

export function seatHoverText(
    placement: Pick<SeatPlacement, 'zone' | 'key'>,
    seatStates: Record<string, SeatState>,
): string {
    return `${ZONE_LABELS[placement.zone]} · ${SEAT_STATUS_LABEL[seatStatus(placement.key, seatStates)]}`;
}

export function computeHighlightFocus(
    highlightedKeys: string[],
    layout: SeatPlacement[],
    hallWidth: number,
    highlightYaw: number,
): HighlightFocus | null {
    const keys = new Set(highlightedKeys);
    const indices = layout.flatMap((placement, index) => (keys.has(placement.key) ? [index] : []));
    const placements = indices.map((index) => layout[index]);

    if (placements.length === 0) return null;

    const xs = placements.map((placement) => placement.x);
    const zs = placements.map((placement) => placement.z);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centerZ = (Math.min(...zs) + Math.max(...zs)) / 2;
    const halfSpan = Math.max(
        (Math.max(...xs) - Math.min(...xs)) / 2,
        (Math.max(...zs) - Math.min(...zs)) / 2,
    );
    const topY = Math.max(...placements.map((placement) => placement.y));

    return {
        indices,
        center: [centerX, topY + 0.03, centerZ],
        radius: Math.max(1.2, halfSpan + 0.6),
        yaw: (centerX / (hallWidth / 2)) * highlightYaw,
    };
}

export function hallBounds(zones: ZoneSeating[]): { width: number; depth: number } {
    const widestSeat = Math.abs(seatX(0, GRID_SEATS_PER_ROW));

    return {
        width: widestSeat * 2 + SIDE_MARGIN,
        depth: zoneRowCount(zones) * ROW_SPACING + STAGE_DEPTH,
    };
}

export function computeRowEnds(zones: ZoneSeating[]): Point3[][] {
    const halfSlot = SEAT_SPACING / 2;

    return Array.from({ length: zoneRowCount(zones) }, (_, row) => {
        const y = row * ROW_RISE;
        const z = FRONT_ROW_Z + row * ROW_SPACING;

        return zones.flatMap((zone) => {
            const count = rowSeatCount(zone.capacity, row);
            if (count === 0) return [];

            const inner = zoneSeatX(zone.name, 0);
            const outer = zoneSeatX(zone.name, count - 1);
            const side = Math.sign(inner);

            return [
                [inner - side * halfSlot, y, z],
                [outer + side * halfSlot, y, z],
            ] as Point3[];
        });
    });
}

export function computeHallLayout(zones: ZoneSeating[]): HallLayout {
    const { width } = hallBounds(zones);
    const rows = zoneRowCount(zones);

    const seatingFrontZ = FRONT_ROW_Z - ROW_SPACING / 2;
    const seatingBackZ = FRONT_ROW_Z + (rows - 0.5) * ROW_SPACING;
    const topHeight = (rows - 1) * ROW_RISE;

    const stageWidth = width * 0.8;
    const stageFrontZ = FRONT_ROW_Z - STAGE_FRONT_GAP;
    const stageBackZ = stageFrontZ - STAGE_FLOOR_DEPTH;

    const screenWidth = stageWidth * 0.62;
    const screenHeight = screenWidth * SCREEN_ASPECT;
    const screenBottom = STAGE_HEIGHT + SCREEN_LIFT;
    const valanceHeight = Math.max(0.35, screenHeight * 0.18);
    const wallHeight = screenBottom + screenHeight + 0.45 + valanceHeight;
    const curtainWidth = stageWidth * 0.11;

    const floorBackZ = seatingBackZ + BACK_FLOOR_MARGIN;
    const floorWidth = width + 0.4;
    const halfFloor = floorWidth / 2;
    const halfStage = stageWidth / 2;
    const seatingTop = topHeight + CHAIR_HEIGHT;

    return {
        width,
        seating: { frontZ: seatingFrontZ, backZ: seatingBackZ, topHeight },
        floor: {
            width: floorWidth,
            depth: floorBackZ - stageBackZ,
            z: (floorBackZ + stageBackZ) / 2,
        },
        runnerWidth: AISLE_WIDTH * 0.55,
        stage: {
            width: stageWidth,
            depth: STAGE_FLOOR_DEPTH,
            height: STAGE_HEIGHT,
            z: stageFrontZ - STAGE_FLOOR_DEPTH / 2,
            frontZ: stageFrontZ,
        },
        backWall: { width: stageWidth, height: wallHeight, z: stageBackZ },
        curtain: {
            width: curtainWidth,
            height: wallHeight - valanceHeight + 0.05,
            x: halfStage - curtainWidth / 2,
            z: stageBackZ + 0.45,
        },
        valance: { height: valanceHeight, y: wallHeight - valanceHeight / 2 },
        screen: {
            width: screenWidth,
            height: screenHeight,
            y: screenBottom + screenHeight / 2,
            z: stageBackZ + 0.12,
        },
        extents: [
            [-halfFloor, -0.2, floorBackZ],
            [halfFloor, -0.2, floorBackZ],
            [-halfFloor, seatingTop, floorBackZ],
            [halfFloor, seatingTop, floorBackZ],
            [-halfFloor, -0.2, stageBackZ],
            [halfFloor, -0.2, stageBackZ],
            [-halfStage, wallHeight, stageBackZ],
            [halfStage, wallHeight, stageBackZ],
        ],
    };
}
