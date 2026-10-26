import {
    AdditiveBlending,
    BackSide,
    BufferAttribute,
    BufferGeometry,
    CircleGeometry,
    Color,
    CylinderGeometry,
    DynamicDrawUsage,
    Euler,
    ExtrudeGeometry,
    Group,
    InstancedMesh,
    LatheGeometry,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshLambertMaterial,
    MeshStandardMaterial,
    PlaneGeometry,
    PMREMGenerator,
    Points,
    PointsMaterial,
    Quaternion,
    Scene,
    ShaderMaterial,
    Shape,
    SphereGeometry,
    Vector2,
    Vector3,
    type ColorRepresentation,
    type Texture,
    type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
    canvasTexture,
    mergeAndDispose,
    paintGeometry,
    seededRandom,
} from '@/components/scenes/geometry';
import type { Point3 } from '@/components/scenes/seatLayout';

type SkyPalette = { top: Color; horizon: Color; bottom: Color };

type SmokeColor = 'saffron' | 'white' | 'green';

type FormationPlan = {
    from: Point3;
    to: Point3;
    duration: number;
    pause: number;
    offset: number;
    scale: number;
    rate: number;
};

export type StirUniforms = {
    origin: { value: Vector3 };
    direction: { value: Vector3 };
    strength: { value: number };
};

export type ParadeSky = {
    group: Group;
    sky: Mesh<SphereGeometry, ShaderMaterial>;
    stars: Points<BufferGeometry, PointsMaterial>;
    clouds: InstancedMesh<PlaneGeometry, MeshBasicMaterial>;
    farGround: Mesh<PlaneGeometry, MeshLambertMaterial>;
    formations: Formation[];
    dayFlypast: Formation;
    stir: StirUniforms;
    dayEnvironment: Texture;
    nightEnvironment: Texture;
    dispose: () => void;
};

export const SUN_DIRECTION = new Vector3(0.8, 0.3, 0.52).normalize();

export const SKY_PALETTES: Record<'day' | 'night', SkyPalette> = {
    day: { top: new Color(0x9fbfe0), horizon: new Color(0xf6eee2), bottom: new Color(0xeee6d8) },
    night: { top: new Color(0x01030a), horizon: new Color(0x0f121a), bottom: new Color(0x05060a) },
};

export const FAR_GROUND_COLORS = { day: new Color(0xdfe2cf), night: new Color(0x0d0f12) };

const SKY_VERTEX = `
    varying vec3 vDirection;
    void main() {
        vDirection = normalize(position);
        vec4 projected = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = projected.xyww;
    }`;

const SKY_FRAGMENT = `
    uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
    uniform vec3 uSunDirection; uniform vec3 uSunColor; uniform float uSunStrength;
    uniform vec3 uGlowColor; uniform float uGlow;
    varying vec3 vDirection;
    void main() {
        vec3 direction = normalize(vDirection);
        float h = direction.y;
        vec3 color = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.45)) : mix(uHorizon, uBottom, clamp(-h * 5.0, 0.0, 1.0));
        float sun = max(dot(direction, uSunDirection), 0.0);
        color += uSunColor * uSunStrength * (pow(sun, 6.0) * 0.3 + pow(sun, 900.0) * 6.0);
        color += uGlowColor * uGlow * exp(-abs(h - 0.01) * 38.0) * 0.6;
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
    }`;

const STIR_RADIUS = 26;

export const SMOKE_LIFE_SECONDS = 10;

const SMOKE_COLORS: Record<SmokeColor, Color> = {
    saffron: new Color(0xff9933),
    white: new Color(0xf6f7f9),
    green: new Color(0x22a51c),
};

const FORMATION_SLOTS: { x: number; z: number; smoke: SmokeColor }[] = [
    { x: 0, z: 0, smoke: 'white' },
    { x: -7, z: -6, smoke: 'saffron' },
    { x: 7, z: -6, smoke: 'green' },
    { x: -14, z: -12, smoke: 'saffron' },
    { x: 0, z: -12, smoke: 'white' },
    { x: 14, z: -12, smoke: 'green' },
    { x: -21, z: -18, smoke: 'saffron' },
    { x: 21, z: -18, smoke: 'green' },
    { x: 0, z: -24, smoke: 'white' },
];

