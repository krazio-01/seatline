import {
    BoxGeometry,
    Color,
    CylinderGeometry,
    InstancedBufferAttribute,
    InstancedMesh,
    Matrix4,
    MeshLambertMaterial,
    PlaneGeometry,
    type BufferGeometry,
    type ColorRepresentation,
} from 'three';
import { mergeAndDispose, paintGeometry } from '@/components/scenes/geometry';
import { seatedGuestGeometry } from '@/components/scenes/ParadeWorld/paradeAnatomy';
import {
    DAIS,
    ENCLOSURE_WIDTH,
    ENCLOSURE_X,
    FRONT_ROW_Z,
    layoutEnclosure,
    ROW_RISE,
    ROW_SPACING,
    type EnclosureLayout,
    type ParadeSeat,
} from '@/components/scenes/paradeLayout';
import type { Point3 } from '@/components/scenes/seatLayout';
import type { EventZone, ZoneName } from '@/types/booking';

export type BoardLine = { text: string; font: string; y: number; spacing?: string; color?: string };

export type EnclosureParts = {
    solid: BufferGeometry[];
    fabric: BufferGeometry[];
    valance: BufferGeometry[];
};

export type EnclosureLayouts = Partial<Record<ZoneName, EnclosureLayout>>;

export type SeatedGuests = {
    chairs: InstancedMesh;
    clothing: InstancedMesh;
    skin: InstancedMesh;
    chairSeats: ParadeSeat[];
    guestSeats: ParadeSeat[];
    dispose: () => void;
};

export const POLE = 0xf6f6f4;
export const METAL = 0x5d6066;
export const CHARCOAL = 0x2b2c30;
export const TRICOLOUR = ['#FF9933', '#ffffff', '#138808'];
export const ENCLOSURE_BOARD = {
    width: 3.2,
    height: 1.6,
    pixels: [768, 384] as const,
    offsetX: -7.9,
    y: 2.0,
    z: DAIS.front + 1.43,
};

const DECK = 0xd2d1cc;
const RISER = 0xc8c7c2;
const VALANCE_FABRIC_HEIGHT = 40;
const VALANCE_SCALLOP_RADIUS = 16;
const SKIN_TONES = [0xb98a6c, 0xa57a5c, 0x8e6447, 0xc99d7f, 0x7c5640, 0xb08166];
const OUTFITS = [
    0xe08a2e, 0x8c2a3a, 0x2f7f86, 0xd4a73a, 0x3456a0, 0xf2efe8, 0xd8798b, 0x7d8a4a, 0xeadfc8,
    0x3a3b40, 0xffffff, 0x9b5fa6,
];
const SECOND_LOOK_SHARE = 0.5;
const LOOK_SHADER = `
    attribute float aGuestPart;
    attribute float aLook;
    float lookScale() {
        return aGuestPart > 0.5 ? aLook : aGuestPart < -0.5 ? 1.0 - aLook : 1.0;
    }`;
const CHAIR_WHITE = new Color(0xffffff);

function placedPart(
    geometry: BufferGeometry,
    color: ColorRepresentation,
    [x, y, z]: Point3,
): BufferGeometry {
    geometry.translate(x, y, z);

    return paintGeometry(geometry, color);
}

