import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    Color,
    CylinderGeometry,
    DoubleSide,
    Group,
    IcosahedronGeometry,
    InstancedMesh,
    MathUtils,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshLambertMaterial,
    Points,
    Quaternion,
    ShaderMaterial,
    SphereGeometry,
    Vector3,
    type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeAndDispose, paintGeometry, seededRandom } from '@/components/scenes/geometry';
import {
    BUILDING_Z,
    CAMPUS_CENTER_Z,
    DAIS,
    DAIS_CENTER_Z,
    SQUARE,
    SQUARE_NORTH,
    SQUARE_SOUTH,
} from '@/components/scenes/paradeLayout';
import type { Point3 } from '@/components/scenes/seatLayout';

type Disposable = { dispose: () => void };

type TreeSpot = { x: number; z: number; kind: 'ashoka' | 'rain' };

type CrownShape = { center: Point3; radii: Point3 };

type CrownBlob = { center: Vector3; radius: number; stretch: number };

type LeafCardStyle = {
    count: number;
    size: [number, number];
    aspect: number;
    droop: number;
    colors: { low: number; high: number };
};

type TreeParts = { solid: BufferGeometry; leaves: BufferGeometry };

export type GardenInput = {
    trees: number;
    random: () => number;
    shadowLayer: number;
    detailLayer: number;
    leafTextures: { cluster: Texture; single: Texture };
};

export type ParadeGarden = {
    group: Group;
    shadowCasters: InstancedMesh[];
    treeSpots: TreeSpot[];
    woods: InstancedMesh[];
    leafCanopies: InstancedMesh[];
    fallingLeaves: Points<BufferGeometry, ShaderMaterial>;
    dust: Points<BufferGeometry, ShaderMaterial>;
    time: { value: number };
    dispose: () => void;
};

export const SHADOW_PROXY_MATERIAL = new MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
});

const BARK = 0x8d7f6d;
const HEDGE = 0x7f9568;
const HEDGE_TOP = 0x9cb07f;
const TERRACOTTA = 0xb8643c;
const MARIGOLD = [0xf29d1b, 0xf7b733, 0xe9781a];
const LEAF = 0x5f7a45;
const PENNANTS = [0xff9933, 0xfbfaf6, 0x138808];
const AVENUE_SPACING = 9;
const AVENUE_SOUTH_Z = SQUARE_SOUTH + 12;
const AVENUE_SIDE_X = SQUARE.width / 2 + 14;
const GUARDIAN_SPOT = { x: -96, z: -34, radius: 8 };
const WOODS = { innerRadius: 250, maxRows: 3, rowGap: 38, spacing: 18, jitter: 8 };
const FULL_TREE_BUDGET = 100;
const WOODS_COLORS = { low: 0x4d5f45, high: 0x7f9168 };
const WOODS_VARIANTS = [7, 19, 43];
const CROWN_ROUNDNESS = 0.72;
const CORE_SHADE = 0.62;
const RAIN_LEAVES: LeafCardStyle = {
    count: 460,
    size: [1.2, 1.8],
    aspect: 1,
    droop: 0,
    colors: { low: 0x5f7a49, high: 0xb9c98a },
};
const ASHOKA_LEAVES: LeafCardStyle = {
    count: 320,
    size: [0.8, 1.15],
    aspect: 1.7,
    droop: 0.75,
    colors: { low: 0x47633d, high: 0x8fae6c },
};
const FALLING_LEAVES_PER_TREE = 10;
const FALLING_LEAF_REACH = { x: 140, minZ: -150, maxZ: 60 };
const FALLING_LEAF_TINTS = [0x8fa35e, 0xa9b46a, 0xc8b25a, 0xb98a45, 0x7d9150];
const FOLIAGE_VERTEX = `
    uniform float uTime;
    attribute float aSway;
    #ifdef USE_MAP
        attribute float aFlutter;
    #endif
    varying vec3 vLeafPosition;
    varying float vLeafy;
    vec3 swayFoliage(vec3 point) {
        #ifdef USE_INSTANCING
            vec2 root = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
            vec2 root = vec2(0.0);
        #endif
        float wave = uTime * 1.1 - root.x * 0.035 - root.y * 0.02;
        float gust = 0.55 + 0.45 * sin(wave * 0.37);
        float bend = aSway * aSway;
        float sway = (sin(wave) * 0.7 + sin(wave * 2.3 + 1.3) * 0.3) * gust;
        vLeafPosition = point + vec3(root.x, 0.0, root.y) * 0.37;
        vLeafy = step(0.01, aSway);
        point.x += sway * bend * 0.32;
        point.z += sin(wave * 0.8 + 2.1) * bend * 0.12 * gust;
        #ifdef USE_MAP
            float flutter = sin(uTime * 7.0 + aFlutter * 40.0) * (0.6 + gust);
            return point + normal * flutter * 0.07 * aSway;
        #else
            float rustle = sin(uTime * 4.2 + dot(point, vec3(1.7, 2.3, 1.1)));
            return point + normal * rustle * 0.04 * aSway;
        #endif
    }`;
