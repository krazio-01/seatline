import {
    BoxGeometry,
    ClampToEdgeWrapping,
    CircleGeometry,
    Color,
    CylinderGeometry,
    DoubleSide,
    ExtrudeGeometry,
    Group,
    InstancedMesh,
    Mesh,
    MeshBasicMaterial,
    MeshLambertMaterial,
    MeshStandardMaterial,
    NoColorSpace,
    PlaneGeometry,
    Shape,
    SphereGeometry,
    Vector2,
    type BufferGeometry,
    type CanvasTexture,
    type ColorRepresentation,
    type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
    canvasTexture,
    mergeAndDispose,
    paintGeometry,
    seededRandom,
} from '@/components/scenes/geometry';
import {
    BUILDING_Z,
    CAMPUS_CENTER_Z,
    DAIS,
    DAIS_CENTER_Z,
    ENCLOSURE_X,
    GUARD_SQUADS,
    SQUARE,
    LANE_Z,
    SQUARE_NORTH,
    SQUARE_SOUTH,
    type EnclosureLayout,
    type ParadeSeat,
} from '@/components/scenes/paradeLayout';
import {
    buildEnclosureParts,
    buildSeatedGuests,
    canopyGeometry,
    CHARCOAL,
    drawBoard,
    drawValance,
    ENCLOSURE_BOARD,
    enclosureBoardLines,
    METAL,
    POLE,
    TRICOLOUR,
    valancePlane,
    type BoardLine,
} from '@/components/scenes/ParadeWorld/paradeEnclosures';
import {
    buildGarden,
    drawLeaf,
    drawLeafCluster,
    type ParadeGarden,
} from '@/components/scenes/ParadeWorld/paradeGarden';
import { buildJetGeometry } from '@/components/scenes/ParadeWorld/paradeSky';
import type { Point3 } from '@/components/scenes/seatLayout';
import type { EventZone, ZoneName } from '@/types/booking';

type Disposable = { dispose: () => void };

export type SceneryInput = {
    zones: EventZone[];
    eventName: string;
    eventYear: string;
    paradeMinutes: number;
    trees: number;
    serifFamily: string;
    sansFamily: string;
    anisotropy: number;
};

export type ParadeScenery = {
    group: Group;
    enclosures: Partial<Record<ZoneName, EnclosureLayout>>;
    chairs: InstancedMesh;
    chairSeats: ParadeSeat[];
    guests: { clothing: InstancedMesh; skin: InstancedMesh; seats: ParadeSeat[] };
    flagTime: { value: number };
    garden: ParadeGarden;
    dispose: () => void;
};

export const WORLD_LAYERS = { detail: 1, shadow: 2 };

const STONE = 0xf1f0ec;
const TRIM = 0xfbfbf9;
const WALL = 0xf0eee9;
const ROOF = 0xd9d8d4;
const CARPET = 0x7a2230;
const KERB = 0xdedcd7;
const MIN_FONT_SHARE = 0.15;
const FONT_STEP = 0.96;
const CONTACT = { minX: -130, maxX: 130, minZ: -140, maxZ: 30, scale: 4 };
const SLABS_PER_TILE = 4;
const SHADE = 'rgba(120, 110, 96,';
const LIGHT = 'rgba(255, 253, 248,';
const PAVING_TONE_SIZE = [1024, 512] as const;
const PLASTER_TONE_SCALE = 0.11;
const PAVING_TONE_FRAGMENT = `
    uniform sampler2D uPaving;
    uniform vec2 uPavingScale;`;
const PLASTER_TONE_VERTEX = `
    varying vec3 vPlasterPosition;
    varying vec3 vPlasterNormal;`;
const PLASTER_TONE_FRAGMENT = `
    uniform sampler2D uPlaster;
    varying vec3 vPlasterPosition;
    varying vec3 vPlasterNormal;
    vec3 plasterTone() {
        vec3 facing = abs(vPlasterNormal);
        vec2 surface = facing.y > 0.7
            ? vPlasterPosition.xz
            : facing.x > facing.z ? vPlasterPosition.zy : vPlasterPosition.xy;
        vec3 shade = texture2D(uPlaster, surface * ${PLASTER_TONE_SCALE.toFixed(2)}).rgb;
        float plinth = mix(0.96, 1.0, smoothstep(0.0, 1.2, vPlasterPosition.y));
        return shade * plinth;
    }`;
const LAWN_SIZE = 1700;
const LAWN_REPEAT = 64;
const LAWN_FAR = 0xdce2cd;
const LAWN_FADE = { from: 90, to: 190 };