function lookMaterial(): MeshLambertMaterial {
    const material = new MeshLambertMaterial({ vertexColors: true });

    material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>\n${LOOK_SHADER}`,
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\ntransformed *= lookScale();',
        );
    };
    material.customProgramCacheKey = () => 'parade-guest-look';

    return material;
}

export function canopyGeometry(
    width: number,
    depth: number,
    height: number,
    poleSpacingX: number,
    poleSpacingZ: number,
    offsetX: number,
    offsetZ: number,
): BufferGeometry {
    const geometry = new PlaneGeometry(width, depth, Math.round(width * 2), Math.round(depth * 2));
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.attributes.position;

    for (let index = 0; index < position.count; index += 1) {
        const u = ((((position.getX(index) + offsetX) / poleSpacingX) % 1) + 1) % 1;
        const v = ((((position.getZ(index) + offsetZ) / poleSpacingZ) % 1) + 1) % 1;

        position.setY(
            index,
            height - Math.pow(Math.sin(Math.PI * u) * Math.sin(Math.PI * v), 0.8) * 0.32,
        );
    }

    geometry.computeVertexNormals();

    return geometry;
}

export function valancePlane(length: number, [x, y, z]: Point3, rotationY: number): BufferGeometry {
    const geometry = new PlaneGeometry(length, 0.9);
    const uv = geometry.attributes.uv;

    for (let index = 0; index < uv.count; index += 1)
        uv.setX(index, uv.getX(index) * (length / 1.2));

    geometry.rotateY(rotationY);

    return geometry.translate(x, y, z);
}

export function buildEnclosureParts(zones: EventZone[]): {
    layouts: EnclosureLayouts;
    parts: Partial<Record<ZoneName, EnclosureParts>>;
} {
    const layouts: EnclosureLayouts = {};
    const parts: Partial<Record<ZoneName, EnclosureParts>> = {};

    for (const zone of zones) {
        if (zone.capacity === 0) continue;

        const layout = layoutEnclosure(zone);
        const x = ENCLOSURE_X[zone.name];
        const canopyDepth = layout.depth + 0.8;
        const solid: BufferGeometry[] = [];
        const part = (geometry: BufferGeometry, color: ColorRepresentation, position: Point3) =>
            solid.push(placedPart(geometry, color, position));

        part(new BoxGeometry(ENCLOSURE_WIDTH, ROW_RISE, layout.depth), DECK, [
            x,
            ROW_RISE / 2,
            layout.centerZ,
        ]);
        for (let row = 1; row < layout.rows; row += 1) {
            part(new BoxGeometry(ENCLOSURE_WIDTH - 0.4, ROW_RISE * row, ROW_SPACING), RISER, [
                x,
                ROW_RISE + (ROW_RISE / 2) * row,
                FRONT_ROW_Z - row * ROW_SPACING,
            ]);
        }
        for (const poleX of [-10.5, -3.5, 3.5, 10.5]) {
            for (const poleZ of [
                DAIS.front - 0.6,
                layout.centerZ,
                DAIS.front - layout.depth - 0.2,
            ]) {
                part(new CylinderGeometry(0.06, 0.06, 4.4, 8), POLE, [x + poleX, 2.2, poleZ]);
            }
        }
        for (let post = -3; post <= 3; post += 1)
            part(new CylinderGeometry(0.035, 0.05, 0.95, 10), METAL, [
                x + post * 3.3,
                0.475,
                DAIS.front + 0.4,
            ]);

        const rope = new CylinderGeometry(0.02, 0.02, 19.8, 6);
        rope.rotateZ(Math.PI / 2);
        part(rope, CHARCOAL, [x, 0.82, DAIS.front + 0.4]);
        part(new CylinderGeometry(0.05, 0.05, 2.6, 8), METAL, [x - 9.3, 1.3, DAIS.front + 1.4]);
        part(new CylinderGeometry(0.05, 0.05, 2.6, 8), METAL, [x - 6.5, 1.3, DAIS.front + 1.4]);

        const canopy = canopyGeometry(
            22,
            canopyDepth,
            4.4,
            7,
            layout.depth / 2,
            10.5,
            layout.depth / 2,
        );

        layouts[zone.name] = layout;
        parts[zone.name] = {
            solid,
            fabric: [canopy.translate(x, 0, layout.centerZ)],
            valance: [
                valancePlane(22, [x, 3.95, layout.centerZ + canopyDepth / 2], 0),
                valancePlane(22, [x, 3.95, layout.centerZ - canopyDepth / 2], Math.PI),
                valancePlane(canopyDepth, [x - 11, 3.95, layout.centerZ], -Math.PI / 2),
                valancePlane(canopyDepth, [x + 11, 3.95, layout.centerZ], Math.PI / 2),
            ],
        };
    }

    return { layouts, parts };
}

export function buildSeatedGuests(layouts: EnclosureLayouts, random: () => number): SeatedGuests {
    const chairGeometry = mergeAndDispose([
        paintGeometry(new BoxGeometry(0.5, 0.46, 0.5).translate(0, 0.23, 0), 0xffffff, true),
        paintGeometry(new BoxGeometry(0.5, 0.62, 0.07).translate(0, 0.77, -0.215), 0xffffff, true),
        paintGeometry(new BoxGeometry(0.52, 0.07, 0.09).translate(0, 0.68, -0.215), 0xc4c3be, true),
    ]);
    const chairMaterial = new MeshLambertMaterial({ vertexColors: true });
    const chairSeats = Object.values(layouts).flatMap((layout) => layout.seats);
    const chairs = new InstancedMesh(chairGeometry, chairMaterial, Math.max(chairSeats.length, 1));
    const seatMatrix = new Matrix4();

    chairs.count = chairSeats.length;
    chairSeats.forEach((seat, index) => {
        chairs.setMatrixAt(index, seatMatrix.makeTranslation(...seat.position));
        chairs.setColorAt(index, CHAIR_WHITE);
    });
    chairs.castShadow = true;
    chairs.receiveShadow = true;

    const guestGeometry = seatedGuestGeometry();
    const guestSeats = chairSeats.filter((seat) => seat.isBooked);
    const guestCapacity = Math.max(guestSeats.length, 1);
    const clothingMaterial = lookMaterial();
    const skinMaterial = lookMaterial();
    const clothing = new InstancedMesh(guestGeometry.clothing, clothingMaterial, guestCapacity);
    const skin = new InstancedMesh(guestGeometry.skin, skinMaterial, guestCapacity);
    const looks = new Float32Array(guestCapacity);
    const tone = new Color();

    clothing.count = guestSeats.length;
    skin.count = guestSeats.length;
    guestSeats.forEach((seat, index) => {
        seatMatrix.makeTranslation(...seat.position);
        clothing.setMatrixAt(index, seatMatrix);
        skin.setMatrixAt(index, seatMatrix);
        clothing.setColorAt(index, tone.setHex(OUTFITS[Math.floor(random() * OUTFITS.length)]));
        skin.setColorAt(index, tone.setHex(SKIN_TONES[Math.floor(random() * SKIN_TONES.length)]));
        looks[index] = random() < SECOND_LOOK_SHARE ? 1 : 0;
    });

    const lookAttribute = new InstancedBufferAttribute(looks, 1);
    guestGeometry.clothing.setAttribute('aLook', lookAttribute);
    guestGeometry.skin.setAttribute('aLook', lookAttribute);
    for (const mesh of [clothing, skin]) mesh.receiveShadow = true;

    return {
        chairs,
        clothing,
        skin,
        chairSeats,
        guestSeats,
        dispose: () => {
            for (const mesh of [chairs, clothing, skin]) mesh.dispose();
            for (const geometry of [chairGeometry, guestGeometry.clothing, guestGeometry.skin])
                geometry.dispose();
            for (const material of [chairMaterial, clothingMaterial, skinMaterial])
                material.dispose();
        },
    };
}

export function enclosureBoardLines(
    zone: EventZone,
    fonts: { serif: string; sans: string },
): BoardLine[] {
    return [
        {
            text: 'ENCLOSURE',
            font: `500 52px ${fonts.sans}`,
            y: 78,
            spacing: '14px',
            color: '#d4d4d8',
        },
        { text: zone.name, font: `600 220px ${fonts.serif}`, y: 214 },
        {
            text: `${zone.capacity} SEATS`,
            font: `500 40px ${fonts.sans}`,
            y: 330,
            spacing: '10px',
            color: '#a1a1aa',
        },
    ];
}

export function drawBoard(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    lines: BoardLine[],
    hasTricolour = false,
): void {
    context.fillStyle = '#111114';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(255,255,255,0.8)';
    context.lineWidth = height * 0.018;
    context.strokeRect(height * 0.05, height * 0.05, width - height * 0.1, height - height * 0.1);

    if (hasTricolour) {
        const inset = height * 0.09;
        const bandHeight = height * 0.022;

        TRICOLOUR.forEach((color, band) => {
            context.fillStyle = color;
            context.fillRect(inset, inset + band * bandHeight, width - inset * 2, bandHeight);
        });
    }

    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (const line of lines) {
        context.fillStyle = line.color ?? '#ffffff';
        context.font = line.font;
        context.letterSpacing = line.spacing ?? '0px';
        context.fillText(line.text, width / 2, line.y);
    }
}

export function drawValance(
    context: CanvasRenderingContext2D,
    width: number,
    bands: string[],
): void {
    const bandHeight = VALANCE_FABRIC_HEIGHT / bands.length;

    bands.forEach((color, band) => {
        context.fillStyle = color;
        context.fillRect(0, band * bandHeight, width, bandHeight);
    });

    context.fillStyle = bands[bands.length - 1];
    for (let x = VALANCE_SCALLOP_RADIUS; x < width + VALANCE_SCALLOP_RADIUS; x += 32) {
        context.beginPath();
        context.arc(x, VALANCE_FABRIC_HEIGHT, VALANCE_SCALLOP_RADIUS, 0, Math.PI * 2);
        context.fill();
    }

    context.fillStyle = '#2b2c30';
    context.fillRect(0, 6, width, 2);
}
