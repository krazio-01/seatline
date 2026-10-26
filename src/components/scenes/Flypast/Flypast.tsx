'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    CircleGeometry,
    Color,
    CylinderGeometry,
    DoubleSide,
    DynamicDrawUsage,
    ExtrudeGeometry,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    LatheGeometry,
    Matrix4,
    MeshBasicMaterial,
    MeshPhysicalMaterial,
    MeshStandardMaterial,
    NormalBlending,
    PerspectiveCamera,
    Shape,
    ShaderMaterial,
    SphereGeometry,
    SplineCurve,
    SRGBColorSpace,
    Vector2,
    Vector3,
    type Group,
    type Mesh,
} from 'three';
import './flypast.scss';
import {
    markFlypastReady,
    resetFlypastReady,
    usePrefersReducedMotion,
} from '@/components/scenes/sceneSupport';
import { mergeAndDispose } from '@/components/scenes/geometry';
import { SceneCanvas, StudioEnvironment } from '@/components/scenes/SceneCanvas/SceneCanvas';
import {
    flightPointAt,
    orientStripeAxis,
    planFlight,
    SMOKE,
    SMOKE_STRIPES,
    type FlightPlan,
    type FlightPoint,
} from '@/components/scenes/flightPath';

type Flight = { plan: FlightPlan; start: number; next: number };

type Emission = { sinceLast: number; cursor: number; serial: number; frameSeconds: number };

type FlightState = { flight: Flight | null; bank: number; previousNozzles: Vector3[] | null };

const CAMERA_FOV = 30;
const JET_SCALE = 0.7;
const FIRST_FLIGHT_DELAY = 0.6;
const MAX_FRAME_SECONDS = 0.1;
const TANGENT_STEP = 0.004;
const SMOKE_CAPACITY = 1500;
const FULL_PUFF_SPACING = 0.07;
const LITE_PUFF_SPACING = 0.12;
const LITE_VIEWPORT_WIDTH = 700;
const LITE_FRAME_SECONDS = 0.022;
const SMOKE_DAMPING = 1.6;
const SMOKE_CURL = 0.12;
const SMOKE_EXHAUST_SPEED = 0.22;
const SMOKE_JITTER_SPEED = 0.16;
const BANK_RESPONSE = 3.5;
const BANK_STRENGTH = 9;
const MAX_BANK_TILT = 1.4;
const NOZZLE_OFFSETS = [0.2, -0.2];
const NOZZLE_X = -3.28;

const smokeVertexShader = `
attribute vec3 aOrigin;
attribute vec3 aSpread;
attribute vec3 aVelocity;
attribute vec3 aColor;
attribute vec2 aBirth;
uniform float uTime;
uniform float uLife;
uniform vec2 uRadius;
uniform float uJitter;
uniform float uStartSpread;
uniform float uDamping;
uniform float uCurl;
varying vec2 vCorner;
varying vec2 vNoiseCoord;
varying vec3 vColor;
varying float vAlpha;
varying float vSeed;
varying float vLife;
void main() {
    float age = uTime - aBirth.x;
    if (age < 0.0 || age > uLife) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }
    float life = age / uLife;
    float seed = aBirth.y;
    float grow = 1.0 - pow(1.0 - life, 2.6);
    float travel = (1.0 - exp(-uDamping * age)) / uDamping;
    vec3 curl = vec3(
        sin(age * 2.3 + seed * 31.0),
        sin(age * 1.7 + seed * 17.0),
        cos(age * 1.9 + seed * 23.0)
    ) * uCurl * life;
    vec3 center = aOrigin + aSpread * mix(uStartSpread, 1.0, grow) + aVelocity * travel + curl;
    float radius = mix(uRadius.x, uRadius.y, grow) * (1.0 + (seed - 0.5) * 2.0 * uJitter);
    float angle = seed * 6.2832 + age * (seed - 0.5) * 1.2;
    mat2 spin = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
    vec4 viewPosition = modelViewMatrix * vec4(center, 1.0);
    viewPosition.xy += position.xy * radius;
    gl_Position = projectionMatrix * viewPosition;
    vCorner = position.xy;
    vNoiseCoord = spin * position.xy;
    vColor = aColor;
    vSeed = seed;
    vLife = life;
    vAlpha = smoothstep(0.0, 0.02, life) * pow(1.0 - life, 1.3) * (0.8 + 0.4 * fract(seed * 13.7));
}`;