const FLAG_UNIFORMS =
    'uniform float uFlagTime; uniform float uFlagWidth; uniform float uFlagPhase;';

const FLAG_NORMAL = `
    float flagU = position.x / uFlagWidth;
    float wavePhase = flagU * 6.0 - uFlagTime * 4.2 + position.y * 0.6 + uFlagPhase;
    float amplitude = 0.09 * uFlagWidth * flagU;
    vec3 objectNormal = normalize(vec3(-(cos(wavePhase) * 6.0 / uFlagWidth * amplitude + sin(wavePhase) * 0.09), -cos(wavePhase) * 0.6 * amplitude, 1.0));`;

const FLAG_POSITION = `
    vec3 transformed = vec3(position);
    transformed.z += sin(wavePhase) * amplitude;
    transformed.y += sin(flagU * 4.0 - uFlagTime * 3.1 + uFlagPhase) * 0.025 * uFlagWidth * flagU;`;

function drawTricolour(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
) {
    const bands: [string, number][] = [
        ['#ff9933', 0],
        ['#ffffff', 1],
        ['#138808', 2],
    ];

    for (const [color, band] of bands) {
        context.fillStyle = color;
        context.fillRect(x, y + (band * height) / 3, width, height / 3 + 1);
    }

    const radius = height * 0.13;
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    context.strokeStyle = '#000080';
    context.lineWidth = Math.max(1, height * 0.012);
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.stroke();

    for (let spoke = 0; spoke < 24; spoke += 1) {
        const angle = (spoke / 24) * Math.PI * 2;

        context.beginPath();
        context.moveTo(centerX, centerY);
        context.lineTo(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
        context.stroke();
    }
}

function drawRoundel(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
    const rings: [string, number][] = [
        ['#ff9933', 1],
        ['#ffffff', 0.66],
        ['#138808', 0.33],
    ];

    for (const [color, scale] of rings) {
        context.fillStyle = color;
        context.beginPath();
        context.arc(x, y, radius * scale, 0, Math.PI * 2);
        context.fill();
    }
}

function speckle(
    context: CanvasRenderingContext2D,
    random: () => number,
    width: number,
    height: number,
    count: number,
    colorFor: () => string,
    size: number,
) {
    for (let index = 0; index < count; index += 1) {
        context.fillStyle = colorFor();
        context.fillRect(random() * width, random() * height, size, size);
    }
}

function tone(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    color: string,
) {
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function tiled(width: number, height: number, draw: (offsetX: number, offsetY: number) => void) {
    for (const offsetX of [-width, 0, width]) {
        for (const offsetY of [-height, 0, height]) draw(offsetX, offsetY);
    }
}

function grain(
    context: CanvasRenderingContext2D,
    random: () => number,
    width: number,
    height: number,
    count: number,
) {
    speckle(
        context,
        random,
        width,
        height,
        count,
        () =>
            random() < 0.5
                ? `${SHADE} ${0.025 + random() * 0.03})`
                : `${LIGHT} ${0.05 + random() * 0.06})`,
        1,
    );
}

export function drawPavingTone(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    random: () => number,
    laneShare: number,
) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);

    for (let index = 0; index < 50; index += 1)
        tone(
            context,
            random() * width,
            random() * height,
            40 + random() * 110,
            `${SHADE} ${0.02 + random() * 0.03})`,
        );

    const laneY = laneShare * height;
    const polish = context.createLinearGradient(0, laneY - 34, 0, laneY + 34);
    polish.addColorStop(0, `${SHADE} 0)`);
    polish.addColorStop(0.5, `${SHADE} 0.045)`);
    polish.addColorStop(1, `${SHADE} 0)`);
    context.fillStyle = polish;
    context.fillRect(0, laneY - 34, width, 68);

    const edge = 18;
    for (const [x, y, gradientWidth, gradientHeight, fromX, fromY, toX, toY] of [
        [0, 0, width, edge, 0, 0, 0, edge],
        [0, height - edge, width, edge, 0, height, 0, height - edge],
        [0, 0, edge, height, 0, 0, edge, 0],
        [width - edge, 0, edge, height, width, 0, width - edge, 0],
    ]) {
        const kerb = context.createLinearGradient(fromX, fromY, toX, toY);
        kerb.addColorStop(0, `${SHADE} 0.06)`);
        kerb.addColorStop(1, `${SHADE} 0)`);
        context.fillStyle = kerb;
        context.fillRect(x, y, gradientWidth, gradientHeight);
    }
}