const JET_POINTS: Record<'leftWingTip' | 'rightWingTip' | 'finTip' | 'tail', Point3> = {
    leftWingTip: [-3.9, 0, -1.7],
    rightWingTip: [3.9, 0, -1.7],
    finTip: [0, 2.3, -4.45],
    tail: [0, 0, -4.7],
};

const FORMATION_PLANS: FormationPlan[] = [
    {
        from: [170, 150, -30],
        to: [-70, 372, -240],
        duration: 15,
        pause: 1,
        offset: 6,
        scale: 1.4,
        rate: 150,
    },
    {
        from: [270, 135, -230],
        to: [300, 182, 290],
        duration: 14,
        pause: 3,
        offset: 0,
        scale: 1.4,
        rate: 140,
    },
];

export const DAY_FLYPAST_PLAN: FormationPlan = {
    from: [80, 80, -460],
    to: [-60, 40, 200],
    duration: 9,
    pause: 1e6,
    offset: 0,
    scale: 1.2,
    rate: 120,
};

const STAR_COUNT = 2200;

const CLOUD_COUNT = 140;

const SMOKE_VERTEX = `
    uniform float uTime; uniform float uLife; uniform float uScale;
    uniform vec3 uStirOrigin; uniform vec3 uStirDirection; uniform float uStirStrength;
    attribute float aBirth; attribute float aSeed; attribute vec3 aColor;
    varying vec3 vColor; varying float vAlpha;
    void main() {
        float age = uTime - aBirth;
        float t = clamp(age / uLife, 0.0, 1.0);
        vec3 drift = vec3(sin(age * 0.6 + aSeed * 6.28) * 0.9 * t, t * t * 3.0, cos(age * 0.45 + aSeed * 3.1) * 0.9 * t);
        vec3 world = position + drift;
        vec3 fromRay = world - uStirOrigin;
        vec3 across = fromRay - uStirDirection * dot(fromRay, uStirDirection);
        float gap = length(across);
        float influence = smoothstep(${STIR_RADIUS.toFixed(1)}, 0.0, gap) * uStirStrength * smoothstep(0.0, 0.12, t);
        vec3 away = across / max(gap, 0.001);
        world += (away + cross(uStirDirection, away) * 0.55) * influence * ${(STIR_RADIUS * 0.6).toFixed(1)};
        vec4 viewPosition = modelViewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        float size = mix(0.9, 4.6, sqrt(t)) * (0.8 + aSeed * 0.4);
        gl_PointSize = min(size * uScale / -viewPosition.z, 256.0);
        vAlpha = (age < 0.0 || age > uLife) ? 0.0 : (1.0 - t) * smoothstep(0.0, 0.03, t);
        vColor = aColor;
    }`;

const SMOKE_FRAGMENT = `
    uniform float uOpacity;
    varying vec3 vColor; varying float vAlpha;
    void main() {
        vec2 offset = gl_PointCoord - 0.5;
        float distance = length(offset);
        if (distance > 0.5) discard;
        float softness = smoothstep(0.5, 0.05, distance);
        vec3 color = mix(vColor * 0.7, vColor, softness);
        gl_FragColor = vec4(color, softness * vAlpha * uOpacity * 0.55);
        #include <colorspace_fragment>
    }`;

const CLOUD_BILLBOARD = `
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mvPosition.xy += position.xy * vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
    gl_Position = projectionMatrix * mvPosition;`;

function skyMaterial(palette: SkyPalette, sunStrength: number): ShaderMaterial {
    return new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
            uTop: { value: palette.top.clone() },
            uHorizon: { value: palette.horizon.clone() },
            uBottom: { value: palette.bottom.clone() },
            uSunDirection: { value: SUN_DIRECTION.clone() },
            uSunColor: { value: new Color(0xffe0b4) },
            uSunStrength: { value: sunStrength },
            uGlowColor: { value: new Color(0x9aa1ad) },
            uGlow: { value: 0 },
        },
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
    });
}