const FOLIAGE_FRAGMENT = `
    varying vec3 vLeafPosition;
    varying float vLeafy;
    float leafHash(vec3 cell) {
        return fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    }
    float leafNoise(vec3 point) {
        vec3 cell = floor(point);
        vec3 blend = fract(point);
        blend = blend * blend * (3.0 - 2.0 * blend);
        return mix(
            mix(mix(leafHash(cell), leafHash(cell + vec3(1, 0, 0)), blend.x),
                mix(leafHash(cell + vec3(0, 1, 0)), leafHash(cell + vec3(1, 1, 0)), blend.x), blend.y),
            mix(mix(leafHash(cell + vec3(0, 0, 1)), leafHash(cell + vec3(1, 0, 1)), blend.x),
                mix(leafHash(cell + vec3(0, 1, 1)), leafHash(cell + vec3(1, 1, 1)), blend.x), blend.y),
            blend.z);
    }
    float leafShade() {
        float clumps = leafNoise(vLeafPosition * 1.25);
        #ifdef USE_MAP
            return mix(1.0, 0.86 + 0.24 * clumps, vLeafy);
        #else
            float leaves = leafNoise(vLeafPosition * 4.3);
            return mix(1.0, 0.8 + 0.34 * clumps + 0.14 * (leaves - 0.5), vLeafy);
        #endif
    }`;
const FALLING_LEAF_VERTEX = `
    uniform float uTime;
    uniform float uScale;
    attribute float aSeed;
    attribute vec3 aTint;
    varying float vSpin;
    varying float vFade;
    varying vec3 vTint;
    void main() {
        float life = fract(uTime * (0.045 + aSeed * 0.035) + aSeed * 7.13);
        vec3 point = position;
        point.y -= life * (position.y - 0.05);
        point.x += sin(life * 9.0 + aSeed * 20.0) * 0.9 + life * 5.0;
        point.z += cos(life * 7.0 + aSeed * 13.0) * 0.7 + life * 1.8;
        vec4 viewPosition = modelViewMatrix * vec4(point, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(0.45 * projectionMatrix[1][1] * uScale * 0.5 / -viewPosition.z, 0.0, 48.0);
        vSpin = uTime * (1.4 + aSeed * 2.2) + aSeed * 6.28;
        vFade = smoothstep(0.0, 0.06, life) * (1.0 - smoothstep(0.92, 1.0, life));
        vTint = aTint;
    }`;
const FALLING_LEAF_FRAGMENT = `
    uniform sampler2D uMap;
    uniform float uOpacity;
    varying float vSpin;
    varying float vFade;
    varying vec3 vTint;
    void main() {
        vec2 centered = gl_PointCoord - 0.5;
        float turn = cos(vSpin * 0.7);
        centered.x /= max(abs(turn), 0.15);
        vec2 spun = vec2(
            cos(vSpin) * centered.x - sin(vSpin) * centered.y,
            sin(vSpin) * centered.x + cos(vSpin) * centered.y
        ) + 0.5;
        vec4 texel = texture2D(uMap, spun);
        if (texel.a * vFade * uOpacity < 0.45) discard;
        gl_FragColor = vec4(texel.rgb * vTint * (0.8 + 0.2 * abs(turn)), 1.0);
    }`;
const DUST_COUNT = 420;
const DUST_BOUNDS = { minX: -70, maxX: 70, minY: 0.4, maxY: 8, minZ: SQUARE_NORTH, maxZ: 18 };

const DUST_VERTEX = `
    uniform float uTime; uniform float uScale;
    attribute float aSeed;
    varying float vAlpha;
    void main() {
        vec3 drift = vec3(sin(uTime * 0.13 + aSeed * 40.0) * 2.2, sin(uTime * 0.21 + aSeed * 17.0) * 0.9, cos(uTime * 0.11 + aSeed * 23.0) * 2.2);
        vec4 viewPosition = modelViewMatrix * vec4(position + drift, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp((0.07 + aSeed * 0.07) * uScale / -viewPosition.z, 0.0, 9.0);
        float twinkle = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed * 1.7) + aSeed * 60.0);
        vAlpha = twinkle * smoothstep(240.0, 30.0, -viewPosition.z) * smoothstep(0.6, 3.0, -viewPosition.z);
    }`;

const DUST_FRAGMENT = `
    uniform float uOpacity;
    varying float vAlpha;
    void main() {
        float distance = length(gl_PointCoord - 0.5);
        if (distance > 0.5) discard;
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.72), smoothstep(0.5, 0.0, distance) * vAlpha * uOpacity);
    }`;

function crownBlobGeometry(blob: CrownBlob, scale: number, detail: number): BufferGeometry {
    const geometry = new IcosahedronGeometry(blob.radius * scale, detail);
    geometry.scale(1, blob.stretch, 1);

    return geometry.translate(blob.center.x, blob.center.y, blob.center.z);
}