const smokeFragmentShader = `
uniform float uOpacity;
varying vec2 vCorner;
varying vec2 vNoiseCoord;
varying vec3 vColor;
varying float vAlpha;
varying float vSeed;
varying float vLife;
float hash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
}
float valueNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    vec2 blend = local * local * (3.0 - 2.0 * local);
    float bottom = mix(hash(cell), hash(cell + vec2(1.0, 0.0)), blend.x);
    float top = mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), blend.x);
    return mix(bottom, top, blend.y);
}
void main() {
    float distanceFromCenter = length(vCorner);
    if (distanceFromCenter > 1.0) discard;
    vec2 noiseCoord = vNoiseCoord + vSeed * 19.0;
    float cloud = valueNoise(noiseCoord * 2.1) * 0.6 + valueNoise(noiseCoord * 4.6) * 0.4;
    float falloff = smoothstep(1.0, 0.05, distanceFromCenter + (cloud - 0.5) * 0.35);
    float breakup = smoothstep(vLife * 0.75 - 0.15, vLife * 0.75 + 0.2, cloud);
    float density = falloff * mix(0.7, 1.0, cloud) * breakup;
    float isWhite = step(2.9, vColor.r + vColor.g + vColor.b);
    float light = 0.97 + 0.05 * (vCorner.y * 0.5 + 0.5);
    float rimShade = mix(0.76, 1.0, smoothstep(0.95, 0.2, distanceFromCenter));
    float underside = 0.93 + 0.07 * (vCorner.y * 0.5 + 0.5);
    vec3 whiteSmoke = vec3(rimShade * underside * mix(0.94, 1.0, cloud));
    vec3 color = mix(min(vColor * light, vec3(1.0)), whiteSmoke, isWhite);
    gl_FragColor = vec4(color, density * vAlpha * uOpacity);
}`;

const scratchVectors = {
    point: { x: 0, y: 0, depth: 0 } as FlightPoint,
    ahead: new Vector3(),
    behind: new Vector3(),
    forward: new Vector3(),
    previousForward: new Vector3(),
    nextForward: new Vector3(),
    turn: new Vector3(),
    right: new Vector3(),
    up: new Vector3(),
    side: new Vector3(),
    viewDirection: new Vector3(),
    stripeAxis: new Vector3(),
    emitPoint: new Vector3(),
    basis: new Matrix4(),
    worldUp: new Vector3(0, 1, 0),
};

const STRIPE_DISPLAY_COLORS = SMOKE_STRIPES.map((stripe) => {
    const displayColor = { r: 0, g: 0, b: 0 };

    new Color(stripe.color).getRGB(displayColor, SRGBColorSpace);

    return [displayColor.r, displayColor.g, displayColor.b];
});

const SMOKE_ATTRIBUTES = ['aOrigin', 'aSpread', 'aVelocity', 'aColor', 'aBirth'] as const;
const NOZZLE_LOCAL_POSITIONS = NOZZLE_OFFSETS.map((z) => new Vector3(NOZZLE_X, -0.02, z));

const WING = [
    [1.7, 0.3],
    [0.6, 0.62],
    [-1.15, 2.25],
    [-1.6, 2.25],
    [-1.95, 0.3],
] satisfies [number, number][];

const TAILPLANE = [
    [-2.1, 0.3],
    [-2.8, 1.25],
    [-3.05, 1.25],
    [-3.0, 0.3],
] satisfies [number, number][];

const FIN = [
    [-1.7, 0],
    [-2.5, 1.2],
    [-2.8, 1.2],
    [-2.95, 0],
] satisfies [number, number][];

function createShape(points: [number, number][]): Shape {
    const shape = new Shape();
    const [first, ...rest] = points;

    shape.moveTo(first[0], first[1]);

    for (const [x, y] of rest) shape.lineTo(x, y);

    shape.closePath();

    return shape;
}

function flatPanel(points: [number, number][], thickness: number): BufferGeometry {
    const bevel = thickness * 0.45;
    const panel = new ExtrudeGeometry(createShape(points), {
        depth: thickness,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 2,
        curveSegments: 1,
    });

    panel.translate(0, 0, -thickness / 2);

    return panel;
}