function planform(points: [number, number][], thickness: number): BufferGeometry {
    const shape = new Shape(points.map(([x, z]) => new Vector2(x, -z)));
    const geometry = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });

    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -thickness / 2, 0);

    return geometry;
}

function verticalFin(points: [number, number][], thickness: number): BufferGeometry {
    const shape = new Shape(points.map(([z, y]) => new Vector2(z, y)));
    const geometry = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });

    geometry.rotateY(-Math.PI / 2);
    geometry.translate(thickness / 2, 0, 0);

    return geometry;
}

function buildStars(random: () => number): Points<BufferGeometry, PointsMaterial> {
    const positions = new Float32Array(STAR_COUNT * 3);

    for (let index = 0; index < STAR_COUNT; index += 1) {
        const theta = random() * Math.PI * 2;
        const phi = Math.acos(0.08 + random() * 0.92);
        positions.set(
            [
                Math.sin(phi) * Math.cos(theta) * 3000,
                Math.cos(phi) * 3000,
                Math.sin(phi) * Math.sin(theta) * 3000,
            ],
            index * 3,
        );
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));

    return new Points(
        geometry,
        new PointsMaterial({
            color: 0xffffff,
            size: 1.3,
            sizeAttenuation: false,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            fog: false,
        }),
    );
}

function buildClouds(random: () => number): InstancedMesh<PlaneGeometry, MeshBasicMaterial> {
    const texture = canvasTexture(256, 256, (context) => {
        for (let index = 0; index < 40; index += 1) {
            const x = 40 + random() * 176;
            const y = 100 + random() * 60;
            const radius = 18 + random() * 46;
            const gradient = context.createRadialGradient(x, y, 0, x, y, radius);

            gradient.addColorStop(0, 'rgba(255,255,255,0.42)');
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            context.fillStyle = gradient;
            context.beginPath();
            context.arc(x, y, radius, 0, Math.PI * 2);
            context.fill();
        }
    });
    const material = new MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: 0.8,
    });

    material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            CLOUD_BILLBOARD,
        );
    };

    const clouds = new InstancedMesh(new PlaneGeometry(1, 1), material, CLOUD_COUNT);
    const matrix = new Matrix4();

    for (let index = 0; index < CLOUD_COUNT; index += 1) {
        const scale = 50 + random() * 120;

        matrix.makeScale(scale, scale * 0.42, 1);
        matrix.setPosition((random() - 0.5) * 1500, 38 + random() * 40, -900 + random() * 1100);
        clouds.setMatrixAt(index, matrix);
    }

    clouds.frustumCulled = false;

    return clouds;
}

export function buildJetGeometry(
    body: ColorRepresentation,
    dark: ColorRepresentation,
): BufferGeometry {
    const profile = [
        [0, -4.4],
        [0.3, -4.25],
        [0.46, -3.6],
        [0.56, -2.2],
        [0.62, -0.6],
        [0.6, 0.8],
        [0.52, 2.2],
        [0.36, 3.4],
        [0.16, 4.3],
        [0, 4.9],
    ].map(([radius, y]) => new Vector2(radius, y));
    const fuselage = new LatheGeometry(profile, 18).rotateX(Math.PI / 2);
    const canopy = new SphereGeometry(0.5, 18, 12).scale(0.74, 0.66, 2.1).translate(0, 0.4, 1.7);
    const wing: [number, number][] = [
        [0.45, 0.9],
        [3.9, -1.4],
        [3.9, -2.0],
        [0.45, -2.3],
    ];
    const tail: [number, number][] = [
        [0.35, -3.1],
        [1.9, -3.9],
        [1.9, -4.3],
        [0.35, -4.25],
    ];
    const mirror = (points: [number, number][]) =>
        points.map(([x, z]): [number, number] => [-x, z]);
    const exhaust = new CylinderGeometry(0.26, 0.3, 0.3, 14)
        .rotateX(Math.PI / 2)
        .translate(0, 0, -4.38);

    return mergeAndDispose([
        paintGeometry(fuselage, body),
        paintGeometry(canopy, dark),
        paintGeometry(planform(wing, 0.14), body),
        paintGeometry(planform(mirror(wing), 0.14), body),
        paintGeometry(planform(tail, 0.08), body),
        paintGeometry(planform(mirror(tail), 0.08), body),
        paintGeometry(
            verticalFin(
                [
                    [-2.7, 0.45],
                    [-3.95, 2.3],
                    [-4.45, 2.3],
                    [-4.3, 0.45],
                ],
                0.1,
            ),
            body,
        ),
        paintGeometry(exhaust, dark),
    ]);
}

