import {
    BoxGeometry,
    BufferGeometry,
    CanvasTexture,
    Color,
    Float32BufferAttribute,
    ExtrudeGeometry,
    Object3D,
    PlaneGeometry,
    RepeatWrapping,
    Shape,
    SRGBColorSpace,
} from 'three';
import { mergeAndDispose } from '@/components/scenes/geometry';
import {
    FRONT_ROW_Z,
    ROW_RISE,
    ROW_SPACING,
    CHAIR_PROFILE,
    SEAT_SPACING,
    type HallLayout,
} from '@/components/scenes/seatLayout';

type LabelTextureOptions = {
    text: string;
    width: number;
    height: number;
    background: string;
    color: string;
    size: number;
    spacing: number;
    maxTextWidth: number;
    fontFamily: string;
    glowColor?: string;
};

type SlabOptions = {
    width: number;
    height: number;
    depth: number;
    radius: number;
    curve: number;
    spans?: number;
};

export const DETAILED_SEAT_LIMIT = 1500;
const { backrest } = CHAIR_PROFILE;
export const scratchObject = new Object3D();
const MINIMUM_LABEL_FONT_SIZE = 24;
const CARPET_TILE_SIZE = 3;
const RUNNER_LIFT = 0.012;
const CARPET_COLOR = new Color('#82828a');
const PLINTH_TOP_COLOR = new Color('#3f3f46');
const PLINTH_BOTTOM_COLOR = new Color('#1c1c20');

function placed(geometry: BufferGeometry, x: number, y: number, z: number, tilt = 0) {
    if (tilt) geometry.rotateX(tilt);

    geometry.translate(x, y, z);

    return geometry;
}

function mapCarpetUvs(geometry: BufferGeometry): BufferGeometry {
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const uvs = geometry.getAttribute('uv');

    for (let vertex = 0; vertex < positions.count; vertex += 1) {
        const isFlat = Math.abs(normals.getY(vertex)) > 0.5;
        const isSide = Math.abs(normals.getX(vertex)) > 0.5;
        const across = isSide ? positions.getZ(vertex) : positions.getX(vertex);
        const along = isFlat ? positions.getZ(vertex) : positions.getY(vertex);

        uvs.setXY(vertex, across / CARPET_TILE_SIZE, along / CARPET_TILE_SIZE);
    }

    uvs.needsUpdate = true;

    return geometry;
}

function paintPlinth(geometry: BufferGeometry, topHeight: number): BufferGeometry {
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const colors = new Float32Array(positions.count * 3);
    const shade = new Color();

    for (let vertex = 0; vertex < positions.count; vertex += 1) {
        const isTread = normals.getY(vertex) > 0.5;
        const isRiser = normals.getZ(vertex) < -0.5;
        const height = (positions.getY(vertex) + 0.2) / (topHeight + 0.2);

        if (isTread || isRiser) shade.copy(CARPET_COLOR);
        else shade.copy(PLINTH_BOTTOM_COLOR).lerp(PLINTH_TOP_COLOR, height);

        shade.toArray(colors, vertex * 3);
    }

    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

    return geometry;
}

function createCanvas(width: number, height: number) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    return { canvas, context: canvas.getContext('2d')! };
}

function roundedSlab({ width, height, depth, radius, curve, spans = 1 }: SlabOptions) {
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const straight = width - radius * 2;
    const outline = new Shape();

    outline.moveTo(-halfWidth + radius, -halfHeight);

    for (let span = 1; span <= spans; span += 1) {
        outline.lineTo(-halfWidth + radius + (straight * span) / spans, -halfHeight);
    }

    outline.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + radius);
    outline.lineTo(halfWidth, halfHeight - radius);
    outline.quadraticCurveTo(halfWidth, halfHeight, halfWidth - radius, halfHeight);

    for (let span = 1; span <= spans; span += 1) {
        outline.lineTo(halfWidth - radius - (straight * span) / spans, halfHeight);
    }

    outline.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - radius);
    outline.lineTo(-halfWidth, -halfHeight + radius);
    outline.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + radius, -halfHeight);

    const slab = new ExtrudeGeometry(outline, {
        depth,
        bevelEnabled: false,
        curveSegments: curve,
    });

    return slab.translate(0, 0, -depth / 2);
}

