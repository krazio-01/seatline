import { Box3, Vector3, type Ray } from 'three';
import type { Point3 } from '@/components/scenes/seatLayout';
import type { EventZone, ZoneName } from '@/types/booking';

export type ParadeSeat = {
    zone: ZoneName;
    row: number;
    column: number;
    isBooked: boolean;
    position: Point3;
};

export type EnclosureLayout = { seats: ParadeSeat[]; rows: number; depth: number; centerZ: number };

export type HotspotView = ZoneName | 'dais';

export type ScreenPin = { x: number; y: number; isVisible: boolean };

export type Hotspot = {
    id: string;
    title: string;
    detail: string;
    action?: string;
    view?: HotspotView;
    contingent?: number;
    boxes: Box3[];
};

export const SQUARE = { width: 160, depth: 76, centerZ: -22 };

export const SQUARE_NORTH = SQUARE.centerZ - SQUARE.depth / 2;

export const SQUARE_SOUTH = SQUARE.centerZ + SQUARE.depth / 2;

export const DAIS = { front: SQUARE_NORTH, depth: 7, width: 12, height: 1.2 };

export const DAIS_CENTER_Z = DAIS.front - DAIS.depth / 2;

export const LANE_Z = -47;

export const MARCH_SPAN = 150;

export const MARCH_FADE = 6;

export const MARCH_SPEED = 1.45;

export const CONTINGENTS = 5;

export const FILES = 6;

export const RANKS = 7;

export const RANK_SPACING = 1.05;

export const COMMANDER_LEAD = 3.2;

export const GUARD_SQUADS = [-30, 30];

export const GUARD_ROWS = 4;

export const GUARD_COLUMNS = 10;

export const BUILDING_Z = -112;

export const CAMPUS_CENTER_Z = -40;

export const ENCLOSURE_X: Record<ZoneName, number> = { C: -22, D: 22 };

export const ENCLOSURE_WIDTH = 20.6;

export const SEATS_PER_ROW = 23;

export const MAX_ROWS = 10;

export const ROW_SPACING = 1.15;

export const ROW_RISE = 0.16;

export const FRONT_ROW_Z = DAIS.front - 2.4;

export const SQUAD_LENGTH = (RANKS - 1) * RANK_SPACING + COMMANDER_LEAD;

export const SQUAD_PASS = { entryX: -64, exitX: 64, pauseSeconds: 13.5 };

export const SQUAD_PASS_SECONDS =
    (SQUAD_PASS.exitX - SQUAD_PASS.entryX + SQUAD_LENGTH) / MARCH_SPEED;

const LEFT_BLOCK_SEATS = 11;

const AISLE_HALF_WIDTH = 0.95;

const SEAT_PITCH = 0.74;

const ENCLOSURE_MARGIN = 3.85;

const NEIGHBOUR_RADIUS = 1.7;

const AHEAD_DEPTH = 2.5;

const AHEAD_HALF_WIDTH = 1.6;

const seatOffset = (column: number) =>
    column < LEFT_BLOCK_SEATS
        ? -AISLE_HALF_WIDTH - (LEFT_BLOCK_SEATS - 1 - column) * SEAT_PITCH
        : AISLE_HALF_WIDTH + (column - LEFT_BLOCK_SEATS) * SEAT_PITCH;

const box3 = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) =>
    new Box3(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ));

const scratchHit = new Vector3();

export function layoutEnclosure(zone: EventZone): EnclosureLayout {
    const seatCount = Math.min(zone.capacity, MAX_ROWS * SEATS_PER_ROW);
    const rows = Math.ceil(seatCount / SEATS_PER_ROW);
    const depth = Math.max(rows, 1) * ROW_SPACING + ENCLOSURE_MARGIN;
    const seats = Array.from({ length: seatCount }, (unused, index): ParadeSeat => {
        const row = Math.floor(index / SEATS_PER_ROW);
        const column = index % SEATS_PER_ROW;

        return {
            zone: zone.name,
            row,
            column,
            isBooked: index < zone.allocated,
            position: [
                ENCLOSURE_X[zone.name] + seatOffset(column),
                ROW_RISE + ROW_RISE * row,
                FRONT_ROW_Z - row * ROW_SPACING,
            ],
        };
    });

    return { seats, rows, depth, centerZ: DAIS.front - depth / 2 - 0.4 };
}

export function nextFreeSeat(seats: ParadeSeat[]): ParadeSeat | null {
    return seats.find((seat) => !seat.isBooked) ?? null;
}

export function fullZoneViewSeat(seats: ParadeSeat[]): ParadeSeat {
    const viewRow = seats.some((seat) => seat.row === 1) ? 1 : 0;
    const rowSeats = seats.filter((seat) => seat.row === viewRow);

    return rowSeats[Math.floor(rowSeats.length / 2)];
}

export function sightlineBlockers(seats: ParadeSeat[], viewer: ParadeSeat): number[] {
    const [viewerX, , viewerZ] = viewer.position;

    return seats.flatMap((seat, index) => {
        if (!seat.isBooked || seat === viewer) return [];

        const [x, , z] = seat.position;
        const isNeighbour = Math.hypot(x - viewerX, z - viewerZ) < NEIGHBOUR_RADIUS;
        const isAhead =
            z > viewerZ + 0.1 &&
            z < viewerZ + AHEAD_DEPTH &&
            Math.abs(x - viewerX) < AHEAD_HALF_WIDTH;

        return isNeighbour || isAhead ? [index] : [];
    });
}

export function contingentLeadX(contingent: number, time: number): number {
    const start = contingent * (MARCH_SPAN / CONTINGENTS) + COMMANDER_LEAD;

    return -MARCH_SPAN / 2 + ((start + time * MARCH_SPEED) % MARCH_SPAN);
}