export class Smoke {
    readonly points: Points<BufferGeometry, ShaderMaterial>;
    private readonly capacity: number;
    private readonly positions: Float32Array;
    private readonly births: Float32Array;
    private readonly seeds: Float32Array;
    private readonly colors: Float32Array;
    private readonly attributes: BufferAttribute[];
    private cursor = 0;
    private flushed = 0;

    constructor(capacity: number, stir: StirUniforms) {
        this.capacity = capacity;
        this.positions = new Float32Array(capacity * 3);
        this.births = new Float32Array(capacity).fill(-1e5);
        this.seeds = new Float32Array(capacity);
        this.colors = new Float32Array(capacity * 3);

        const geometry = new BufferGeometry();
        const named: [string, BufferAttribute][] = [
            ['position', new BufferAttribute(this.positions, 3)],
            ['aBirth', new BufferAttribute(this.births, 1)],
            ['aSeed', new BufferAttribute(this.seeds, 1)],
            ['aColor', new BufferAttribute(this.colors, 3)],
        ];

        for (const [name, attribute] of named) {
            attribute.setUsage(DynamicDrawUsage);
            geometry.setAttribute(name, attribute);
        }

        this.attributes = named.map(([, attribute]) => attribute);
        this.points = new Points(
            geometry,
            new ShaderMaterial({
                transparent: true,
                depthWrite: false,
                uniforms: {
                    uTime: { value: 0 },
                    uLife: { value: SMOKE_LIFE_SECONDS },
                    uScale: { value: 1 },
                    uOpacity: { value: 1 },
                    uStirOrigin: stir.origin,
                    uStirDirection: stir.direction,
                    uStirStrength: stir.strength,
                },
                vertexShader: SMOKE_VERTEX,
                fragmentShader: SMOKE_FRAGMENT,
            }),
        );
        this.points.frustumCulled = false;
    }

    emit(position: Vector3, color: Color, time: number): void {
        const index = this.cursor;
        this.cursor = (this.cursor + 1) % this.capacity;

        this.positions[index * 3] = position.x + (Math.random() - 0.5) * 0.4;
        this.positions[index * 3 + 1] = position.y + (Math.random() - 0.5) * 0.4;
        this.positions[index * 3 + 2] = position.z + (Math.random() - 0.5) * 0.4;
        this.births[index] = time;
        this.seeds[index] = Math.random();
        this.colors[index * 3] = color.r;
        this.colors[index * 3 + 1] = color.g;
        this.colors[index * 3 + 2] = color.b;
    }

    flush(time: number): void {
        this.points.material.uniforms.uTime.value = time;

        const written = (this.cursor - this.flushed + this.capacity) % this.capacity;
        if (written === 0) return;

        const ranges =
            this.flushed + written <= this.capacity
                ? [[this.flushed, written]]
                : [
                      [this.flushed, this.capacity - this.flushed],
                      [0, this.cursor],
                  ];

        for (const attribute of this.attributes) {
            attribute.clearUpdateRanges();
            for (const [start, count] of ranges)
                attribute.addUpdateRange(start * attribute.itemSize, count * attribute.itemSize);
            attribute.needsUpdate = true;
        }

        this.flushed = this.cursor;
    }

    dispose(): void {
        this.points.geometry.dispose();
        this.points.material.dispose();
    }
}

export class Formation {
    readonly group = new Group();
    readonly smoke: Smoke;
    private readonly plan: FormationPlan;
    private readonly from: Vector3;
    private readonly to: Vector3;
    private readonly cycle: number;
    private readonly heading: Quaternion;
    private readonly jets: InstancedMesh;
    private readonly lights: Points<BufferGeometry, PointsMaterial>;
    private readonly lightPositions: Float32Array;
    private readonly lightColors: Float32Array;
    private readonly matrix = new Matrix4();
    readonly lead = new Vector3();
    private readonly slot = new Vector3();
    private readonly local = new Vector3();
    private readonly wobble = new Quaternion();
    private readonly euler = new Euler();
    private readonly size: Vector3;
    private carry = 0;