function mirrored(points: [number, number][]): [number, number][] {
    return points.map(([x, y]) => [x, -y]);
}

function createFuselage(): BufferGeometry {
    const profile = new SplineCurve([
        new Vector2(0.3, -3.0),
        new Vector2(0.4, -2.75),
        new Vector2(0.47, -2.2),
        new Vector2(0.5, -1.2),
        new Vector2(0.49, -0.2),
        new Vector2(0.44, 0.7),
        new Vector2(0.36, 1.4),
        new Vector2(0.25, 2.0),
        new Vector2(0.13, 2.55),
        new Vector2(0.04, 2.95),
        new Vector2(0, 3.05),
    ]);
    const outline = [new Vector2(0, -3.0), ...profile.getPoints(36)];
    const fuselage = new LatheGeometry(outline, 32);

    fuselage.rotateZ(-Math.PI / 2);
    fuselage.scale(1, 0.82, 1.12);

    return fuselage;
}

function createJetGeometries() {
    const wings = [WING, mirrored(WING)].map((outline) => {
        const wing = flatPanel(outline, 0.05);
        wing.rotateX(-Math.PI / 2);
        wing.translate(0, -0.06, 0);

        return wing;
    });

    const tailplanes = [TAILPLANE, mirrored(TAILPLANE)].map((outline) => {
        const tailplane = flatPanel(outline, 0.04);
        tailplane.rotateX(-Math.PI / 2);
        tailplane.translate(0, -0.04, 0);

        return tailplane;
    });

    const fins = [1, -1].map((side) => {
        const fin = flatPanel(FIN, 0.04);
        fin.rotateX(side * 0.38);
        fin.translate(0, 0.2, side * 0.28);

        return fin;
    });

    const intakes = [1, -1].map((side) => {
        const intake = new BoxGeometry(1.0, 0.3, 0.2);
        intake.translate(0.1, -0.1, side * 0.5);

        return intake;
    });

    const nozzles = NOZZLE_OFFSETS.map((z) => {
        const nozzle = new CylinderGeometry(0.15, 0.18, 0.36, 24, 1, true);
        nozzle.rotateZ(Math.PI / 2);
        nozzle.translate(NOZZLE_X + 0.18, -0.02, z);

        return nozzle;
    });

    const glows = NOZZLE_OFFSETS.map((z) => {
        const glow = new CircleGeometry(0.13, 24);
        glow.rotateY(-Math.PI / 2);
        glow.translate(NOZZLE_X + 0.04, -0.02, z);

        return glow;
    });

    const canopy = new SphereGeometry(1, 32, 16);
    canopy.scale(0.95, 0.3, 0.27);
    canopy.translate(1.05, 0.27, 0);

    return {
        body: mergeAndDispose([createFuselage(), ...wings, ...tailplanes, ...fins, ...intakes]),
        nozzles: mergeAndDispose(nozzles),
        glows: mergeAndDispose(glows),
        canopy,
    };
}

function createJetMaterials() {
    return {
        body: new MeshStandardMaterial({
            color: '#8a9099',
            metalness: 0.55,
            roughness: 0.34,
            envMapIntensity: 1.25,
        }),
        nozzle: new MeshStandardMaterial({
            color: '#4b4b52',
            metalness: 0.9,
            roughness: 0.28,
            side: DoubleSide,
        }),
        glow: new MeshBasicMaterial({
            color: '#ff8f3f',
            transparent: true,
            opacity: 0.8,
            toneMapped: false,
        }),
        canopy: new MeshPhysicalMaterial({
            color: '#1d2733',
            metalness: 0.15,
            roughness: 0.06,
            clearcoat: 1,
            clearcoatRoughness: 0.04,
            envMapIntensity: 1.6,
            transparent: true,
            opacity: 0.9,
        }),
    };
}