function crownSurface(
    point: Vector3,
    shape: CrownShape,
): { normal: Vector3; reach: number; height: number } {
    const [centerX, centerY, centerZ] = shape.center;
    const [radiusX, radiusY, radiusZ] = shape.radii;
    const offsetX = (point.x - centerX) / radiusX;
    const offsetY = (point.y - centerY) / radiusY;
    const offsetZ = (point.z - centerZ) / radiusZ;

    return {
        normal: new Vector3(offsetX / radiusX, offsetY / radiusY, offsetZ / radiusZ).normalize(),
        reach: Math.hypot(offsetX, offsetY, offsetZ),
        height: MathUtils.clamp((offsetY + 1) / 2, 0, 1),
    };
}

function foliageCrown(
    blobs: BufferGeometry[],
    shape: CrownShape,
    colors: { low: number; high: number },
    random: () => number,
    shade = 1,
): BufferGeometry {
    const merged = mergeAndDispose(blobs);
    merged.deleteAttribute('normal');
    merged.deleteAttribute('uv');

    const crown = mergeVertices(merged);
    merged.dispose();
    crown.computeVertexNormals();

    const position = crown.attributes.position;
    const normal = crown.attributes.normal;
    const shades = new Float32Array(position.count * 3);
    const sway = new Float32Array(position.count);
    const low = new Color(colors.low);
    const high = new Color(colors.high);
    const tint = new Color();
    const point = new Vector3();
    const surface = new Vector3();

    for (let index = 0; index < position.count; index += 1) {
        point.fromBufferAttribute(position, index);
        const { normal: outward, reach, height } = crownSurface(point, shape);

        surface.fromBufferAttribute(normal, index).lerp(outward, CROWN_ROUNDNESS).normalize();
        normal.setXYZ(index, surface.x, surface.y, surface.z);

        tint.lerpColors(low, high, height * 0.75 + random() * 0.25);
        tint.multiplyScalar((0.55 + 0.45 * MathUtils.smoothstep(reach, 0.3, 1)) * shade);
        shades.set([tint.r, tint.g, tint.b], index * 3);
        sway[index] = 0.35 + 0.65 * height;
    }

    crown.setAttribute('color', new BufferAttribute(shades, 3));
    crown.setAttribute('aSway', new BufferAttribute(sway, 1));

    return crown;
}

function leafCards(
    blobs: CrownBlob[],
    shape: CrownShape,
    style: LeafCardStyle,
    random: () => number,
): BufferGeometry {
    const corners = [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
    ];
    const positions = new Float32Array(style.count * 12);
    const normals = new Float32Array(style.count * 12);
    const colors = new Float32Array(style.count * 12);
    const uvs = new Float32Array(style.count * 8);
    const sways = new Float32Array(style.count * 4);
    const flutters = new Float32Array(style.count * 4);
    const indices: number[] = [];
    const low = new Color(style.colors.low);
    const high = new Color(style.colors.high);
    const tint = new Color();
    const direction = new Vector3();
    const center = new Vector3();
    const facing = new Vector3();
    const across = new Vector3();
    const along = new Vector3();
    const hang = new Vector3(0, -1, 0);
    const corner = new Vector3();

    for (let card = 0; card < style.count; card += 1) {
        const blob = blobs[Math.floor(random() * blobs.length)];
        direction.set(random() * 2 - 1, random() * 2 - 0.7, random() * 2 - 1).normalize();
        const depth = 0.78 + random() * 0.32;
        center.set(
            blob.center.x + direction.x * blob.radius * depth,
            blob.center.y + direction.y * blob.radius * blob.stretch * depth,
            blob.center.z + direction.z * blob.radius * depth,
        );
        const { normal, reach, height } = crownSurface(center, shape);

        facing
            .set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1)
            .multiplyScalar(0.55)
            .add(direction)
            .normalize();
        along.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).lerp(hang, style.droop);
        across.crossVectors(facing, along).normalize();
        along.crossVectors(across, facing).normalize();

        const size = style.size[0] + random() * (style.size[1] - style.size[0]);
        const sunlit = MathUtils.smoothstep(direction.y, -0.6, 0.7);
        tint.lerpColors(low, high, height * 0.55 + sunlit * 0.25 + random() * 0.2);
        tint.multiplyScalar(0.62 + 0.38 * MathUtils.smoothstep(reach, 0.4, 1.05));
        if (random() < 0.08) tint.lerp(new Color(0xc9c36a), 0.35);

        const flutter = random();
        const sway = 0.35 + 0.65 * height;
        const base = card * 4;

        corners.forEach(([u, v], offset) => {
            corner
                .copy(center)
                .addScaledVector(across, u * size)
                .addScaledVector(along, v * size * style.aspect);
            positions.set([corner.x, corner.y, corner.z], (base + offset) * 3);
            normals.set([normal.x, normal.y, normal.z], (base + offset) * 3);
            colors.set([tint.r, tint.g, tint.b], (base + offset) * 3);
            uvs.set([u + 0.5, v + 0.5], (base + offset) * 2);
            sways[base + offset] = sway;
            flutters[base + offset] = flutter;
        });
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(normals, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setAttribute('aSway', new BufferAttribute(sways, 1));
    geometry.setAttribute('aFlutter', new BufferAttribute(flutters, 1));
    geometry.setIndex(indices);

    return geometry;
}