    constructor(
        plan: FormationPlan,
        jetGeometry: BufferGeometry,
        jetMaterial: MeshStandardMaterial,
        stir: StirUniforms,
    ) {
        this.plan = plan;
        this.from = new Vector3(...plan.from);
        this.to = new Vector3(...plan.to);
        this.cycle = plan.duration + plan.pause;
        const direction = new Vector3().subVectors(this.to, this.from);
        this.heading = new Quaternion().setFromUnitVectors(
            new Vector3(0, 0, 1),
            direction.normalize(),
        );
        this.size = new Vector3(plan.scale, plan.scale, plan.scale);
        this.jets = new InstancedMesh(jetGeometry, jetMaterial, FORMATION_SLOTS.length);
        this.jets.frustumCulled = false;
        this.smoke = new Smoke(
            Math.ceil(plan.rate * FORMATION_SLOTS.length * SMOKE_LIFE_SECONDS * 1.15),
            stir,
        );
        this.lightPositions = new Float32Array(FORMATION_SLOTS.length * 9);
        this.lightColors = new Float32Array(FORMATION_SLOTS.length * 9);

        const lightGeometry = new BufferGeometry();
        lightGeometry.setAttribute(
            'position',
            new BufferAttribute(this.lightPositions, 3).setUsage(DynamicDrawUsage),
        );
        lightGeometry.setAttribute(
            'color',
            new BufferAttribute(this.lightColors, 3).setUsage(DynamicDrawUsage),
        );

        this.lights = new Points(
            lightGeometry,
            new PointsMaterial({
                size: 2.4,
                vertexColors: true,
                transparent: true,
                depthWrite: false,
                blending: AdditiveBlending,
            }),
        );
        this.lights.frustumCulled = false;
        this.group.add(this.jets, this.smoke.points, this.lights);
    }

    setPointScale(scale: number): void {
        this.smoke.points.material.uniforms.uScale.value = scale;
    }

    update(time: number, delta: number, glow: number): void {
        const local = (time + this.plan.offset) % this.cycle;
        const isFlying = local < this.plan.duration;

        this.jets.visible = isFlying;
        this.lights.visible = isFlying;
        this.lead.lerpVectors(this.from, this.to, Math.min(local / this.plan.duration, 1));
        this.lead.y += Math.sin(time * 0.7) * 1.2;
        this.carry += isFlying ? delta * this.plan.rate : 0;

        const emitCount = Math.floor(this.carry);
        this.carry -= emitCount;

        const strobe = (time * 0.9) % 1 < 0.06 ? 6 : 0;

        FORMATION_SLOTS.forEach((slot, index) => {
            const scale = this.plan.scale;

            this.slot.set(slot.x * scale, -Math.abs(slot.z) * 0.06, slot.z * scale);
            this.slot.applyQuaternion(this.heading).add(this.lead);
            this.euler.set(
                Math.sin(time * 1.3 + index) * 0.02,
                0,
                Math.sin(time * 0.9 + index * 1.7) * 0.05,
            );
            this.wobble.setFromEuler(this.euler).premultiply(this.heading);
            this.matrix.compose(this.slot, this.wobble, this.size);
            this.jets.setMatrixAt(index, this.matrix);
            this.writeLight(index * 3, JET_POINTS.leftWingTip, 4 * glow, 0.25 * glow, 0.2 * glow);
            this.writeLight(
                index * 3 + 1,
                JET_POINTS.rightWingTip,
                0.2 * glow,
                3.6 * glow,
                0.6 * glow,
            );
            this.writeLight(
                index * 3 + 2,
                JET_POINTS.finTip,
                strobe * glow,
                strobe * glow,
                strobe * glow,
            );

            if (!isFlying) return;

            this.place(JET_POINTS.tail);

            for (let count = 0; count < emitCount; count += 1) {
                this.smoke.emit(
                    this.local,
                    SMOKE_COLORS[slot.smoke],
                    time - (count / Math.max(emitCount, 1)) * delta,
                );
            }
        });

        this.jets.instanceMatrix.needsUpdate = true;
        this.lights.geometry.attributes.position.needsUpdate = true;
        this.lights.geometry.attributes.color.needsUpdate = true;
        this.smoke.flush(time);
    }