function createSmoke() {
    const geometry = new InstancedBufferGeometry();
    const corners = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);

    geometry.setAttribute('position', new BufferAttribute(corners, 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.instanceCount = SMOKE_CAPACITY;

    for (const name of SMOKE_ATTRIBUTES) {
        const itemSize = name === 'aBirth' ? 2 : 3;
        const values = new Float32Array(SMOKE_CAPACITY * itemSize);
        const attribute = new InstancedBufferAttribute(
            values.fill(name === 'aBirth' ? -1000 : 0),
            itemSize,
        );

        attribute.setUsage(DynamicDrawUsage);
        geometry.setAttribute(name, attribute);
    }

    const material = new ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uLife: { value: SMOKE.life },
            uRadius: { value: new Vector2(SMOKE.startRadius, SMOKE.endRadius) },
            uJitter: { value: SMOKE.sizeJitter },
            uStartSpread: { value: SMOKE.startSpread },
            uDamping: { value: SMOKE_DAMPING },
            uCurl: { value: SMOKE_CURL },
            uOpacity: { value: 0.7 },
        },
        vertexShader: smokeVertexShader,
        fragmentShader: smokeFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
        toneMapped: false,
    });

    return { geometry, material };
}

function placeOnScreen(
    plan: FlightPlan,
    progress: number,
    camera: PerspectiveCamera,
    target: Vector3,
): Vector3 {
    const point = flightPointAt(plan, Math.min(1, Math.max(0, progress)), scratchVectors.point);
    const tanVertical = Math.tan((camera.fov * Math.PI) / 360);

    target.set(
        point.x * point.depth * tanVertical * camera.aspect,
        point.y * point.depth * tanVertical,
        -point.depth,
    );

    return target.applyMatrix4(camera.matrixWorld);
}

function headingAt(plan: FlightPlan, progress: number, camera: PerspectiveCamera, target: Vector3) {
    placeOnScreen(plan, progress - TANGENT_STEP, camera, scratchVectors.behind);
    placeOnScreen(plan, progress + TANGENT_STEP, camera, scratchVectors.ahead);

    return target.subVectors(scratchVectors.ahead, scratchVectors.behind).normalize();
}

function startFlightIfDue(
    flightState: FlightState,
    emission: Emission,
    camera: PerspectiveCamera,
    aspect: number,
    time: number,
): Flight {
    if (flightState.flight && time <= flightState.flight.next) return flightState.flight;

    camera.updateMatrixWorld();

    const plan = planFlight(Math.random, { verticalFov: camera.fov, aspect });

    flightState.flight = { plan, start: time, next: time + plan.duration + plan.pause };
    flightState.bank = 0;
    flightState.previousNozzles = null;
    emission.sinceLast = 0;

    return flightState.flight;
}

function poseJet(
    jet: Group,
    flightState: FlightState,
    plan: FlightPlan,
    progress: number,
    camera: PerspectiveCamera,
    step: number,
): Vector3 {
    placeOnScreen(plan, progress, camera, jet.position);

    const forward = headingAt(plan, progress, camera, scratchVectors.forward);
    headingAt(plan, progress - TANGENT_STEP * 4, camera, scratchVectors.previousForward);
    headingAt(plan, progress + TANGENT_STEP * 4, camera, scratchVectors.nextForward);

    scratchVectors.right.crossVectors(forward, scratchVectors.worldUp).normalize();
    scratchVectors.up.crossVectors(scratchVectors.right, forward).normalize();

    const turn = scratchVectors.turn.subVectors(
        scratchVectors.nextForward,
        scratchVectors.previousForward,
    );
    const lateralTurn = turn.dot(scratchVectors.right);
    const desiredBank = Math.max(
        -MAX_BANK_TILT,
        Math.min(MAX_BANK_TILT, lateralTurn * BANK_STRENGTH),
    );

    flightState.bank += (desiredBank - flightState.bank) * (1 - Math.exp(-step * BANK_RESPONSE));

    scratchVectors.up.addScaledVector(scratchVectors.right, flightState.bank).normalize();
    scratchVectors.side.crossVectors(forward, scratchVectors.up);
    scratchVectors.basis.makeBasis(forward, scratchVectors.up, scratchVectors.side);
    jet.quaternion.setFromRotationMatrix(scratchVectors.basis);
    jet.updateMatrixWorld();

    return forward;
}