function bark(geometry: BufferGeometry): BufferGeometry {
    const painted = paintGeometry(geometry, BARK, true);
    painted.setAttribute(
        'aSway',
        new BufferAttribute(new Float32Array(painted.attributes.position.count), 1),
    );

    return painted;
}

function leafyTree(
    blobs: CrownBlob[],
    shape: CrownShape,
    style: LeafCardStyle,
    wood: BufferGeometry,
    random: () => number,
    density: number,
): TreeParts {
    const core = foliageCrown(
        blobs.map((blob) => crownBlobGeometry(blob, 0.86, 0)),
        shape,
        style.colors,
        random,
        CORE_SHADE,
    );

    return {
        solid: mergeAndDispose([core, bark(wood)]),
        leaves: leafCards(
            blobs,
            shape,
            { ...style, count: Math.round(style.count * density) },
            random,
        ),
    };
}

function ashokaTree(seed: number, density: number): TreeParts {
    const random = seededRandom(seed);
    const blobs: CrownBlob[] = [];
    const layers = 11;

    for (let layer = 0; layer < layers; layer += 1) {
        const share = layer / (layers - 1);
        const radius =
            0.3 +
            1.25 * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * share)), 0.8) * (1 - 0.45 * share);

        blobs.push({
            center: new Vector3(
                (random() - 0.5) * 0.4 * radius,
                2.4 + share * 9.6,
                (random() - 0.5) * 0.4 * radius,
            ),
            radius: radius * (0.9 + random() * 0.2),
            stretch: 1.4,
        });
    }

    for (let lobe = 0; lobe < 3; lobe += 1) {
        const angle = (lobe / 3) * Math.PI * 2 + random();
        blobs.push({
            center: new Vector3(Math.cos(angle) * 1.1, 3.6 + random() * 1.4, Math.sin(angle) * 1.1),
            radius: 0.9 + random() * 0.3,
            stretch: 1.6,
        });
    }

    const trunk = new CylinderGeometry(0.12, 0.2, 2.8, 6).translate(0, 1.4, 0);

    return leafyTree(
        blobs,
        { center: [0, 7.2, 0], radii: [1.6, 5.6, 1.6] },
        ASHOKA_LEAVES,
        trunk,
        random,
        density,
    );
}

function rainTree(seed: number, density: number): TreeParts {
    const random = seededRandom(seed);
    const blobs: CrownBlob[] = [];
    const count = 12 + Math.floor(random() * 4);

    for (let index = 0; index < count; index += 1) {
        const angle = random() * Math.PI * 2;
        const reach = Math.sqrt(random()) * 4.2;

        blobs.push({
            center: new Vector3(
                Math.cos(angle) * reach,
                6.2 + random() * 1.6 - reach * 0.24,
                Math.sin(angle) * reach,
            ),
            radius: 1.7 + random() * 1.1,
            stretch: 0.66,
        });
    }

    const limbs = [new CylinderGeometry(0.24, 0.38, 5.2, 7).translate(0, 2.6, 0)];

    for (const angle of [0.2, 2.3, 4.2]) {
        const limb = new CylinderGeometry(0.1, 0.18, 3.2, 5);
        limb.translate(0, 1.6, 0);
        limb.rotateZ(0.75);
        limb.rotateY(angle + random() * 0.4);
        limbs.push(limb.translate(0, 4.2, 0));
    }

    return leafyTree(
        blobs,
        { center: [0, 6.4, 0], radii: [5.4, 2.6, 5.4] },
        RAIN_LEAVES,
        mergeAndDispose(limbs),
        random,
        density,
    );
}

function woodsGeometry(seed: number): BufferGeometry {
    const random = seededRandom(seed);
    const blobs: BufferGeometry[] = [];

    for (let index = 0; index < 4; index += 1) {
        const angle = (index / 4) * Math.PI * 2 + random();
        const reach = index === 0 ? 0 : 2.6 + random() * 1.4;
        const blob = new IcosahedronGeometry(3.1 + random() * 1.2, 1);

        blob.scale(1, 0.85, 1);
        blob.translate(
            Math.cos(angle) * reach,
            4.4 + random() * 2 - reach * 0.3,
            Math.sin(angle) * reach,
        );
        blobs.push(blob);
    }

    const crown = foliageCrown(
        blobs,
        { center: [0, 5, 0], radii: [5, 3.4, 5] },
        WOODS_COLORS,
        random,
    );
    const trunk = new CylinderGeometry(0.3, 0.45, 2.6, 5).translate(0, 1.3, 0);

    return mergeAndDispose([crown, bark(trunk)]);
}

function foliageMaterial(time: { value: number }, leafMap: Texture | null): MeshLambertMaterial {
    const material = new MeshLambertMaterial(
        leafMap
            ? {
                  vertexColors: true,
                  map: leafMap,
                  alphaTest: 0.45,
                  alphaToCoverage: true,
                  side: DoubleSide,
              }
            : { vertexColors: true },
    );

    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = time;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>\n${FOLIAGE_VERTEX}`,
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\ntransformed = swayFoliage(transformed);',
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>\n${FOLIAGE_FRAGMENT}`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <color_fragment>',
            '#include <color_fragment>\ndiffuseColor.rgb *= leafShade();',
        );
        if (leafMap) {
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <normal_fragment_begin>',
                '#include <normal_fragment_begin>\nnormal = normalize(vNormal);',
            );
        }
    };
    material.customProgramCacheKey = () => (leafMap ? 'parade-leaves' : 'parade-foliage');

    return material;
}