function sideProfileSlab(options: SlabOptions) {
    const slab = roundedSlab({ ...options, width: options.depth, depth: options.width });

    return slab.rotateY(Math.PI / 2);
}

function bent(geometry: BufferGeometry, bend: number): BufferGeometry {
    const positions = geometry.getAttribute('position');

    for (let vertex = 0; vertex < positions.count; vertex += 1) {
        const x = positions.getX(vertex);
        positions.setZ(vertex, positions.getZ(vertex) - bend * x * x);
    }

    return geometry;
}

function onBackrest(geometry: BufferGeometry, offsetY: number, offsetZ: number) {
    geometry.translate(0, offsetY, offsetZ);
    geometry.rotateX(backrest.tilt);

    return geometry.translate(0, backrest.y, backrest.z);
}

export function fitLabelFontSize(
    text: string,
    maxWidth: number,
    baseSize: number,
    measure: (text: string, size: number) => number,
): number {
    const largestSize = Math.floor(baseSize);
    const smallestSize = Math.min(largestSize, MINIMUM_LABEL_FONT_SIZE);

    for (let size = largestSize; size > smallestSize; size -= 1) {
        if (measure(text, size) <= maxWidth) return size;
    }

    return smallestSize;
}

export function createLabelTexture(options: LabelTextureOptions): CanvasTexture {
    const {
        text,
        width,
        height,
        background,
        color,
        size,
        spacing,
        maxTextWidth,
        fontFamily,
        glowColor = '#1c1c22',
    } = options;
    const { canvas, context } = createCanvas(width, height);

    context.letterSpacing = `${spacing}em`;

    const fittedSize = fitLabelFontSize(text, maxTextWidth, size, (label, candidateSize) => {
        context.font = `600 ${candidateSize}px ${fontFamily}`;

        return context.measureText(label).width;
    });

    const glow = context.createRadialGradient(
        width / 2,
        height / 2,
        0,
        width / 2,
        height / 2,
        width / 2,
    );
    glow.addColorStop(0, glowColor);
    glow.addColorStop(1, background);

    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
    context.fillStyle = color;
    context.font = `600 ${fittedSize}px ${fontFamily}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, width / 2, height / 2);

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;

    return texture;
}

export function createGrainTexture({
    seed,
    contrast,
    hasWeave,
}: {
    seed: number;
    contrast: number;
    hasWeave: boolean;
}): CanvasTexture {
    const size = 128;
    const { canvas, context } = createCanvas(size, size);
    const image = context.createImageData(size, size);
    let state = seed;

    for (let pixel = 0; pixel < size * size; pixel += 1) {
        state = (state * 1664525 + 1013904223) >>> 0;

        const column = pixel % size;
        const row = Math.floor(pixel / size);
        const noise = (state / 4294967296 - 0.5) * contrast;
        const thread = hasWeave
            ? (Math.sin(column * 1.6) + Math.sin(row * 1.6)) * contrast * 0.35
            : 0;
        const value = Math.max(0, Math.min(255, 236 + noise + thread));

        image.data[pixel * 4] = value;
        image.data[pixel * 4 + 1] = value;
        image.data[pixel * 4 + 2] = value;
        image.data[pixel * 4 + 3] = 255;
    }

    context.putImageData(image, 0, 0);

    const texture = new CanvasTexture(canvas);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;

    return texture;
}

export function createSoftDiscTexture(): CanvasTexture {
    const size = 128;
    const { canvas, context } = createCanvas(size, size);
    const gradient = context.createRadialGradient(
        size / 2,
        size / 2,
        0,
        size / 2,
        size / 2,
        size / 2,
    );

    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');

    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);

    return new CanvasTexture(canvas);
}

export function createChairGeometries(isDetailed: boolean) {
    const curve = isDetailed ? 3 : 2;
    const spans = isDetailed ? 4 : 2;
    const sideX = -SEAT_SPACING / 2;

    const { width, cushion, shell, arm } = CHAIR_PROFILE;

    const cushionSlab = sideProfileSlab({
        width,
        height: cushion.height,
        depth: cushion.depth,
        radius: 0.075,
        curve,
    });
    const backPad = roundedSlab({
        width,
        height: backrest.height,
        depth: backrest.depth,
        radius: 0.11,
        curve,
        spans,
    });
    const backShell = roundedSlab({
        width: width + shell.extraWidth,
        height: shell.height,
        depth: shell.depth,
        radius: 0.07,
        curve,
        spans,
    });

    const upholstery = mergeAndDispose([
        placed(cushionSlab, 0, cushion.y, cushion.z, cushion.tilt),
        onBackrest(bent(backPad, backrest.bend), 0, 0),
    ]);

    const frame = mergeAndDispose([
        onBackrest(bent(backShell, backrest.bend), shell.offsetY, shell.offsetZ),
        placed(new BoxGeometry(0.05, 0.6, 0.44), sideX, 0.3, 0.02),
        placed(
            sideProfileSlab({
                width: arm.width,
                height: arm.height,
                depth: arm.depth,
                radius: 0.025,
                curve,
            }),
            sideX,
            arm.y,
            arm.z,
        ),
    ]);

    const shadow = new PlaneGeometry(1.05, 0.95);
    shadow.rotateX(-Math.PI / 2);
    shadow.translate(0, 0.008, 0.1);

    return { upholstery, frame, shadow };
}

export function createRowEndGeometry(isDetailed: boolean): BufferGeometry {
    const panel = sideProfileSlab({
        width: 0.07,
        height: 0.92,
        depth: 0.66,
        radius: 0.12,
        curve: isDetailed ? 3 : 2,
    });

    return panel.translate(0, 0.46, 0.02);
}

export function createTierGeometry(rows: number, hall: HallLayout): BufferGeometry {
    const floor = new BoxGeometry(hall.floor.width, 0.2, hall.floor.depth);
    floor.translate(0, -0.1, hall.floor.z);

    const steps = Array.from({ length: Math.max(0, rows - 1) }, (_, offset) => {
        const row = offset + 1;
        const height = row * ROW_RISE;
        const isLast = row === rows - 1;
        const depth = isLast ? ROW_SPACING + 0.6 : ROW_SPACING;
        const step = new BoxGeometry(hall.floor.width, height, depth);

        return step.translate(
            0,
            height / 2,
            FRONT_ROW_Z + row * ROW_SPACING + (depth - ROW_SPACING) / 2,
        );
    });

    return paintPlinth(mapCarpetUvs(mergeAndDispose([floor, ...steps])), (rows - 1) * ROW_RISE);
}

export function createRunnerGeometry(rows: number, hall: HallLayout): BufferGeometry {
    const apronDepth = FRONT_ROW_Z + ROW_SPACING / 2 - hall.stage.frontZ;
    const apron = new BoxGeometry(hall.runnerWidth, RUNNER_LIFT, apronDepth);
    apron.translate(0, RUNNER_LIFT / 2, hall.stage.frontZ + apronDepth / 2);

    const steps = Array.from({ length: Math.max(0, rows - 1) }, (_, offset) => {
        const row = offset + 1;
        const height = row * ROW_RISE + RUNNER_LIFT;
        const step = new BoxGeometry(hall.runnerWidth, height, ROW_SPACING + RUNNER_LIFT);

        return step.translate(0, height / 2, FRONT_ROW_Z + row * ROW_SPACING - RUNNER_LIFT / 2);
    });

    return mapCarpetUvs(mergeAndDispose([apron, ...steps]));
}

export function createDrapeGeometry(width: number, height: number, folds: number, depth: number) {
    const segments = Math.max(24, Math.round(folds * 8));
    const drape = new PlaneGeometry(width, height, segments, 1);
    const positions = drape.getAttribute('position');

    for (let vertex = 0; vertex < positions.count; vertex += 1) {
        const across = (positions.getX(vertex) / width + 0.5) * folds * Math.PI * 2;
        positions.setZ(vertex, Math.sin(across) * depth);
    }

    drape.computeVertexNormals();

    return drape;
}