function emitSmoke({
    geometry,
    emission,
    previousNozzles,
    nozzleWorld,
    forward,
    stripeAxis,
    spacing,
    time,
    step,
}: {
    geometry: InstancedBufferGeometry;
    emission: Emission;
    previousNozzles: Vector3[];
    nozzleWorld: Vector3[];
    forward: Vector3;
    stripeAxis: Vector3;
    spacing: number;
    time: number;
    step: number;
}): { firstSlot: number; emitted: number } {
    const travel = previousNozzles[0].distanceTo(nozzleWorld[0]);
    const maxPuffs = Math.floor(SMOKE_CAPACITY / (SMOKE_STRIPES.length * 2));
    const firstSlot = emission.cursor;
    let emitted = 0;
    let distance = spacing - emission.sinceLast;

    const origin = geometry.getAttribute('aOrigin') as InstancedBufferAttribute;
    const spread = geometry.getAttribute('aSpread') as InstancedBufferAttribute;
    const velocity = geometry.getAttribute('aVelocity') as InstancedBufferAttribute;
    const color = geometry.getAttribute('aColor') as InstancedBufferAttribute;
    const birth = geometry.getAttribute('aBirth') as InstancedBufferAttribute;

    while (distance <= travel && emitted < maxPuffs * SMOKE_STRIPES.length) {
        const segmentFraction = travel > 0 ? distance / travel : 1;

        for (let stripe = 0; stripe < SMOKE_STRIPES.length; stripe += 1) {
            const slot = emission.cursor;
            const nozzle = (emission.serial + stripe) % NOZZLE_OFFSETS.length;
            const offset = SMOKE_STRIPES[stripe].offset;
            const seed = Math.random();
            const [red, green, blue] = STRIPE_DISPLAY_COLORS[stripe];
            const emitPoint = scratchVectors.emitPoint.lerpVectors(
                previousNozzles[nozzle],
                nozzleWorld[nozzle],
                segmentFraction,
            );

            origin.setXYZ(slot, emitPoint.x, emitPoint.y, emitPoint.z);
            spread.setXYZ(
                slot,
                stripeAxis.x * offset,
                stripeAxis.y * offset,
                stripeAxis.z * offset,
            );
            velocity.setXYZ(
                slot,
                -forward.x * SMOKE_EXHAUST_SPEED + (Math.random() - 0.5) * SMOKE_JITTER_SPEED,
                -forward.y * SMOKE_EXHAUST_SPEED + (Math.random() - 0.5) * SMOKE_JITTER_SPEED,
                -forward.z * SMOKE_EXHAUST_SPEED + (Math.random() - 0.5) * SMOKE_JITTER_SPEED,
            );
            color.setXYZ(slot, red, green, blue);
            birth.setXY(slot, time - (1 - segmentFraction) * step, seed);

            emission.cursor = (slot + 1) % SMOKE_CAPACITY;
            emitted += 1;
        }

        emission.serial += 1;
        distance += spacing;
    }

    emission.sinceLast = travel - (distance - spacing);

    return { firstSlot, emitted };
}

function flushSmokeRanges(geometry: InstancedBufferGeometry, firstSlot: number, emitted: number) {
    if (emitted === 0) return;

    const tailCount = Math.min(emitted, SMOKE_CAPACITY - firstSlot);
    const wrappedCount = emitted - tailCount;

    for (const name of SMOKE_ATTRIBUTES) {
        const attribute = geometry.getAttribute(name) as InstancedBufferAttribute;

        attribute.addUpdateRange(firstSlot * attribute.itemSize, tailCount * attribute.itemSize);

        if (wrappedCount > 0) attribute.addUpdateRange(0, wrappedCount * attribute.itemSize);

        attribute.needsUpdate = true;
    }
}