export function buildHotspots(zones: EventZone[], paradeBegins: string): Hotspot[] {
    const enclosures = zones.flatMap((zone): Hotspot[] => {
        if (zone.capacity === 0) return [];

        const { centerZ, depth } = layoutEnclosure(zone);
        const x = ENCLOSURE_X[zone.name];
        const side = x < 0 ? 'left' : 'right';
        const seatsLeft = zone.capacity - zone.allocated;

        return [
            {
                id: `enclosure-${zone.name}`,
                title: `Enclosure ${zone.name}`,
                detail:
                    seatsLeft > 0
                        ? `${seatsLeft} of ${zone.capacity} seats left, ${side} of the dais.`
                        : `Full, ${side} of the dais.`,
                action: seatsLeft > 0 ? 'See the view from a seat' : 'See the view',
                view: zone.name,
                boxes: [box3(x - 11, 0, centerZ - depth / 2 - 0.6, x + 11, 4.6, DAIS.front + 1.8)],
            },
        ];
    });

    const contingents = Array.from({ length: CONTINGENTS }, (unused, contingent): Hotspot => ({
        id: `contingent-${contingent + 1}`,
        title: `Contingent ${contingent + 1}`,
        detail: `${FILES * RANKS} flight cadets and their commander, marching past the dais.`,
        contingent,
        boxes: [new Box3()],
    }));

    return [
        {
            id: 'dais',
            title: 'Reviewing dais',
            detail: 'The Reviewing Officer takes the salute from here.',
            action: 'Stand on the dais',
            view: 'dais',
            boxes: [box3(-6.6, 0, DAIS.front - DAIS.depth - 0.5, 6.6, 6, DAIS.front + 1.3)],
        },
        ...enclosures,
        {
            id: 'guard',
            title: 'Guard of honour',
            detail: `${GUARD_SQUADS.length * GUARD_ROWS * GUARD_COLUMNS} cadets stand ready for the general salute.`,
            boxes: GUARD_SQUADS.map((x) => box3(x - 5, 0, -6.6, x + 5, 2, -2.3)),
        },
        {
            id: 'building',
            title: 'Academy headquarters',
            detail: `The clock tower reads ${paradeBegins} as the parade begins.`,
            boxes: [
                box3(-63, 0, BUILDING_Z - 8, 63, 28, BUILDING_Z + 11),
                box3(-95, 0, BUILDING_Z - 5, 95, 9.5, BUILDING_Z + 10),
            ],
        },
        {
            id: 'guardian',
            title: 'Gate guardian',
            detail: 'A retired fighter mounted at the edge of the ground.',
            boxes: [box3(-101, 0, -39, -91, 7, -29)],
        },
        {
            id: 'colours',
            title: 'The colours',
            detail: 'The national flag and two IAF ensigns fly behind the dais.',
            boxes: [
                box3(-10, 6, DAIS.front - DAIS.depth - 3.4, 10, 13.5, DAIS.front - DAIS.depth - 1),
            ],
        },
        ...contingents,
    ];
}

export function updateContingentHotspots(hotspots: Hotspot[], time: number): void {
    for (const hotspot of hotspots) {
        if (hotspot.contingent === undefined) continue;

        const leadX = contingentLeadX(hotspot.contingent, time);

        hotspot.boxes[0].min.set(
            leadX - COMMANDER_LEAD - (RANKS - 1) * RANK_SPACING - 0.6,
            0,
            LANE_Z - 3,
        );
        hotspot.boxes[0].max.set(leadX + 0.6, 2.1, LANE_Z + 3);
    }
}

export function hotspotAnchor(hotspot: Hotspot, out: Vector3): Vector3 {
    const box = hotspot.boxes[0];

    return out.set((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
}

export function leadingContingent(hotspots: Hotspot[], time: number): Hotspot | null {
    let leading: Hotspot | null = null;
    let leadingDistance = Infinity;

    for (const hotspot of hotspots) {
        if (hotspot.contingent === undefined) continue;

        const distance = Math.abs(contingentLeadX(hotspot.contingent, time));
        if (distance >= leadingDistance) continue;

        leadingDistance = distance;
        leading = hotspot;
    }

    return leading;
}

export function nearestPin(pins: ScreenPin[], x: number, y: number, radius: number): number {
    let nearest = -1;
    let nearestDistance = radius;

    pins.forEach((pin, index) => {
        if (!pin.isVisible) return;

        const distance = Math.hypot(pin.x - x, pin.y - y);
        if (distance > nearestDistance) return;

        nearestDistance = distance;
        nearest = index;
    });

    return nearest;
}

export function pickHotspot(ray: Ray, hotspots: Hotspot[], hit: Vector3): Hotspot | null {
    let nearest: Hotspot | null = null;
    let nearestDistance = Infinity;

    for (const hotspot of hotspots) {
        for (const box of hotspot.boxes) {
            if (!ray.intersectBox(box, scratchHit)) continue;

            const distance = scratchHit.distanceToSquared(ray.origin);
            if (distance >= nearestDistance) continue;

            nearestDistance = distance;
            nearest = hotspot;
            hit.copy(scratchHit);
        }
    }

    return nearest;
}

export function squadPass(
    elapsed: number,
    passSeconds = SQUAD_PASS_SECONDS,
): {
    marchTime: number;
    isMarching: boolean;
    secondsToChange: number;
} {
    const cycle = elapsed % (passSeconds + SQUAD_PASS.pauseSeconds);
    const isMarching = cycle < passSeconds;

    return {
        marchTime: isMarching ? cycle : passSeconds,
        isMarching,
        secondsToChange: isMarching
            ? passSeconds - cycle
            : passSeconds + SQUAD_PASS.pauseSeconds - cycle,
    };
}