export function drawPlasterTone(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    random: () => number,
) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);

    for (let index = 0; index < 18; index += 1) {
        const x = random() * width;
        const y = random() * height;
        const radius = 50 + random() * 90;
        const color = `${SHADE} ${0.02 + random() * 0.025})`;
        tiled(width, height, (offsetX, offsetY) =>
            tone(context, x + offsetX, y + offsetY, radius, color),
        );
    }

    grain(context, random, width, height, 14000);
}

function grainFacade(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    random: () => number,
) {
    const base = context.createLinearGradient(0, height, 0, height - 30);
    base.addColorStop(0, `${SHADE} 0.06)`);
    base.addColorStop(1, `${SHADE} 0)`);
    context.fillStyle = base;
    context.fillRect(0, height - 30, width, 30);

    grain(context, random, width, height, 7000);
}

export function fitBoardFont(
    measure: (font: string) => number,
    text: string,
    maxWidth: number,
    family: string,
    startSize: number,
): string {
    const fontAt = (size: number) => `500 ${Math.round(size)}px ${family}`;
    let size = startSize;

    while (measure(fontAt(size)) > maxWidth && size > startSize * MIN_FONT_SHARE) size *= FONT_STEP;

    return fontAt(size);
}

export function buildScenery(input: SceneryInput): ParadeScenery {
    const random = seededRandom(20261115);
    const toneRandom = seededRandom(1947);
    const trash: Disposable[] = [];
    const keep = <Item extends Disposable>(item: Item): Item => {
        trash.push(item);
        return item;
    };
    const texture = (
        width: number,
        height: number,
        draw: (context: CanvasRenderingContext2D, width: number, height: number) => void,
        repeat?: [number, number],
    ): CanvasTexture =>
        keep(canvasTexture(width, height, draw, { repeat, anisotropy: input.anisotropy }));
    const group = new Group();
    const addMesh = (
        geometry: BufferGeometry,
        material: Material,
        options: { cast?: boolean; receive?: boolean } = {},
    ) => {
        const mesh = new Mesh(keep(geometry), keep(material));
        mesh.castShadow = options.cast ?? false;
        mesh.receiveShadow = options.receive ?? false;
        group.add(mesh);

        return mesh;
    };

    const lawnTexture = texture(
        512,
        512,
        (context, width, height) => {
            for (let stripe = 0; stripe < 8; stripe += 1) {
                context.fillStyle = stripe % 2 === 0 ? '#e1e6d3' : '#d8dfc7';
                context.fillRect((stripe * width) / 8, 0, width / 8, height);
            }
            speckle(
                context,
                random,
                width,
                height,
                12000,
                () =>
                    random() < 0.5
                        ? `rgba(92, 112, 62, ${0.03 + random() * 0.04})`
                        : `rgba(255, 252, 236, ${0.04 + random() * 0.05})`,
                2,
            );
        },
        [LAWN_REPEAT, LAWN_REPEAT],
    );
    const lawnMaterial = new MeshLambertMaterial({ map: lawnTexture });
    lawnMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uLawnFar = { value: new Color(LAWN_FAR) };
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            '#include <common>\nuniform vec3 uLawnFar;',
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            float lawnDistance = length(vMapUv - vec2(${(LAWN_REPEAT / 2).toFixed(1)}, ${(LAWN_REPEAT / 2 - (CAMPUS_CENTER_Z * LAWN_REPEAT) / LAWN_SIZE).toFixed(3)})) * ${(LAWN_SIZE / LAWN_REPEAT).toFixed(3)};
            diffuseColor.rgb = mix(diffuseColor.rgb, uLawnFar, smoothstep(${LAWN_FADE.from.toFixed(1)}, ${LAWN_FADE.to.toFixed(1)}, lawnDistance));`,
        );
    };
    lawnMaterial.customProgramCacheKey = () => 'parade-lawn';
    const lawn = addMesh(new PlaneGeometry(LAWN_SIZE, LAWN_SIZE), lawnMaterial, { receive: true });
    lawn.rotation.x = -Math.PI / 2;

    const squareTexture = texture(
        1024,
        1024,
        (context, width, height) => {
            const slab = width / SLABS_PER_TILE;

            for (let row = 0; row < SLABS_PER_TILE; row += 1) {
                for (let column = 0; column < SLABS_PER_TILE; column += 1) {
                    const tone = random();
                    context.fillStyle = `rgb(${242 - tone * 5}, ${236 - tone * 5}, ${225 - tone * 5})`;
                    context.fillRect(column * slab, row * slab, slab, slab);
                }
            }
            speckle(
                context,
                random,
                width,
                height,
                26000,
                () =>
                    `rgba(${random() < 0.5 ? '255,250,240' : '120,96,64'}, ${0.03 + random() * 0.05})`,
                1.5,
            );
            context.fillStyle = 'rgba(150, 128, 98, 0.2)';
            for (let line = 0; line < SLABS_PER_TILE; line += 1) {
                context.fillRect(line * slab, 0, 2, height);
                context.fillRect(0, line * slab, width, 2);
            }
            context.fillStyle = 'rgba(255, 252, 244, 0.35)';
            for (let line = 0; line < SLABS_PER_TILE; line += 1) {
                context.fillRect(line * slab + 2, 0, 1, height);
                context.fillRect(0, line * slab + 2, width, 1);
            }
        },
        [SQUARE.width / 12, SQUARE.depth / 12],
    );
    const squareRepeat = [SQUARE.width / 12, SQUARE.depth / 12] as const;
    const pavingTone = texture(PAVING_TONE_SIZE[0], PAVING_TONE_SIZE[1], (context, width, height) =>
        drawPavingTone(context, width, height, toneRandom, (LANE_Z - SQUARE_NORTH) / SQUARE.depth),
    );
    const squareMaterial = new MeshLambertMaterial({ map: squareTexture });
    squareMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uPaving = { value: pavingTone };
        shader.uniforms.uPavingScale = {
            value: new Vector2(1 / squareRepeat[0], 1 / squareRepeat[1]),
        };
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>\n${PAVING_TONE_FRAGMENT}`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            '#include <map_fragment>\ndiffuseColor.rgb *= texture2D(uPaving, vMapUv * uPavingScale).rgb;',
        );
    };
    squareMaterial.customProgramCacheKey = () => 'parade-square';
    const square = addMesh(new PlaneGeometry(SQUARE.width, SQUARE.depth), squareMaterial, {
        receive: true,
    });
    square.rotation.x = -Math.PI / 2;
    square.position.set(0, 0.02, SQUARE.centerZ);

    const paintParts: BufferGeometry[] = [];
    const paint = (width: number, depth: number, x: number, z: number) => {
        const stripe = new PlaneGeometry(width, depth);
        stripe.rotateX(-Math.PI / 2);
        paintParts.push(stripe.translate(x, 0.045, z));
    };
    paint(SQUARE.width - 2, 0.16, 0, SQUARE_NORTH + 1);
    paint(SQUARE.width - 2, 0.16, 0, SQUARE_SOUTH - 1);
    paint(0.16, SQUARE.depth - 2, -SQUARE.width / 2 + 1, SQUARE.centerZ);
    paint(0.16, SQUARE.depth - 2, SQUARE.width / 2 - 1, SQUARE.centerZ);
    paint(SQUARE.width - 8, 0.1, 0, -43.5);
    paint(SQUARE.width - 8, 0.1, 0, -50.5);
    for (let x = -72; x <= 72; x += 8) paint(0.5, 0.5, x, -40);
    addMesh(mergeAndDispose(paintParts), new MeshLambertMaterial({ color: 0xffffff }), {
        receive: true,
    });

    const scenery: BufferGeometry[] = [];
    const part = (
        geometry: BufferGeometry,
        color: ColorRepresentation,
        [x, y, z]: Point3 = [0, 0, 0],
        rotationY = 0,
    ) => {
        geometry.rotateY(rotationY);
        geometry.translate(x, y, z);
        scenery.push(paintGeometry(geometry, color));
    };

    for (const z of [SQUARE_NORTH, SQUARE_SOUTH])
        part(new BoxGeometry(SQUARE.width + 0.8, 0.16, 0.4), KERB, [0, 0.08, z]);
    for (const side of [-1, 1])
        part(new BoxGeometry(0.4, 0.16, SQUARE.depth), KERB, [
            side * (SQUARE.width / 2 + 0.2),
            0.08,
            SQUARE.centerZ,
        ]);

    part(new RoundedBoxGeometry(DAIS.width, DAIS.height, DAIS.depth, 2, 0.06), STONE, [
        0,
        DAIS.height / 2,
        DAIS_CENTER_Z,
    ]);
    for (const step of [0, 1, 2]) {
        const height = 0.3 * (step + 1);
        const z = DAIS.front + 0.35 * (2 - step) + 0.175;
        part(new BoxGeometry(4.4, height, 0.35), STONE, [0, height / 2, z]);
        part(new BoxGeometry(2.4, 0.012, 0.35), CARPET, [0, height + 0.006, z]);
    }
    part(new BoxGeometry(2.4, 0.012, DAIS.depth - 0.6), CARPET, [
        0,
        DAIS.height + 0.006,
        DAIS_CENTER_Z + 0.3,
    ]);
    for (const x of [-4.1, 4.1])
        part(new BoxGeometry(3.8, 0.75, 0.12), TRIM, [x, DAIS.height + 0.375, DAIS.front - 0.06]);
    for (const side of [-1, 1])
        part(new BoxGeometry(0.12, 0.75, DAIS.depth), TRIM, [
            side * (DAIS.width / 2 - 0.06),
            DAIS.height + 0.375,
            DAIS_CENTER_Z,
        ]);
    for (const [x, z] of [
        [-6.2, DAIS.front - 0.3],
        [6.2, DAIS.front - 0.3],
        [-6.2, DAIS.front - DAIS.depth + 0.3],
        [6.2, DAIS.front - DAIS.depth + 0.3],
    ]) {
        part(new CylinderGeometry(0.07, 0.07, 4.6, 10), POLE, [x, DAIS.height + 2.3, z]);
    }
    for (let seat = -2; seat <= 2; seat += 1) {
        part(new BoxGeometry(0.62, 0.5, 0.6), CARPET, [
            seat * 1.2,
            DAIS.height + 0.25,
            DAIS_CENTER_Z - 0.6,
        ]);
        part(new BoxGeometry(0.62, 0.9, 0.12), CARPET, [
            seat * 1.2,
            DAIS.height + 0.9,
            DAIS_CENTER_Z - 0.9,
        ]);
    }

    const fabricParts: BufferGeometry[] = [];
    const valanceParts: BufferGeometry[] = [];
    const valance = (length: number, position: Point3, rotationY: number) => {
        valanceParts.push(valancePlane(length, position, rotationY));
    };
    const { layouts: enclosures, parts: enclosureParts } = buildEnclosureParts(input.zones);

    for (const zoneParts of Object.values(enclosureParts)) {
        scenery.push(...zoneParts.solid);
        fabricParts.push(...zoneParts.fabric);
        valanceParts.push(...zoneParts.valance);
    }

    const daisCanopy = canopyGeometry(13.2, 7.4, DAIS.height + 4.6, 12.4, 6.4, 6.2, 3.2);
    fabricParts.push(daisCanopy.translate(0, 0, DAIS_CENTER_Z));
    valance(13.2, [0, DAIS.height + 4.15, DAIS_CENTER_Z + 3.7], 0);

    part(new BoxGeometry(124, 11, 16), WALL, [0, 5.5, BUILDING_Z]);
    part(new BoxGeometry(125, 0.7, 16.6), TRIM, [0, 11.2, BUILDING_Z]);
    part(new BoxGeometry(124.4, 0.5, 16.4), TRIM, [0, 5.4, BUILDING_Z]);
    for (const side of [-1, 1]) {
        part(new BoxGeometry(30, 9, 14), WALL, [side * 79, 4.5, BUILDING_Z + 3]);
        part(new BoxGeometry(31, 0.6, 14.6), TRIM, [side * 79, 9.2, BUILDING_Z + 3]);
    }
    for (let column = 0; column < 17; column += 1)
        part(new CylinderGeometry(0.34, 0.38, 7, 14), TRIM, [
            -24 + column * 3,
            3.5,
            BUILDING_Z + 10.4,
        ]);
    part(new BoxGeometry(51, 0.8, 4.4), TRIM, [0, 7.4, BUILDING_Z + 10]);
    part(
        new ExtrudeGeometry(
            new Shape([new Vector2(-11, 0), new Vector2(11, 0), new Vector2(0, 3.2)]),
            { depth: 1.2, bevelEnabled: false },
        ),
        TRIM,
        [0, 7.8, BUILDING_Z + 10.6],
    );
    part(new BoxGeometry(51, 0.3, 4.4), STONE, [0, 0.15, BUILDING_Z + 10]);
    part(new BoxGeometry(9, 24, 9), WALL, [0, 12, BUILDING_Z - 2]);
    part(new BoxGeometry(9.8, 0.6, 9.8), TRIM, [0, 24.2, BUILDING_Z - 2]);
    part(new SphereGeometry(4.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0xe6e5e1, [
        0,
        24.4,
        BUILDING_Z - 2,
    ]);
    part(new CylinderGeometry(0.06, 0.1, 3, 8), METAL, [0, 30, BUILDING_Z - 2]);
    part(new BoxGeometry(126, 0.3, 18), ROOF, [0, 11.65, BUILDING_Z]);

    for (let x = -75; x <= 75; x += 15) {
        part(new CylinderGeometry(0.07, 0.1, 6.5, 8), METAL, [x, 3.25, SQUARE_SOUTH + 2.5]);
        part(new BoxGeometry(0.5, 0.25, 0.9), METAL, [x, 6.55, SQUARE_SOUTH + 2.2]);
    }
    for (let z = -50; z <= 10; z += 15) {
        for (const side of [-1, 1]) {
            part(new CylinderGeometry(0.07, 0.1, 6.5, 8), METAL, [
                side * (SQUARE.width / 2 + 3),
                3.25,
                z,
            ]);
            part(new BoxGeometry(0.9, 0.25, 0.5), METAL, [
                side * (SQUARE.width / 2 + 2.6),
                6.55,
                z,
            ]);
        }
    }
    part(new RoundedBoxGeometry(2.6, 3.2, 2.6, 2, 0.08), STONE, [-96, 1.6, -34]);

    const plasterTone = texture(512, 512, (context, width, height) =>
        drawPlasterTone(context, width, height, toneRandom),
    );
    const stoneMaterial = new MeshLambertMaterial({ vertexColors: true });
    stoneMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uPlaster = { value: plasterTone };
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>\n${PLASTER_TONE_VERTEX}`,
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nvPlasterPosition = position;\nvPlasterNormal = normal;',
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>\n${PLASTER_TONE_FRAGMENT}`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <color_fragment>',
            '#include <color_fragment>\ndiffuseColor.rgb *= plasterTone();',
        );
    };
    stoneMaterial.customProgramCacheKey = () => 'parade-plaster';
    addMesh(mergeAndDispose(scenery), stoneMaterial, { cast: true, receive: true });

    const guardian = addMesh(
        buildJetGeometry(0xe4e5e7, CHARCOAL),
        new MeshLambertMaterial({ vertexColors: true }),
        { cast: true },
    );
    guardian.position.set(-96, 3.6, -34);
    guardian.rotation.set(-0.28, 0.9, 0.12);

    addMesh(
        mergeAndDispose(fabricParts),
        new MeshLambertMaterial({ color: 0xffffff, side: DoubleSide }),
        { cast: true },
    );

    const valanceTexture = texture(256, 64, (context, width) =>
        drawValance(context, width, TRICOLOUR),
    );
    valanceTexture.wrapT = ClampToEdgeWrapping;
    addMesh(
        mergeAndDispose(valanceParts),
        new MeshLambertMaterial({ map: valanceTexture, alphaTest: 0.5, side: DoubleSide }),
    );

    const boardTexture = (width: number, height: number, lines: BoardLine[]) =>
        texture(width, height, (context) => drawBoard(context, width, height, lines));
    const addBoard = (
        boardMap: CanvasTexture,
        width: number,
        height: number,
        [x, y, z]: Point3,
    ) => {
        const board = addMesh(
            new PlaneGeometry(width, height),
            new MeshLambertMaterial({ map: boardMap }),
            { cast: true, receive: true },
        );
        board.position.set(x, y, z);
    };

    for (const zone of input.zones) {
        if (zone.capacity === 0) continue;

        addBoard(
            boardTexture(
                ENCLOSURE_BOARD.pixels[0],
                ENCLOSURE_BOARD.pixels[1],
                enclosureBoardLines(zone, { serif: input.serifFamily, sans: input.sansFamily }),
            ),
            ENCLOSURE_BOARD.width,
            ENCLOSURE_BOARD.height,
            [
                ENCLOSURE_X[zone.name] + ENCLOSURE_BOARD.offsetX,
                ENCLOSURE_BOARD.y,
                ENCLOSURE_BOARD.z,
            ],
        );
    }

    const measureCanvas = document.createElement('canvas').getContext('2d');
    const nameFont = fitBoardFont(
        (font) => {
            if (!measureCanvas) return 0;
            measureCanvas.font = font;
            return measureCanvas.measureText(input.eventName).width;
        },
        input.eventName,
        1820,
        input.serifFamily,
        210,
    );
    addBoard(
        boardTexture(2048, 512, [
            { text: input.eventName, font: nameFont, y: 220 },
            {
                text: `INDIAN AIR FORCE · ${input.eventYear}`,
                font: `500 64px ${input.sansFamily}`,
                y: 380,
                spacing: '18px',
                color: '#d4d4d8',
            },
        ]),
        11,
        2.75,
        [0, DAIS.height + 1.9, DAIS.front - DAIS.depth + 0.12],
    );

    const clockTexture = texture(256, 256, (context) => {
        context.fillStyle = '#fbfaf6';
        context.beginPath();
        context.arc(128, 128, 124, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = '#1c1c1f';
        context.lineWidth = 8;
        context.stroke();
        context.lineCap = 'round';
        for (let tick = 0; tick < 12; tick += 1) {
            const angle = (tick / 12) * Math.PI * 2;
            context.lineWidth = 6;
            context.beginPath();
            context.moveTo(128 + Math.sin(angle) * 96, 128 - Math.cos(angle) * 96);
            context.lineTo(128 + Math.sin(angle) * 112, 128 - Math.cos(angle) * 112);
            context.stroke();
        }
        const hand = (angle: number, length: number, width: number) => {
            context.lineWidth = width;
            context.beginPath();
            context.moveTo(128, 128);
            context.lineTo(128 + Math.sin(angle) * length, 128 - Math.cos(angle) * length);
            context.stroke();
        };
        hand((((input.paradeMinutes / 60) % 12) / 12) * Math.PI * 2, 58, 10);
        hand(((input.paradeMinutes % 60) / 60) * Math.PI * 2, 90, 6);
    });
    const clock = addMesh(
        new CircleGeometry(1.6, 40),
        new MeshLambertMaterial({ map: clockTexture }),
    );
    clock.position.set(0, 18.5, BUILDING_Z + 2.53);

    const facadeTexture = texture(2048, 192, (context, width) => {
        context.fillStyle = '#f0eee9';
        context.fillRect(0, 0, width, 192);
        const count = 46;
        for (let index = 0; index < count; index += 1) {
            const x = 18 + index * ((width - 36) / count);
            const windowWidth = (width - 36) / count - 18;
            for (const [floor, [y, windowHeight]] of [
                [22, 52],
                [108, 58],
            ].entries()) {
                context.fillStyle = '#fbfbf9';
                context.fillRect(x - 4, y - 4, windowWidth + 8, windowHeight + 8);
                const gradient = context.createLinearGradient(0, y, 0, y + windowHeight);
                gradient.addColorStop(0, '#a9adb3');
                gradient.addColorStop(1, '#8a8f96');
                context.fillStyle = gradient;
                if (floor === 0) {
                    context.fillRect(x, y, windowWidth, windowHeight);
                    continue;
                }
                context.beginPath();
                context.moveTo(x, y + windowHeight);
                context.lineTo(x, y + windowWidth / 2);
                context.arc(x + windowWidth / 2, y + windowWidth / 2, windowWidth / 2, Math.PI, 0);
                context.lineTo(x + windowWidth, y + windowHeight);
                context.closePath();
                context.fill();
            }
        }
        grainFacade(context, width, 192, toneRandom);
    });
    const facade = addMesh(
        new PlaneGeometry(124, 11),
        new MeshLambertMaterial({ map: facadeTexture }),
        { receive: true },
    );
    facade.position.set(0, 5.5, BUILDING_Z + 8.02);

    const flagTime = { value: 0 };
    const poleMaterial = keep(
        new MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.4, metalness: 0.2 }),
    );
    const addFlag = (
        flagMap: CanvasTexture,
        width: number,
        height: number,
        [x, poleHeight, z]: Point3,
    ) => {
        const pole = new Mesh(keep(new CylinderGeometry(0.06, 0.09, poleHeight, 10)), poleMaterial);
        pole.position.set(x, poleHeight / 2, z);
        pole.castShadow = true;
        group.add(pole);

        const geometry = new PlaneGeometry(width, height, 24, 16);
        geometry.translate(width / 2, 0, 0);

        const material = new MeshLambertMaterial({ map: flagMap, side: DoubleSide });
        const phase = random() * 6;
        material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, {
                uFlagTime: flagTime,
                uFlagWidth: { value: width },
                uFlagPhase: { value: phase },
            });
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                `#include <common>\n${FLAG_UNIFORMS}`,
            );
            shader.vertexShader = shader.vertexShader.replace(
                '#include <beginnormal_vertex>',
                FLAG_NORMAL,
            );
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                FLAG_POSITION,
            );
        };

        const flag = addMesh(geometry, material);
        flag.position.set(x + 0.08, poleHeight - height / 2 - 0.25, z);
    };
    const tricolour = texture(384, 256, (context, width, height) =>
        drawTricolour(context, 0, 0, width, height),
    );
    const ensign = texture(600, 300, (context) => {
        context.fillStyle = '#6a9cc9';
        context.fillRect(0, 0, 600, 300);
        drawTricolour(context, 0, 0, 300, 150);
        drawRoundel(context, 450, 150, 62);
    });
    addFlag(tricolour, 3.6, 2.4, [0, 13, DAIS.front - DAIS.depth - 2.4]);
    addFlag(ensign, 3, 1.5, [-8.5, 10, DAIS.front - DAIS.depth - 1.8]);
    addFlag(ensign, 3, 1.5, [8.5, 10, DAIS.front - DAIS.depth - 1.8]);
    for (let x = -66; x <= 66; x += 22)
        addFlag(x % 44 === 0 ? tricolour : ensign, 1.8, 1.1, [x, 7, SQUARE_SOUTH + 4.5]);

    const garden = buildGarden({
        trees: input.trees,
        random,
        shadowLayer: WORLD_LAYERS.shadow,
        detailLayer: WORLD_LAYERS.detail,
        leafTextures: {
            cluster: texture(256, 256, drawLeafCluster),
            single: texture(64, 64, drawLeaf),
        },
    });
    group.add(garden.group);

    const seated = buildSeatedGuests(enclosures, random);
    const { chairs, chairSeats, clothing, skin, guestSeats } = seated;

    group.add(chairs, clothing, skin);

    const contactTexture = texture(
        (CONTACT.maxX - CONTACT.minX) * CONTACT.scale,
        (CONTACT.maxZ - CONTACT.minZ) * CONTACT.scale,
        (context, width) => {
            const toCanvas = (x: number, z: number): [number, number] => [
                (x - CONTACT.minX) * CONTACT.scale,
                (z - CONTACT.minZ) * CONTACT.scale,
            ];
            const blot = (shape: () => void, blur: number, alpha: number) => {
                context.save();
                context.shadowColor = `rgba(255, 255, 255, ${alpha})`;
                context.shadowBlur = blur * CONTACT.scale;
                context.shadowOffsetX = width * 2;
                context.translate(-width * 2, 0);
                context.fillStyle = '#ffffff';
                context.beginPath();
                shape();
                context.fill();
                context.restore();
            };
            const box = (
                minX: number,
                minZ: number,
                maxX: number,
                maxZ: number,
                blur: number,
                alpha: number,
            ) =>
                blot(
                    () => {
                        const [left, top] = toCanvas(minX, minZ);
                        context.rect(
                            left,
                            top,
                            (maxX - minX) * CONTACT.scale,
                            (maxZ - minZ) * CONTACT.scale,
                        );
                    },
                    blur,
                    alpha,
                );

            box(-62, BUILDING_Z - 8, 62, BUILDING_Z + 8.6, 4, 0.55);
            box(-94, BUILDING_Z - 4, 94, BUILDING_Z + 10, 3, 0.4);
            box(-25.5, BUILDING_Z + 8, 25.5, BUILDING_Z + 12.2, 1.6, 0.35);
            for (const [zone, layout] of Object.entries(enclosures)) {
                const x = ENCLOSURE_X[zone as ZoneName];
                box(
                    x - 10.3,
                    layout.centerZ - layout.depth / 2,
                    x + 10.3,
                    layout.centerZ + layout.depth / 2,
                    1.4,
                    0.5,
                );
            }
            box(
                -DAIS.width / 2,
                DAIS.front - DAIS.depth,
                DAIS.width / 2,
                DAIS.front + 1.1,
                0.9,
                0.6,
            );
            for (const x of GUARD_SQUADS) box(x - 4.6, -6.4, x + 4.6, -2.5, 0.7, 0.35);
            box(-97.3, -35.3, -94.7, -32.7, 0.8, 0.6);
            for (const { x, z } of garden.treeSpots) {
                if (
                    x < CONTACT.minX + 6 ||
                    x > CONTACT.maxX - 6 ||
                    z < CONTACT.minZ + 6 ||
                    z > CONTACT.maxZ - 6
                )
                    continue;
                blot(
                    () => context.arc(...toCanvas(x, z), 2.6 * CONTACT.scale, 0, Math.PI * 2),
                    2.2,
                    0.42,
                );
            }
        },
    );
    contactTexture.colorSpace = NoColorSpace;
    contactTexture.wrapS = ClampToEdgeWrapping;
    contactTexture.wrapT = ClampToEdgeWrapping;

    const contactGeometry = new PlaneGeometry(
        CONTACT.maxX - CONTACT.minX,
        CONTACT.maxZ - CONTACT.minZ,
    );
    contactGeometry.rotateX(-Math.PI / 2);
    const contactShadows = addMesh(
        contactGeometry,
        new MeshBasicMaterial({
            color: 0x1b1c20,
            alphaMap: contactTexture,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
        }),
    );
    contactShadows.position.set(
        (CONTACT.minX + CONTACT.maxX) / 2,
        0.055,
        (CONTACT.minZ + CONTACT.maxZ) / 2,
    );
    contactShadows.renderOrder = -1;

    return {
        group,
        enclosures,
        chairs,
        chairSeats,
        guests: { clothing, skin, seats: guestSeats },
        flagTime,
        garden,
        dispose: () => {
            for (const item of trash) item.dispose();
            seated.dispose();
            garden.dispose();
        },
    };
}