    dispose(): void {
        this.smoke.dispose();
        this.lights.geometry.dispose();
        this.lights.material.dispose();
        this.jets.dispose();
    }

    private place(point: Point3): Vector3 {
        this.local.set(...point).multiplyScalar(this.plan.scale);

        return this.local.applyQuaternion(this.wobble).add(this.slot);
    }

    private writeLight(
        index: number,
        point: Point3,
        red: number,
        green: number,
        blue: number,
    ): void {
        const offset = index * 3;

        this.place(point);
        this.lightPositions[offset] = this.local.x;
        this.lightPositions[offset + 1] = this.local.y;
        this.lightPositions[offset + 2] = this.local.z;
        this.lightColors[offset] = red;
        this.lightColors[offset + 1] = green;
        this.lightColors[offset + 2] = blue;
    }
}

export function buildSky(renderer: WebGLRenderer): ParadeSky {
    const random = seededRandom(20261114);
    const pmrem = new PMREMGenerator(renderer);
    const environmentScene = new Scene();
    const environmentSky = new Mesh(
        new SphereGeometry(50, 32, 16),
        skyMaterial(SKY_PALETTES.day, 1),
    );
    const environmentGround = new Mesh(
        new CircleGeometry(60, 32).rotateX(-Math.PI / 2).translate(0, -4, 0),
        new MeshBasicMaterial({ color: 0xd9d6c4 }),
    );
    environmentScene.add(environmentSky, environmentGround);

    const room = new RoomEnvironment();
    const dayTarget = pmrem.fromScene(environmentScene, 0.03);
    const nightTarget = pmrem.fromScene(room, 0.04);

    for (const mesh of [environmentSky, environmentGround]) {
        mesh.geometry.dispose();
        mesh.material.dispose();
    }
    room.dispose();
    pmrem.dispose();

    const sky = new Mesh(new SphereGeometry(4000, 32, 16), skyMaterial(SKY_PALETTES.night, 0));
    sky.renderOrder = 1;
    sky.frustumCulled = false;

    const stars = buildStars(random);
    const clouds = buildClouds(random);
    const farGround = new Mesh(
        new PlaneGeometry(12000, 12000),
        new MeshLambertMaterial({ color: FAR_GROUND_COLORS.day }),
    );
    farGround.rotation.x = -Math.PI / 2;
    farGround.position.y = -0.08;

    const stir: StirUniforms = {
        origin: { value: new Vector3() },
        direction: { value: new Vector3(0, 0, -1) },
        strength: { value: 0 },
    };
    const jetGeometry = buildJetGeometry(0xeef0f3, 0x0c0e12);
    const jetMaterial = new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.28,
        metalness: 0.4,
    });
    const formations = FORMATION_PLANS.map(
        (plan) => new Formation(plan, jetGeometry, jetMaterial, stir),
    );
    const dayFlypast = new Formation(DAY_FLYPAST_PLAN, jetGeometry, jetMaterial, stir);
    dayFlypast.group.visible = false;

    const group = new Group();
    group.add(
        sky,
        stars,
        clouds,
        farGround,
        dayFlypast.group,
        ...formations.map((formation) => formation.group),
    );

    return {
        group,
        sky,
        stars,
        clouds,
        farGround,
        formations,
        dayFlypast,
        stir,
        dayEnvironment: dayTarget.texture,
        nightEnvironment: nightTarget.texture,
        dispose: () => {
            for (const formation of [...formations, dayFlypast]) formation.dispose();
            for (const mesh of [sky, stars, clouds, farGround]) {
                mesh.geometry.dispose();
                mesh.material.dispose();
            }
            clouds.material.map?.dispose();
            clouds.dispose();
            jetGeometry.dispose();
            jetMaterial.dispose();
            dayTarget.dispose();
            nightTarget.dispose();
        },
    };
}
