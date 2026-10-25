'use client';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
    CustomBlending,
    OneFactor,
    SrcAlphaFactor,
    ZeroFactor,
    Color,
    CylinderGeometry,
    DoubleSide,
    MeshPhysicalMaterial,
    Quaternion,
    Vector3,
    type CanvasTexture,
    type InstancedMesh,
} from 'three';
import {
    createDrapeGeometry,
    createGrainTexture,
    createLabelTexture,
    createRunnerGeometry,
    createTierGeometry,
    scratchObject,
} from '@/components/scenes/Auditorium/auditoriumAssets';
import { useSceneQuality } from '@/components/scenes/SceneCanvas/SceneCanvas';
import {
    FRONT_ROW_Z,
    ROW_RISE,
    ROW_SPACING,
    type HallLayout,
    type Point3,
} from '@/components/scenes/seatLayout';
import type { ZoneName } from '@/types/booking';

export type ZoneSignPlacement = { zone: ZoneName; position: Point3; isHighlighted: boolean };

type Beam = {
    position: Vector3;
    quaternion: Quaternion;
    length: number;
    radius: number;
    poolCenter: Vector3;
};

const ZONE_SIGN_SIZE: [number, number] = [2.6, 0.65];

const ZONE_SIGN_STYLES = {
    plain: { background: '#18181b', color: '#e4e4e7', glowColor: '#1c1c22' },
    highlighted: { background: '#fafafa', color: '#09090b', glowColor: '#ffffff' },
};

const SCREEN_TEXTURE = { width: 2048, height: 512, padding: 124, size: 190, spacing: 0.12 };
const LOW_POWER_SCREEN_TEXTURE = { width: 1024, height: 256, padding: 62, size: 95, spacing: 0.12 };
const BEAM_COLOR = new Color('#ffe2b0');
const STEP_LIGHT_COLOR = '#fff4d6';
const STEP_GLOW_COLOR = '#f5b544';
const UP = new Vector3(0, 1, 0);

const LIGHT_BLENDING = {
    blending: CustomBlending,
    blendSrc: SrcAlphaFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
};

const beamVertexShader = `
uniform float uLength;
varying float vAlong;
varying float vFacing;
void main() {
    vAlong = position.y / uLength + 0.5;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vec3 viewNormal = normalize(normalMatrix * normal);
    vFacing = abs(dot(viewNormal, normalize(-viewPosition.xyz)));
    gl_Position = projectionMatrix * viewPosition;
}`;

const beamFragmentShader = `
uniform vec3 uColor;
uniform float uStrength;
varying float vAlong;
varying float vFacing;
void main() {
    float body = pow(vFacing, 2.2);
    float falloff = smoothstep(0.0, 0.3, vAlong) * mix(1.0, 0.35, vAlong);
    gl_FragColor = vec4(uColor * body * falloff * uStrength, 1.0);
}`;

function aimBeam(source: Vector3, target: Vector3): Beam {
    const span = source.clone().sub(target);
    const length = span.length();

    return {
        position: new Vector3().lerpVectors(source, target, 0.5),
        quaternion: new Quaternion().setFromUnitVectors(UP, span.normalize()),
        length,
        radius: length * 0.2,
        poolCenter: target,
    };
}

function ZoneSign({ sign, fontFamily }: { sign: ZoneSignPlacement; fontFamily: string }) {
    const style = sign.isHighlighted ? ZONE_SIGN_STYLES.highlighted : ZONE_SIGN_STYLES.plain;

    const texture = useMemo(
        () =>
            createLabelTexture({
                text: `ZONE ${sign.zone}`,
                width: 1024,
                height: 256,
                size: 130,
                spacing: 0.25,
                maxTextWidth: 900,
                fontFamily,
                ...style,
            }),
        [sign.zone, fontFamily, style],
    );

    useEffect(() => () => texture.dispose(), [texture]);

    return (
        <mesh position={sign.position} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={ZONE_SIGN_SIZE} />
            <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
    );
}