function JetAnimation() {
    const jetRef = useRef<Group>(null);
    const smokeRef = useRef<Mesh<InstancedBufferGeometry, ShaderMaterial>>(null);
    const elapsedRef = useRef(0);
    const flightStateRef = useRef<FlightState>({ flight: null, bank: 0, previousNozzles: null });
    const emissionRef = useRef<Emission>({
        sinceLast: 0,
        cursor: 0,
        serial: 0,
        frameSeconds: 1 / 60,
    });

    const jetGeometries = useMemo(() => createJetGeometries(), []);
    const jetMaterials = useMemo(() => createJetMaterials(), []);
    const smoke = useMemo(() => createSmoke(), []);
    const nozzleWorld = useMemo(() => NOZZLE_OFFSETS.map(() => new Vector3()), []);

    useEffect(
        () => () => {
            for (const geometry of Object.values(jetGeometries)) geometry.dispose();
            for (const material of Object.values(jetMaterials)) material.dispose();

            smoke.geometry.dispose();
            smoke.material.dispose();
        },
        [jetGeometries, jetMaterials, smoke],
    );

    useFrame((state, delta) => {
        const jet = jetRef.current;
        const smokeMesh = smokeRef.current;
        if (!jet || !smokeMesh) return;

        const step = Math.min(delta, MAX_FRAME_SECONDS);
        const emission = emissionRef.current;
        const flightState = flightStateRef.current;

        elapsedRef.current += step;
        emission.frameSeconds += (step - emission.frameSeconds) * 0.05;

        const time = elapsedRef.current;
        const camera = state.camera as PerspectiveCamera;

        smokeMesh.material.uniforms.uTime.value = time;

        if (time < FIRST_FLIGHT_DELAY) return;

        const aspect = state.size.width / Math.max(1, state.size.height);
        const { plan, start } = startFlightIfDue(flightState, emission, camera, aspect, time);
        const progress = (time - start) / plan.duration;

        jet.visible = progress < 1;

        if (!jet.visible) return;

        const forward = poseJet(jet, flightState, plan, progress, camera, step);

        for (let nozzle = 0; nozzle < NOZZLE_LOCAL_POSITIONS.length; nozzle += 1) {
            nozzleWorld[nozzle].copy(NOZZLE_LOCAL_POSITIONS[nozzle]).applyMatrix4(jet.matrixWorld);
        }

        scratchVectors.viewDirection.subVectors(jet.position, camera.position).normalize();

        const crossAxis = scratchVectors.stripeAxis.crossVectors(
            forward,
            scratchVectors.viewDirection,
        );
        const stripeAxis = orientStripeAxis(crossAxis.normalize());

        const previousNozzles =
            flightState.previousNozzles ?? nozzleWorld.map((nozzle) => nozzle.clone());
        flightState.previousNozzles = previousNozzles;

        const isLiteSmoke =
            state.size.width < LITE_VIEWPORT_WIDTH || emission.frameSeconds > LITE_FRAME_SECONDS;

        const { firstSlot, emitted } = emitSmoke({
            geometry: smokeMesh.geometry,
            emission,
            previousNozzles,
            nozzleWorld,
            forward,
            stripeAxis,
            spacing: isLiteSmoke ? LITE_PUFF_SPACING : FULL_PUFF_SPACING,
            time,
            step,
        });

        flushSmokeRanges(smokeMesh.geometry, firstSlot, emitted);

        for (let nozzle = 0; nozzle < previousNozzles.length; nozzle += 1) {
            previousNozzles[nozzle].copy(nozzleWorld[nozzle]);
        }
    });

    return (
        <>
            <StudioEnvironment />
            <hemisphereLight args={['#ffffff', '#d4d4d8', 0.7]} />
            <directionalLight position={[-6, 18, 10]} intensity={1.8} />

            <group ref={jetRef} scale={JET_SCALE} visible={false}>
                <mesh geometry={jetGeometries.body} material={jetMaterials.body} />
                <mesh geometry={jetGeometries.canopy} material={jetMaterials.canopy} />
                <mesh geometry={jetGeometries.nozzles} material={jetMaterials.nozzle} />
                <mesh geometry={jetGeometries.glows} material={jetMaterials.glow} />
            </group>

            <mesh
                ref={smokeRef}
                geometry={smoke.geometry}
                material={smoke.material}
                frustumCulled={false}
            />
        </>
    );
}

export function Flypast() {
    const prefersReducedMotion = usePrefersReducedMotion();

    useEffect(() => resetFlypastReady, []);

    if (prefersReducedMotion) return null;

    return (
        <div className="flypast" data-scene="flypast">
            <SceneCanvas
                fallback={null}
                transparent
                onFirstFrame={markFlypastReady}
                camera={{ fov: CAMERA_FOV, near: 0.1, far: 600, position: [0, 0, 0] }}
            >
                <JetAnimation />
            </SceneCanvas>
        </div>
    );
}