function buildFallingLeaves(
    spots: TreeSpot[],
    texture: Texture,
    time: { value: number },
    random: () => number,
): Points<BufferGeometry, ShaderMaterial> {
    const sources = spots.filter(
        ({ x, z, kind }) =>
            kind === 'rain' &&
            Math.abs(x) < FALLING_LEAF_REACH.x &&
            z > FALLING_LEAF_REACH.minZ &&
            z < FALLING_LEAF_REACH.maxZ,
    );
    const count = sources.length * FALLING_LEAVES_PER_TREE;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const tints = new Float32Array(count * 3);
    const tint = new Color();

    for (let index = 0; index < count; index += 1) {
        const { x, z } = sources[index % sources.length];
        const angle = random() * Math.PI * 2;
        const reach = Math.sqrt(random()) * 4.5;

        positions.set(
            [x + Math.cos(angle) * reach, 5.2 + random() * 2.4, z + Math.sin(angle) * reach],
            index * 3,
        );
        seeds[index] = random();
        tint.setHex(FALLING_LEAF_TINTS[Math.floor(random() * FALLING_LEAF_TINTS.length)]);
        tints.set([tint.r, tint.g, tint.b], index * 3);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    geometry.setAttribute('aTint', new BufferAttribute(tints, 3));

    const leaves = new Points(
        geometry,
        new ShaderMaterial({
            uniforms: {
                uTime: time,
                uScale: { value: 1000 },
                uOpacity: { value: 1 },
                uMap: { value: texture },
            },
            vertexShader: FALLING_LEAF_VERTEX,
            fragmentShader: FALLING_LEAF_FRAGMENT,
        }),
    );
    leaves.frustumCulled = false;

    return leaves;
}

function leafPath(context: CanvasRenderingContext2D, length: number, width: number) {
    context.beginPath();
    context.moveTo(0, 0);
    context.bezierCurveTo(width, -length * 0.25, width * 0.8, -length * 0.75, 0, -length);
    context.bezierCurveTo(-width * 0.8, -length * 0.75, -width, -length * 0.25, 0, 0);
    context.closePath();
}

function paintLeaf(context: CanvasRenderingContext2D, length: number, width: number) {
    const shading = context.createLinearGradient(-width, 0, width, 0);
    shading.addColorStop(0, '#d8d8d8');
    shading.addColorStop(0.5, '#ffffff');
    shading.addColorStop(1, '#c4c4c4');

    leafPath(context, length, width);
    context.fillStyle = shading;
    context.fill();

    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(0, -length * 0.92);
    context.strokeStyle = 'rgba(70, 80, 50, 0.28)';
    context.lineWidth = Math.max(1, width * 0.08);
    context.stroke();
}

export function drawLeafCluster(context: CanvasRenderingContext2D, width: number, height: number) {
    const random = seededRandom(97);
    context.clearRect(0, 0, width, height);

    for (let leaf = 0; leaf < 14; leaf += 1) {
        const angle = (leaf / 14) * Math.PI * 2 + random() * 0.4;
        const length = width * (0.26 + random() * 0.14);

        context.save();
        context.translate(
            width / 2 + Math.cos(angle) * width * 0.08,
            height / 2 + Math.sin(angle) * height * 0.08,
        );
        context.rotate(angle + Math.PI / 2);
        paintLeaf(context, length, length * 0.34);
        context.restore();
    }
}

export function drawLeaf(context: CanvasRenderingContext2D, width: number, height: number) {
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(width / 2, height * 0.92);
    paintLeaf(context, height * 0.84, width * 0.26);
    context.restore();
}

function planWoods(rows: number, random: () => number): { position: Vector3; row: number }[] {
    const spots: { position: Vector3; row: number }[] = [];

    for (let row = 0; row < rows; row += 1) {
        const radius = WOODS.innerRadius + row * WOODS.rowGap;
        const count = Math.round((Math.PI * 2 * radius) / WOODS.spacing);
        const offset = (row % 2) * 0.5;

        for (let index = 0; index < count; index += 1) {
            const angle =
                ((index + offset) / count) * Math.PI * 2 +
                ((random() - 0.5) * WOODS.jitter) / radius;
            const reach = radius + (random() - 0.5) * WOODS.jitter * 2;

            spots.push({
                position: new Vector3(
                    Math.cos(angle) * reach,
                    0,
                    CAMPUS_CENTER_Z + Math.sin(angle) * reach,
                ),
                row,
            });
        }
    }

    return spots;
}

function proxyGeometry(kind: TreeSpot['kind']): BufferGeometry {
    if (kind === 'ashoka') {
        const column = new CylinderGeometry(0.7, 1.4, 10.5, 6).translate(0, 7.2, 0);
        return mergeAndDispose([
            column,
            new CylinderGeometry(0.18, 0.18, 2.4, 4).translate(0, 1.2, 0),
        ]);
    }

    const canopy = new SphereGeometry(4.6, 8, 5).scale(1, 0.48, 1).translate(0, 6.6, 0);
    return mergeAndDispose([canopy, new CylinderGeometry(0.32, 0.32, 5, 5).translate(0, 2.5, 0)]);
}

function planTrees(count: number, random: () => number): TreeSpot[] {
    const spots: TreeSpot[] = [];
    const nearGuardian = (x: number, z: number) =>
        Math.hypot(x - GUARDIAN_SPOT.x, z - GUARDIAN_SPOT.z) < GUARDIAN_SPOT.radius;

    for (let x = -SQUARE.width / 2 - 6; x <= SQUARE.width / 2 + 6; x += AVENUE_SPACING)
        spots.push({ x, z: AVENUE_SOUTH_Z, kind: 'ashoka' });

    for (const side of [-1, 1]) {
        for (let z = SQUARE_NORTH + 4; z <= SQUARE_SOUTH + 4; z += AVENUE_SPACING) {
            if (!nearGuardian(side * AVENUE_SIDE_X, z))
                spots.push({ x: side * AVENUE_SIDE_X, z, kind: 'ashoka' });
        }
    }

    const isClear = (x: number, z: number) => {
        const inSquare =
            Math.abs(x) < AVENUE_SIDE_X + 6 && z > SQUARE_NORTH - 16 && z < AVENUE_SOUTH_Z + 6;
        const inBuilding = Math.abs(x) < 100 && z > BUILDING_Z - 14 && z < BUILDING_Z + 16;
        return !inSquare && !inBuilding && !nearGuardian(x, z);
    };

    const scattered = Math.max(count - spots.length, 12);
    let placed = 0;

    while (placed < scattered) {
        const x = (random() - 0.5) * 520;
        const z = -230 + random() * 330;
        if (!isClear(x, z)) continue;

        spots.push({ x, z, kind: random() < 0.78 ? 'rain' : 'ashoka' });
        placed += 1;
    }

    return spots;
}

function swag(from: Point3, to: Point3, sag: number, t: number, out: Vector3): Vector3 {
    return out.set(
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t - Math.sin(t * Math.PI) * sag,
        from[2] + (to[2] - from[2]) * t,
    );
}

function garlandGeometry(spans: [Point3, Point3, number][]): BufferGeometry {
    const beads: BufferGeometry[] = [];
    const point = new Vector3();

    for (const [from, to, sag] of spans) {
        const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        const count = Math.ceil(length / 0.13);

        for (let bead = 0; bead <= count; bead += 1) {
            swag(from, to, sag, bead / count, point);
            const flower = new IcosahedronGeometry(0.085, 0).translate(point.x, point.y, point.z);
            beads.push(paintGeometry(flower, MARIGOLD[bead % MARIGOLD.length]));
        }
    }

    return mergeAndDispose(beads);
}

function buntingGeometry(spans: [Point3, Point3][]): BufferGeometry {
    const pennants: BufferGeometry[] = [];
    const point = new Vector3();

    for (const [from, to] of spans) {
        const length = Math.hypot(to[0] - from[0], to[2] - from[2]);
        const count = Math.floor(length / 0.62);
        const direction = new Vector3(to[0] - from[0], 0, to[2] - from[2]).normalize();

        for (let index = 1; index < count; index += 1) {
            swag(from, to, 0.7, index / count, point);
            const geometry = new BufferGeometry();
            const half = direction.clone().multiplyScalar(0.2);
            const vertices = [
                point.x - half.x,
                point.y,
                point.z - half.z,
                point.x + half.x,
                point.y,
                point.z + half.z,
                point.x,
                point.y - 0.48,
                point.z,
            ];

            geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
            geometry.computeVertexNormals();
            pennants.push(paintGeometry(geometry, PENNANTS[index % PENNANTS.length]));
        }

        const cord = new CylinderGeometry(0.012, 0.012, length, 3);
        cord.rotateZ(Math.PI / 2);
        cord.rotateY(-Math.atan2(to[2] - from[2], to[0] - from[0]));
        swag(from, to, 0.35, 0.5, point);
        pennants.push(paintGeometry(cord.translate(point.x, point.y, point.z), 0xdedbd2));
    }

    return mergeAndDispose(pennants);
}

function dressingGeometry(random: () => number): BufferGeometry {
    const parts: BufferGeometry[] = [];
    const add = (geometry: BufferGeometry, color: number, [x, y, z]: Point3) =>
        parts.push(paintGeometry(geometry.translate(x, y, z), color));
    const planter = (x: number, z: number, scale: number) => {
        add(new CylinderGeometry(0.34 * scale, 0.25 * scale, 0.55 * scale, 10), TERRACOTTA, [
            x,
            0.275 * scale,
            z,
        ]);
        add(new SphereGeometry(0.36 * scale, 8, 5).scale(1, 0.55, 1), LEAF, [x, 0.6 * scale, z]);
        for (let bloom = 0; bloom < 5; bloom += 1) {
            const angle = (bloom / 5) * Math.PI * 2 + random();
            add(new IcosahedronGeometry(0.13 * scale, 0), MARIGOLD[bloom % MARIGOLD.length], [
                x + Math.cos(angle) * 0.2 * scale,
                0.7 * scale + random() * 0.06,
                z + Math.sin(angle) * 0.2 * scale,
            ]);
        }
    };

    for (let x = -5.6; x <= 5.6; x += 0.9) {
        if (Math.abs(x) < 2.6) continue;
        planter(x, DAIS.front + 0.45, 0.9);
    }
    for (const side of [-1, 1]) {
        planter(side * 2.75, DAIS.front + 1.55, 1.25);
        planter(side * 7.2, DAIS.front + 0.6, 1.25);
    }

    for (const side of [-1, 1]) {
        for (let start = 6; start < SQUARE.width / 2 + 2; start += 13) {
            add(new RoundedBoxGeometry(11.5, 0.95, 1.1, 2, 0.32), HEDGE, [
                side * (start + 5.75),
                0.475,
                SQUARE_SOUTH + 6.5,
            ]);
            add(new RoundedBoxGeometry(11.3, 0.12, 0.9, 1, 0.05), HEDGE_TOP, [
                side * (start + 5.75),
                0.96,
                SQUARE_SOUTH + 6.5,
            ]);
        }
        for (let start = SQUARE_NORTH + 22; start < SQUARE_SOUTH; start += 13) {
            add(new RoundedBoxGeometry(1.1, 0.95, 11.5, 2, 0.32), HEDGE, [
                side * (SQUARE.width / 2 + 6.5),
                0.475,
                start + 5.75,
            ]);
        }
    }

    add(new RoundedBoxGeometry(0.78, 1.12, 0.5, 2, 0.04), 0x6e1c27, [
        0,
        DAIS.height + 0.56,
        DAIS.front - 0.75,
    ]);
    add(new RoundedBoxGeometry(0.9, 0.08, 0.6, 1, 0.02), 0xf4efe6, [
        0,
        DAIS.height + 1.14,
        DAIS.front - 0.78,
    ]);

    return mergeAndDispose(parts);
}

export function buildGarden(input: GardenInput): ParadeGarden {
    const trash: Disposable[] = [];
    const keep = <Item extends Disposable>(item: Item): Item => {
        trash.push(item);
        return item;
    };
    const group = new Group();
    const treeSpots = planTrees(input.trees, input.random);
    const time = { value: 0 };
    const treeMaterial = keep(foliageMaterial(time, null));
    const leafMaterial = keep(foliageMaterial(time, input.leafTextures.cluster));
    const leafCanopies: InstancedMesh[] = [];
    const leafDensity = Math.min(1, input.trees / FULL_TREE_BUDGET);
    const matrix = new Matrix4();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const position = new Vector3();
    const yAxis = new Vector3(0, 1, 0);
    const shadowCasters: InstancedMesh[] = [];
    const variants: [TreeSpot['kind'], number][] = [
        ['ashoka', 101],
        ['ashoka', 211],
        ['rain', 11],
        ['rain', 23],
        ['rain', 37],
    ];

    for (const kind of ['ashoka', 'rain'] as const) {
        const seeds = variants.filter(([variantKind]) => variantKind === kind);
        const proxy = keep(proxyGeometry(kind));

        seeds.forEach(([, seed], variant) => {
            const spots = treeSpots.filter(
                (spot, index) => spot.kind === kind && index % seeds.length === variant,
            );
            if (spots.length === 0) return;

            const parts =
                kind === 'ashoka' ? ashokaTree(seed, leafDensity) : rainTree(seed, leafDensity);
            const trees = new InstancedMesh(keep(parts.solid), treeMaterial, spots.length);
            const canopy = new InstancedMesh(keep(parts.leaves), leafMaterial, spots.length);
            const shadows = new InstancedMesh(proxy, SHADOW_PROXY_MATERIAL, spots.length);

            spots.forEach(({ x, z }, index) => {
                const size =
                    kind === 'ashoka' ? 0.9 + input.random() * 0.25 : 0.85 + input.random() * 0.6;
                rotation.setFromAxisAngle(yAxis, input.random() * Math.PI * 2);
                matrix.compose(
                    position.set(x, 0, z),
                    rotation,
                    scale.set(size, size * (0.92 + input.random() * 0.2), size),
                );
                trees.setMatrixAt(index, matrix);
                canopy.setMatrixAt(index, matrix);
                shadows.setMatrixAt(index, matrix);
            });

            for (const mesh of [trees, canopy]) {
                mesh.receiveShadow = true;
                mesh.layers.set(input.detailLayer);
            }
            shadows.castShadow = true;
            shadows.layers.set(input.shadowLayer);
            group.add(trees, canopy, shadows);
            shadowCasters.push(shadows);
            leafCanopies.push(canopy);
            trash.push(trees, canopy, shadows);
        });
    }

    const woodsRows = Math.max(1, Math.floor((WOODS.maxRows * input.trees) / FULL_TREE_BUDGET));
    const woodsSpots = planWoods(woodsRows, input.random);
    const woods = WOODS_VARIANTS.map((seed, variant) => {
        const spots = woodsSpots.filter((_, index) => index % WOODS_VARIANTS.length === variant);
        const mesh = new InstancedMesh(keep(woodsGeometry(seed)), treeMaterial, spots.length);

        spots.forEach(({ position: spot, row }, index) => {
            const size = 1.4 + row * 0.3 + input.random() * 1.2;
            rotation.setFromAxisAngle(yAxis, input.random() * Math.PI * 2);
            matrix.compose(
                spot,
                rotation,
                scale.set(size, size * (0.8 + input.random() * 0.5), size),
            );
            mesh.setMatrixAt(index, matrix);
        });

        group.add(mesh);
        trash.push(mesh);

        return mesh;
    });

    const solidMaterial = keep(new MeshLambertMaterial({ vertexColors: true }));
    const dressing = new Mesh(keep(dressingGeometry(input.random)), solidMaterial);
    dressing.castShadow = true;
    dressing.receiveShadow = true;

    const canopyFront = DAIS_CENTER_Z + 3.72;
    const canopyY = DAIS.height + 4.02;
    const garlandSpans: [Point3, Point3, number][] = [];
    for (let swagIndex = 0; swagIndex < 4; swagIndex += 1) {
        const left = -6.6 + swagIndex * 3.3;
        garlandSpans.push([[left, canopyY, canopyFront], [left + 3.3, canopyY, canopyFront], 0.55]);
    }
    for (const x of [-6.2, 6.2]) {
        garlandSpans.push([
            [x, DAIS.height + 3.9, DAIS.front - 0.22],
            [x, DAIS.height + 0.4, DAIS.front - 0.22],
            0,
        ]);
    }
    garlandSpans.push([
        [-6, DAIS.height + 0.72, DAIS.front + 0.02],
        [-2.3, DAIS.height + 0.72, DAIS.front + 0.02],
        0.3,
    ]);
    garlandSpans.push([
        [2.3, DAIS.height + 0.72, DAIS.front + 0.02],
        [6, DAIS.height + 0.72, DAIS.front + 0.02],
        0.3,
    ]);
    const garlands = new Mesh(keep(garlandGeometry(garlandSpans)), solidMaterial);

    const buntingSpans: [Point3, Point3][] = [];
    for (let x = -75; x < 75; x += 15)
        buntingSpans.push([
            [x, 6.4, SQUARE_SOUTH + 2.5],
            [x + 15, 6.4, SQUARE_SOUTH + 2.5],
        ]);
    for (const side of [-1, 1]) {
        for (let z = -50; z < 10; z += 15)
            buntingSpans.push([
                [side * (SQUARE.width / 2 + 3), 6.4, z],
                [side * (SQUARE.width / 2 + 3), 6.4, z + 15],
            ]);
    }
    const bunting = new Mesh(
        keep(buntingGeometry(buntingSpans)),
        keep(new MeshLambertMaterial({ vertexColors: true, side: DoubleSide })),
    );
    bunting.castShadow = true;

    group.add(dressing, garlands, bunting);

    const dustPositions = new Float32Array(DUST_COUNT * 3);
    const dustSeeds = new Float32Array(DUST_COUNT);
    for (let index = 0; index < DUST_COUNT; index += 1) {
        dustPositions.set(
            [
                DUST_BOUNDS.minX + input.random() * (DUST_BOUNDS.maxX - DUST_BOUNDS.minX),
                DUST_BOUNDS.minY +
                    Math.pow(input.random(), 1.6) * (DUST_BOUNDS.maxY - DUST_BOUNDS.minY),
                DUST_BOUNDS.minZ + input.random() * (DUST_BOUNDS.maxZ - DUST_BOUNDS.minZ),
            ],
            index * 3,
        );
        dustSeeds[index] = input.random();
    }
    const dustGeometry = keep(new BufferGeometry());
    dustGeometry.setAttribute('position', new BufferAttribute(dustPositions, 3));
    dustGeometry.setAttribute('aSeed', new BufferAttribute(dustSeeds, 1));
    const dust = new Points(
        dustGeometry,
        keep(
            new ShaderMaterial({
                transparent: true,
                depthWrite: false,
                blending: AdditiveBlending,
                uniforms: { uTime: time, uScale: { value: 1000 }, uOpacity: { value: 0.55 } },
                vertexShader: DUST_VERTEX,
                fragmentShader: DUST_FRAGMENT,
            }),
        ),
    );
    dust.frustumCulled = false;
    dust.renderOrder = 2;
    group.add(dust);

    const fallingLeaves = buildFallingLeaves(
        treeSpots,
        input.leafTextures.single,
        time,
        input.random,
    );
    group.add(fallingLeaves);
    trash.push(fallingLeaves.geometry, fallingLeaves.material);

    return {
        group,
        shadowCasters,
        treeSpots,
        woods,
        leafCanopies,
        fallingLeaves,
        dust,
        time,
        dispose: () => {
            for (const item of trash) item.dispose();
        },
    };
}