export function AuditoriumHall({
    rows,
    hall,
    eventName,
    fontFamily,
    softDiscTexture,
    zoneSigns,
}: {
    rows: number;
    hall: HallLayout;
    eventName: string;
    fontFamily: string;
    softDiscTexture: CanvasTexture;
    zoneSigns: ZoneSignPlacement[];
}) {
    const stepLightsRef = useRef<InstancedMesh>(null);
    const stepGlowsRef = useRef<InstancedMesh>(null);

    const { isLowPower } = useSceneQuality();
    const { stage, backWall, curtain, valance, screen } = hall;
    const screenTextureSize = isLowPower ? LOW_POWER_SCREEN_TEXTURE : SCREEN_TEXTURE;
    const stepCount = Math.max(0, rows - 1) * 2;

    const tierGeometry = useMemo(() => createTierGeometry(rows, hall), [rows, hall]);
    const runnerGeometry = useMemo(() => createRunnerGeometry(rows, hall), [rows, hall]);
    const carpetTexture = useMemo(
        () => createGrainTexture({ seed: 7, contrast: 26, hasWeave: false }),
        [],
    );

    const curtainGeometry = useMemo(
        () => createDrapeGeometry(curtain.width, curtain.height, 3.5, curtain.width * 0.07),
        [curtain.width, curtain.height],
    );
    const valanceGeometry = useMemo(
        () =>
            createDrapeGeometry(
                backWall.width + 0.2,
                valance.height,
                backWall.width / 0.9,
                Math.min(0.06, valance.height * 0.12),
            ),
        [backWall.width, valance.height],
    );

    const drapeMaterial = useMemo(
        () =>
            new MeshPhysicalMaterial({
                color: '#26262b',
                roughness: 0.8,
                sheen: 1,
                sheenColor: '#8a8a96',
                sheenRoughness: 0.45,
                side: DoubleSide,
            }),
        [],
    );

    const beams = useMemo(() => {
        const sourceY = backWall.height + stage.width * 0.18;
        const sourceZ = stage.frontZ + stage.width * 0.22;

        return [-1, 1].map((side) =>
            aimBeam(
                new Vector3(side * stage.width * 0.34, sourceY, sourceZ),
                new Vector3(side * stage.width * 0.13, stage.height + 0.01, stage.z + 0.2),
            ),
        );
    }, [backWall.height, stage]);

    const beamGeometries = useMemo(
        () =>
            beams.map(
                (beam) =>
                    new CylinderGeometry(beam.radius * 0.06, beam.radius, beam.length, 40, 1, true),
            ),
        [beams],
    );

    const beamUniforms = useMemo(
        () =>
            beams.map((beam) => ({
                uLength: { value: beam.length },
                uColor: { value: BEAM_COLOR },
                uStrength: { value: 0.5 },
            })),
        [beams],
    );

    const stageLabelTexture = useMemo(
        () =>
            createLabelTexture({
                text: 'STAGE',
                width: 1024,
                height: 256,
                background: '#18181b',
                color: '#a1a1aa',
                size: 110,
                spacing: 0.3,
                maxTextWidth: 900,
                fontFamily,
            }),
        [fontFamily],
    );

    const screenTexture = useMemo(
        () =>
            createLabelTexture({
                text: eventName,
                width: screenTextureSize.width,
                height: screenTextureSize.height,
                background: '#09090b',
                color: '#fafafa',
                size: screenTextureSize.size,
                spacing: screenTextureSize.spacing,
                maxTextWidth: screenTextureSize.width - screenTextureSize.padding * 2,
                fontFamily,
            }),
        [eventName, fontFamily, screenTextureSize],
    );

    useEffect(() => () => tierGeometry.dispose(), [tierGeometry]);
    useEffect(() => () => runnerGeometry.dispose(), [runnerGeometry]);
    useEffect(() => () => carpetTexture.dispose(), [carpetTexture]);
    useEffect(() => () => curtainGeometry.dispose(), [curtainGeometry]);
    useEffect(() => () => valanceGeometry.dispose(), [valanceGeometry]);
    useEffect(() => () => drapeMaterial.dispose(), [drapeMaterial]);
    useEffect(() => () => stageLabelTexture.dispose(), [stageLabelTexture]);
    useEffect(() => () => screenTexture.dispose(), [screenTexture]);
    useEffect(
        () => () => {
            for (const geometry of beamGeometries) geometry.dispose();
        },
        [beamGeometries],
    );

    useLayoutEffect(() => {
        const lights = stepLightsRef.current;
        const glows = stepGlowsRef.current;
        if (!lights || !glows) return;

        const offsetX = hall.runnerWidth / 2 + 0.07;

        for (let row = 1; row < rows; row += 1) {
            const riserZ = FRONT_ROW_Z + row * ROW_SPACING - ROW_SPACING / 2;
            const treadY = row * ROW_RISE;

            for (const side of [-1, 1]) {
                const index = (row - 1) * 2 + (side < 0 ? 0 : 1);

                scratchObject.position.set(side * offsetX, treadY + 0.01, riserZ + 0.06);
                scratchObject.rotation.set(0, 0, 0);
                scratchObject.scale.setScalar(1);
                scratchObject.updateMatrix();
                lights.setMatrixAt(index, scratchObject.matrix);

                scratchObject.position.set(side * offsetX, treadY + 0.016, riserZ + 0.14);
                scratchObject.rotation.set(-Math.PI / 2, 0, 0);
                scratchObject.updateMatrix();
                glows.setMatrixAt(index, scratchObject.matrix);
            }
        }

        lights.instanceMatrix.needsUpdate = true;
        glows.instanceMatrix.needsUpdate = true;
    }, [rows, hall.runnerWidth]);

    return (
        <>
            <mesh
                position={[0, -0.21, hall.floor.z + hall.floor.depth * 0.04]}
                rotation={[-Math.PI / 2, 0, 0]}
            >
                <planeGeometry args={[hall.floor.width * 1.3, hall.floor.depth * 1.3]} />
                <meshBasicMaterial
                    color="#18181b"
                    map={softDiscTexture}
                    transparent
                    opacity={0.28}
                    depthWrite={false}
                    toneMapped={false}
                />
            </mesh>

            <mesh geometry={tierGeometry} receiveShadow>
                <meshStandardMaterial
                    vertexColors
                    map={carpetTexture}
                    roughness={0.95}
                    envMapIntensity={0.6}
                />
            </mesh>

            <mesh geometry={runnerGeometry} receiveShadow>
                <meshStandardMaterial
                    color="#2a2a2f"
                    map={carpetTexture}
                    roughness={1}
                    envMapIntensity={0.4}
                />
            </mesh>

            {stepCount > 0 && (
                <>
                    <instancedMesh ref={stepLightsRef} args={[undefined, undefined, stepCount]}>
                        <boxGeometry args={[0.1, 0.02, 0.05]} />
                        <meshBasicMaterial color={STEP_LIGHT_COLOR} toneMapped={false} />
                    </instancedMesh>
                    <instancedMesh ref={stepGlowsRef} args={[undefined, undefined, stepCount]}>
                        <planeGeometry args={[0.5, 0.42]} />
                        <meshBasicMaterial
                            color={STEP_GLOW_COLOR}
                            map={softDiscTexture}
                            transparent
                            opacity={0.7}
                            depthWrite={false}
                            toneMapped={false}
                        />
                    </instancedMesh>
                </>
            )}

            <mesh position={[0, stage.height / 2, stage.z]} castShadow receiveShadow>
                <boxGeometry args={[stage.width, stage.height, stage.depth]} />
                <meshStandardMaterial color="#1c1c20" roughness={0.32} envMapIntensity={0.9} />
            </mesh>

            <mesh position={[0, stage.height - 0.015, stage.frontZ + 0.012]}>
                <boxGeometry args={[stage.width, 0.03, 0.03]} />
                <meshBasicMaterial color="#ffe7b8" toneMapped={false} />
            </mesh>

            <mesh position={[0, stage.height * 0.45, stage.frontZ + 0.002]}>
                <planeGeometry
                    args={[Math.min(4, stage.width * 0.4), Math.min(1, stage.width * 0.1)]}
                />
                <meshBasicMaterial map={stageLabelTexture} toneMapped={false} />
            </mesh>

            {zoneSigns.map((sign) => (
                <ZoneSign key={sign.zone} sign={sign} fontFamily={fontFamily} />
            ))}

            <mesh position={[0, backWall.height / 2, backWall.z - 0.1]} receiveShadow>
                <boxGeometry args={[backWall.width + 0.2, backWall.height, 0.2]} />
                <meshStandardMaterial color="#141417" roughness={0.9} />
            </mesh>

            {[-1, 1].map((side) => (
                <mesh
                    key={side}
                    geometry={curtainGeometry}
                    material={drapeMaterial}
                    position={[side * curtain.x, curtain.height / 2, curtain.z]}
                    castShadow
                />
            ))}

            <mesh
                geometry={valanceGeometry}
                material={drapeMaterial}
                position={[0, valance.y, curtain.z + 0.08]}
                castShadow
            />

            <mesh position={[0, screen.y, screen.z - 0.03]}>
                <boxGeometry args={[screen.width + 0.24, screen.height + 0.24, 0.06]} />
                <meshStandardMaterial color="#2a2a30" roughness={0.3} metalness={0.4} />
            </mesh>

            <mesh position={[0, screen.y, screen.z + 0.002]}>
                <planeGeometry args={[screen.width, screen.height]} />
                <meshBasicMaterial map={screenTexture} toneMapped={false} />
            </mesh>

            {beams.map((beam, index) => (
                <group key={index}>
                    <mesh
                        geometry={beamGeometries[index]}
                        position={beam.position}
                        quaternion={beam.quaternion}
                        renderOrder={2}
                    >
                        <shaderMaterial
                            uniforms={beamUniforms[index]}
                            vertexShader={beamVertexShader}
                            fragmentShader={beamFragmentShader}
                            {...LIGHT_BLENDING}
                            transparent
                            depthWrite={false}
                            side={DoubleSide}
                            toneMapped={false}
                        />
                    </mesh>
                    <mesh
                        position={beam.poolCenter}
                        rotation={[-Math.PI / 2, 0, 0]}
                        renderOrder={1}
                    >
                        <planeGeometry args={[beam.radius * 2.6, beam.radius * 2]} />
                        <meshBasicMaterial
                            color="#ffd9a0"
                            map={softDiscTexture}
                            transparent
                            opacity={0.55}
                            {...LIGHT_BLENDING}
                            depthWrite={false}
                            toneMapped={false}
                        />
                    </mesh>
                </group>
            ))}
        </>
    );
}
