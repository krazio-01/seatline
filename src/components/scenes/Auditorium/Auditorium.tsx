'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
    Color,
    DoubleSide,
    Group,
    InstancedMesh,
    type InstancedBufferAttribute,
    Mesh,
    MeshBasicMaterial,
    MeshPhysicalMaterial,
    MeshStandardMaterial,
    Object3D,
    PerspectiveCamera,
    Raycaster,
    RingGeometry,
    Vector2,
    Vector3,
} from 'three';
import './auditorium.scss';
import { usePrefersReducedMotion } from '@/components/scenes/sceneSupport';
import { classNames } from '@/utils/class-names';
import { AuditoriumFallback } from '@/components/scenes/AuditoriumFallback/AuditoriumFallback';
import { AuditoriumHall } from '@/components/scenes/Auditorium/AuditoriumHall';
import {
    createChairGeometries,
    createGrainTexture,
    createSoftDiscTexture,
    createRowEndGeometry,
    DETAILED_SEAT_LIMIT,
    scratchObject,
} from '@/components/scenes/Auditorium/auditoriumAssets';
import {
    SceneCanvas,
    StudioEnvironment,
    useSceneQuality,
} from '@/components/scenes/SceneCanvas/SceneCanvas';
import {
    AUDITORIUM_CAMERA,
    auditoriumRestView,
    frameOrbit,
    normalizePointer,
    stepSpring,
    viewDirection,
    type ViewFraming,
} from '@/components/scenes/cameraMath';
import {
    computeHallLayout,
    computeHighlightFocus,
    computeRowEnds,
    computeSeatLayout,
    SEAT_COLORS,
    seatHoverText,
    zoneRowCount,
    zoneSeatKeys,
    zoneSeatStates,
    zoneSignPositions,
    type HallLayout,
    type HighlightFocus,
    type Point3,
    type SeatState,
} from '@/components/scenes/seatLayout';
import { useZoneSeating } from '@/hooks/useZoneSeating';
import type { ZoneName, ZoneOccupancy } from '@/types/booking';

type SeatHover = { text: string; x: number; y: number };

type AuditoriumProps = {
    zones: ZoneOccupancy[];
    highlightedZone?: ZoneName;
    eventName: string;
    pulseKeys?: string[];
    variant?: 'booking' | 'admin';
    startsAtRest?: boolean;
    onSeatHover?: (hover: SeatHover | null) => void;
};

type SpringValue = { value: number; velocity: number };

type PointerState = {
    normalized: { x: number; y: number };
    localX: number;
    localY: number;
    isInside: boolean;
    hasMoved: boolean;
};

type OrbitState = {
    viewAngle: { yaw: number; elevation: number } | null;
    tilt: { yaw: SpringValue; elevation: SpringValue };
    tiltTarget: { x: number; y: number };
    framing: ViewFraming;
    framingKey: {
        hall: HallLayout | null;
        aspect: number;
        fov: number;
        yaw: number;
        elevation: number;
    };
};

type SeatFrame = {
    mesh: InstancedMesh;
    layout: SeatPlacement[];
    seatColors: Color[];
    time: number;
    step: number;
    isStill: boolean;
    dirtyMatrices: number[];
    dirtyColors: number[];
};

const RISE_SECONDS = 0.5;
const RESTING_START_SECONDS = 10;
const LONGEST_RISE_DELAY = 1;
const MAX_FRAME_SECONDS = 0.1;
const HOP_SECONDS = 0.6;
const HOP_HEIGHT = 0.35;
const GLOW_SECONDS = 1.2;
const RIPPLE_SECONDS = 1;
const EMPTY_KEYS: string[] = [];
const MARKER_COLOR = '#fafafa';
const HIGHLIGHT_TINT = 0.22;
const HIGHLIGHT_TINT_PULSE = 0.18;
const FALLBACK_FONT_FAMILY = 'system-ui, sans-serif';
const TILT_FREQUENCY = 10;
const HOVER_LIFT = 0.12;
const HOVER_EASE = 14;
const HOVER_REST = 0.002;
const LABEL_GAP = 12;
const LABEL_INSET = 4;
const scratchColor = new Color();
const glowColor = new Color(SEAT_COLORS.glow);
const cameraDirection: Point3 = [0, 0, 0];
const raycaster = new Raycaster();
const pointerNdc = new Vector2();

type SeatPlacement = ReturnType<typeof computeSeatLayout>[number];

function uploadInstances(
    attribute: InstancedBufferAttribute | null,
    indices: number[],
    itemSize: number,
    isFull: boolean,
) {
    if (!attribute) return;

    if (isFull) {
        attribute.clearUpdateRanges();
        attribute.needsUpdate = true;
        return;
    }

    if (indices.length === 0) return;

    attribute.clearUpdateRanges();

    for (const index of indices) attribute.addUpdateRange(index * itemSize, itemSize);

    attribute.needsUpdate = true;
}

const easeOutBack = (progress: number) =>
    1 + 2.2 * Math.pow(progress - 1, 3) + 1.2 * Math.pow(progress - 1, 2);

function useLabelFontFamily(): string | null {
    const [fontFamily, setFontFamily] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;

        document.fonts.ready.then(() => {
            if (!isMounted) return;

            const rootStyle = getComputedStyle(document.documentElement);
            const geist = rootStyle.getPropertyValue('--font-geist-sans').trim();

            setFontFamily(geist ? `${geist}, ${FALLBACK_FONT_FAMILY}` : FALLBACK_FONT_FAMILY);
        });

        return () => {
            isMounted = false;
        };
    }, []);

    return fontFamily;
}

function useSeatMeshes(count: number, rowEnds: Point3[], isLowPower: boolean) {
    const materials = useMemo(() => {
        const fabric = createGrainTexture({ seed: 11, contrast: 70, hasWeave: true });
        fabric.repeat.set(4, 4);

        const softDiscTexture = createSoftDiscTexture();

        return {
            fabric,
            softDiscTexture,
            upholstery: isLowPower
                ? new MeshStandardMaterial({ roughness: 0.85 })
                : new MeshPhysicalMaterial({
                      roughness: 0.78,
                      roughnessMap: fabric,
                      bumpMap: fabric,
                      bumpScale: 0.6,
                      sheen: 0.35,
                      sheenColor: '#a1a1aa',
                      sheenRoughness: 0.45,
                      envMapIntensity: 0.5,
                  }),
            frame: new MeshStandardMaterial({
                color: '#1f1f23',
                roughness: 0.45,
                metalness: 0.2,
                envMapIntensity: 0.9,
            }),
            shadow: new MeshBasicMaterial({
                color: '#18181b',
                map: softDiscTexture,
                transparent: true,
                opacity: 0.32,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                toneMapped: false,
            }),
        };
    }, [isLowPower]);

    const meshes = useMemo(() => {
        const isDetailed = count <= DETAILED_SEAT_LIMIT;
        const geometries = {
            ...createChairGeometries(isDetailed),
            rowEnd: createRowEndGeometry(isDetailed),
        };
        const upholstery = new InstancedMesh(geometries.upholstery, materials.upholstery, count);
        const frame = new InstancedMesh(geometries.frame, materials.frame, count);
        const shadow = new InstancedMesh(geometries.shadow, materials.shadow, count);
        const rowEndMesh = new InstancedMesh(geometries.rowEnd, materials.frame, rowEnds.length);

        rowEnds.forEach(([x, y, z], index) => {
            scratchObject.position.set(x, y, z);
            scratchObject.rotation.set(0, 0, 0);
            scratchObject.scale.setScalar(1);
            scratchObject.updateMatrix();
            rowEndMesh.setMatrixAt(index, scratchObject.matrix);
        });

        rowEndMesh.castShadow = !isLowPower && count <= DETAILED_SEAT_LIMIT;
        rowEndMesh.receiveShadow = true;

        frame.instanceMatrix = upholstery.instanceMatrix;
        shadow.instanceMatrix = upholstery.instanceMatrix;
        upholstery.castShadow = !isLowPower && count <= DETAILED_SEAT_LIMIT;
        upholstery.receiveShadow = true;
        frame.receiveShadow = true;
        frame.castShadow = upholstery.castShadow;

        for (const mesh of [upholstery, frame, shadow]) mesh.frustumCulled = false;

        return { upholstery, frame, shadow, rowEnd: rowEndMesh, geometries };
    }, [count, rowEnds, materials, isLowPower]);

    useEffect(
        () => () => {
            meshes.geometries.upholstery.dispose();
            meshes.geometries.frame.dispose();
            meshes.geometries.shadow.dispose();
            meshes.geometries.rowEnd.dispose();
            meshes.rowEnd.dispose();
            meshes.upholstery.dispose();
            meshes.frame.dispose();
            meshes.shadow.dispose();
        },
        [meshes],
    );

    useEffect(
        () => () => {
            materials.fabric.dispose();
            materials.softDiscTexture.dispose();
            materials.upholstery.dispose();
            materials.frame.dispose();
            materials.shadow.dispose();
        },
        [materials],
    );

    return { ...meshes, softDiscTexture: materials.softDiscTexture };
}

function placeSeat(
    mesh: InstancedMesh,
    index: number,
    placement: SeatPlacement,
    lift = 0,
    scale = 1,
) {
    scratchObject.position.set(placement.x, placement.y + lift, placement.z);
    scratchObject.rotation.set(0, 0, 0);
    scratchObject.scale.setScalar(scale);
    scratchObject.updateMatrix();
    mesh.setMatrixAt(index, scratchObject.matrix);
}

function updateCameraOrbit(
    camera: PerspectiveCamera,
    aspect: number,
    orbit: OrbitState,
    hall: HallLayout,
    highlightFocus: HighlightFocus | null,
    step: number,
    isStill: boolean,
) {
    const { yaw: desiredYaw, elevation: desiredElevation } = auditoriumRestView(
        highlightFocus?.yaw ?? null,
    );

    if (!orbit.viewAngle || isStill) {
        orbit.viewAngle = { yaw: desiredYaw, elevation: desiredElevation };
    } else {
        const ease = 1 - Math.exp(-step * 2);

        orbit.viewAngle.yaw += (desiredYaw - orbit.viewAngle.yaw) * ease;
        orbit.viewAngle.elevation += (desiredElevation - orbit.viewAngle.elevation) * ease;
    }

    const { tilt, tiltTarget, framing, framingKey } = orbit;

    if (isStill) {
        tilt.yaw.value = 0;
        tilt.yaw.velocity = 0;
        tilt.elevation.value = 0;
        tilt.elevation.velocity = 0;
    } else {
        stepSpring(tilt.yaw, tiltTarget.x * AUDITORIUM_CAMERA.tiltRange.yaw, TILT_FREQUENCY, step);
        stepSpring(
            tilt.elevation,
            -tiltTarget.y * AUDITORIUM_CAMERA.tiltRange.elevation,
            TILT_FREQUENCY,
            step,
        );
    }

    const restYaw = orbit.viewAngle.yaw;
    const restElevation = orbit.viewAngle.elevation;
    const isFramingStale =
        framingKey.hall !== hall ||
        framingKey.aspect !== aspect ||
        framingKey.fov !== camera.fov ||
        Math.abs(framingKey.yaw - restYaw) > 1e-5 ||
        Math.abs(framingKey.elevation - restElevation) > 1e-5;

    if (isFramingStale) {
        frameOrbit(
            {
                points: hall.extents,
                yaw: restYaw,
                elevation: restElevation,
                verticalFov: camera.fov,
                aspect,
                margin: AUDITORIUM_CAMERA.margin,
            },
            AUDITORIUM_CAMERA.tiltRange,
            framing,
        );

        Object.assign(framingKey, {
            hall,
            aspect,
            fov: camera.fov,
            yaw: restYaw,
            elevation: restElevation,
        });
    }

    viewDirection(restYaw + tilt.yaw.value, restElevation + tilt.elevation.value, cameraDirection);

    const [targetX, targetY, targetZ] = framing.target;
    const far = framing.distance * 3 + 20;

    camera.position.set(
        targetX + cameraDirection[0] * framing.distance,
        targetY + cameraDirection[1] * framing.distance,
        targetZ + cameraDirection[2] * framing.distance,
    );
    camera.lookAt(targetX, targetY, targetZ);

    if (Math.abs(camera.far - far) > far * 0.1) {
        camera.near = Math.max(0.1, framing.distance * 0.02);
        camera.far = far;
        camera.updateProjectionMatrix();
    }
}

function animateRise(frame: SeatFrame, riseTiming: { delayScale: number; end: number }): boolean {
    const isDone = frame.time >= riseTiming.end;

    frame.layout.forEach((placement, index) => {
        const localProgress = Math.min(
            1,
            Math.max(0, (frame.time - placement.delay * riseTiming.delayScale) / RISE_SECONDS),
        );
        const rise = isDone ? 1 : localProgress === 0 ? 0 : easeOutBack(localProgress);

        placeSeat(frame.mesh, index, placement, 0, Math.max(0.001, rise));
    });

    if (isDone) frame.mesh.boundingSphere = null;

    return !isDone;
}

function animatePulses(frame: SeatFrame, pulses: Map<number, number>) {
    for (const [index, startedAt] of pulses) {
        const sincePulse = frame.time - startedAt;
        const isFinished = sincePulse >= GLOW_SECONDS;
        const hop =
            sincePulse < HOP_SECONDS
                ? Math.sin((sincePulse / HOP_SECONDS) * Math.PI) * HOP_HEIGHT
                : 0;

        placeSeat(frame.mesh, index, frame.layout[index], hop);

        scratchColor.copy(frame.seatColors[index]);

        if (!isFinished) scratchColor.lerp(glowColor, 1 - sincePulse / GLOW_SECONDS);

        frame.mesh.setColorAt(index, scratchColor);

        if (isFinished) pulses.delete(index);

        frame.dirtyMatrices.push(index);
        frame.dirtyColors.push(index);
    }
}

function animateHighlight(
    frame: SeatFrame,
    highlightFocus: HighlightFocus,
    riseEnd: number,
    marker: Mesh | null,
    markerMaterial: MeshBasicMaterial | null,
) {
    const { time, isStill } = frame;
    const tint =
        HIGHLIGHT_TINT + (isStill ? 0 : HIGHLIGHT_TINT_PULSE * (0.5 + 0.5 * Math.sin(time * 2)));

    for (const index of highlightFocus.indices) {
        scratchColor.copy(frame.seatColors[index]).lerp(glowColor, tint);
        frame.mesh.setColorAt(index, scratchColor);
        frame.dirtyColors.push(index);
    }

    const markerProgress = Math.min(1, Math.max(0, (time - riseEnd) / 0.5));
    const markerOpacity = isStill ? 0.7 : 0.55 + 0.25 * Math.sin(time * 4);

    if (markerMaterial) markerMaterial.opacity = markerProgress * markerOpacity;

    marker?.scale.setScalar(0.6 + markerProgress * 0.4);
}

function updateHover(
    frame: SeatFrame,
    camera: PerspectiveCamera,
    pointer: PointerState,
    seatStates: Record<string, SeatState>,
    onSeatHover?: (hover: SeatHover | null) => void,
): number {
    let hovered = -1;

    pointer.hasMoved = false;

    if (pointer.isInside) {
        camera.updateMatrixWorld();
        pointerNdc.set(pointer.normalized.x, -pointer.normalized.y);
        raycaster.setFromCamera(pointerNdc, camera);

        const [hit] = raycaster.intersectObject(frame.mesh, false);
        hovered = hit?.instanceId ?? -1;
    }

    if (hovered < 0) {
        onSeatHover?.(null);
        return hovered;
    }

    onSeatHover?.({
        text: seatHoverText(frame.layout[hovered], seatStates),
        x: pointer.localX,
        y: pointer.localY,
    });

    return hovered;
}

function animateHoverLifts(
    frame: SeatFrame,
    hoverLifts: Map<number, number>,
    hovered: number,
    claimedIndices: { has: (index: number) => boolean }[],
) {
    const ease = 1 - Math.exp(-frame.step * HOVER_EASE);

    if (hovered >= 0 && !hoverLifts.has(hovered)) hoverLifts.set(hovered, 0);

    for (const [index, amount] of hoverLifts) {
        if (claimedIndices.some((claimed) => claimed.has(index))) {
            hoverLifts.delete(index);
            continue;
        }

        const target = index === hovered ? 1 : 0;
        const lift = amount + (target - amount) * ease;
        const isResting = target === 0 && lift < HOVER_REST;

        placeSeat(frame.mesh, index, frame.layout[index], isResting ? 0 : lift * HOVER_LIFT);
        frame.dirtyMatrices.push(index);

        if (isResting) hoverLifts.delete(index);
        else hoverLifts.set(index, lift);
    }
}

function ageRipples(rippleGroup: Group, time: number) {
    for (let rippleIndex = rippleGroup.children.length - 1; rippleIndex >= 0; rippleIndex -= 1) {
        const ripple = rippleGroup.children[rippleIndex];
        const age = time - (ripple.userData.bornAt as number);
        const material = (ripple as Mesh).material as MeshBasicMaterial;

        ripple.scale.setScalar(1 + age * 2.2);
        material.opacity = Math.max(0, 0.9 - age * 0.9);

        if (age <= RIPPLE_SECONDS) continue;

        ripple.removeFromParent();
        material.dispose();
    }
}

function usePointerTilt(canvas: HTMLCanvasElement, isStill: boolean, invalidate: () => void) {
    const pointerRef = useRef<PointerState>({
        normalized: { x: 0, y: 0 },
        localX: 0,
        localY: 0,
        isInside: false,
        hasMoved: false,
    });
    const tiltTargetRef = useRef({ x: 0, y: 0 });

    useEffect(() => {
        const pointer = pointerRef.current;
        const tiltTarget = tiltTargetRef.current;

        const settle = () => {
            tiltTarget.x = 0;
            tiltTarget.y = 0;
            pointer.isInside = false;
            pointer.hasMoved = true;
            invalidate();
        };

        const track = (event: PointerEvent) => {
            if (event.pointerType !== 'mouse') return;

            const rect = canvas.getBoundingClientRect();
            normalizePointer(event.clientX, event.clientY, rect, pointer.normalized);

            pointer.localX = event.clientX - rect.left;
            pointer.localY = event.clientY - rect.top;
            pointer.isInside = true;
            pointer.hasMoved = true;

            if (!isStill) {
                tiltTarget.x = pointer.normalized.x;
                tiltTarget.y = pointer.normalized.y;
            }

            invalidate();
        };

        const settleWhenHidden = () => {
            if (document.hidden) settle();
        };

        canvas.addEventListener('pointermove', track, { passive: true });
        canvas.addEventListener('pointerleave', settle);
        window.addEventListener('blur', settle);
        document.addEventListener('visibilitychange', settleWhenHidden);

        return () => {
            canvas.removeEventListener('pointermove', track);
            canvas.removeEventListener('pointerleave', settle);
            window.removeEventListener('blur', settle);
            document.removeEventListener('visibilitychange', settleWhenHidden);
        };
    }, [canvas, isStill, invalidate]);

    return { pointerRef, tiltTargetRef };
}

function useHighlightFocus(
    highlightedZone: ZoneName | undefined,
    layout: SeatPlacement[],
    hallWidth: number,
) {
    const highlightFocus = useMemo(
        () =>
            highlightedZone
                ? computeHighlightFocus(
                      zoneSeatKeys(layout, highlightedZone),
                      layout,
                      hallWidth,
                      AUDITORIUM_CAMERA.highlightYaw,
                  )
                : null,
        [highlightedZone, layout, hallWidth],
    );

    const markerGeometry = useMemo(
        () =>
            highlightFocus
                ? new RingGeometry(highlightFocus.radius, highlightFocus.radius + 0.08, 64)
                : null,
        [highlightFocus],
    );

    useEffect(() => () => markerGeometry?.dispose(), [markerGeometry]);

    return { highlightFocus, markerGeometry };
}

export function AuditoriumContents({
    zones,
    highlightedZone,
    eventName,
    pulseKeys = EMPTY_KEYS,
    variant = 'booking',
    onSeatHover,
    fontFamily,
    isStill = false,
    startsAtRest = false,
}: AuditoriumProps & { fontFamily: string; isStill?: boolean }) {
    const seatsRef = useRef<InstancedMesh>(null);
    const ripplesRef = useRef<Group>(null);
    const markerRef = useRef<Mesh>(null);
    const markerMaterialRef = useRef<MeshBasicMaterial>(null);
    const elapsedRef = useRef(startsAtRest ? RESTING_START_SECONDS : 0);
    const isRisingRef = useRef(!isStill && !startsAtRest);
    const pulsesRef = useRef(new Map<number, number>());
    const previousPulseKeysRef = useRef(new Set(pulseKeys));
    const hoveredRef = useRef(-1);
    const fullUploadRef = useRef(true);
    const dirtyMatricesRef = useRef<number[]>([]);
    const dirtyColorsRef = useRef<number[]>([]);
    const hoverLiftRef = useRef(new Map<number, number>());
    const orbitRef = useRef<Omit<OrbitState, 'tiltTarget'>>({
        viewAngle: null,
        tilt: { yaw: { value: 0, velocity: 0 }, elevation: { value: 0, velocity: 0 } },
        framing: { target: [0, 0, 0], distance: 0 },
        framingKey: { hall: null, aspect: 0, fov: 0, yaw: NaN, elevation: NaN },
    });

    const invalidate = useThree((state) => state.invalidate);
    const canvas = useThree((state) => state.gl.domElement);
    const { isLowPower } = useSceneQuality();
    const { pointerRef, tiltTargetRef } = usePointerTilt(canvas, isStill, invalidate);

    const seating = useZoneSeating(zones);
    const seatStates = useMemo(() => zoneSeatStates(zones), [zones]);
    const layout = useMemo(() => computeSeatLayout(seating), [seating]);
    const hall = useMemo(() => computeHallLayout(seating), [seating]);
    const rowEnds = useMemo(() => computeRowEnds(seating).flat(), [seating]);

    const zoneSigns = useMemo(
        () =>
            zoneSignPositions(layout).map((sign) => ({
                ...sign,
                isHighlighted: sign.zone === highlightedZone,
            })),
        [layout, highlightedZone],
    );
    const seatMeshes = useSeatMeshes(layout.length, rowEnds, isLowPower);
    const rippleGeometry = useMemo(() => new RingGeometry(0.35, 0.42, 40), []);

    const indexByKey = useMemo(
        () => new Map(layout.map((placement, index) => [placement.key, index])),
        [layout],
    );

    const { highlightFocus, markerGeometry } = useHighlightFocus(
        highlightedZone,
        layout,
        hall.width,
    );

    const riseTiming = useMemo(() => {
        const longestDelay = Math.max(0, ...layout.map((placement) => placement.delay));
        const delayScale =
            longestDelay > LONGEST_RISE_DELAY ? LONGEST_RISE_DELAY / longestDelay : 1;

        return { delayScale, end: longestDelay * delayScale + RISE_SECONDS };
    }, [layout]);

    const lighting = useMemo(() => {
        const center = new Vector3(0, 0, hall.floor.z);
        const reach = Math.max(hall.floor.width, hall.floor.depth);
        const target = new Object3D();

        target.position.copy(center);

        return {
            target,
            position: [center.x - reach * 0.35, reach * 0.9, center.z + reach * 0.55] as Point3,
            extent: reach * 0.62,
            far: reach * 2.5,
        };
    }, [hall]);

    const seatColors = useMemo(() => {
        const bookedColor = variant === 'admin' ? SEAT_COLORS.adminBooked : SEAT_COLORS.booked;
        const palette = {
            available: new Color(SEAT_COLORS.available),
            booked: new Color(bookedColor),
            checkedIn: new Color(SEAT_COLORS.checkedIn),
        };

        return layout.map((placement) => palette[seatStates[placement.key] ?? 'available']);
    }, [layout, seatStates, variant]);

    useEffect(() => () => rippleGeometry.dispose(), [rippleGeometry]);

    useLayoutEffect(() => {
        const mesh = seatsRef.current;
        if (!mesh) return;

        const scale = isRisingRef.current ? 0.001 : 1;

        layout.forEach((placement, index) => {
            placeSeat(mesh, index, placement, 0, scale);
            mesh.setColorAt(index, seatColors[index]);
        });

        fullUploadRef.current = true;
        pointerRef.current.hasMoved = true;

        invalidate();
    }, [layout, seatColors, seatMeshes, pointerRef, invalidate]);

    useLayoutEffect(() => {
        hoveredRef.current = -1;
        hoverLiftRef.current.clear();
        pulsesRef.current.clear();
        onSeatHover?.(null);
    }, [layout, onSeatHover]);

    useLayoutEffect(() => {
        const mesh = seatsRef.current;

        pointerRef.current.hasMoved = true;
        invalidate();

        if (!mesh || !highlightFocus) return;

        return () => {
            for (const index of highlightFocus.indices) {
                placeSeat(mesh, index, layout[index]);
                mesh.setColorAt(index, seatColors[index]);
            }

            fullUploadRef.current = true;
        };
    }, [highlightFocus, layout, seatColors, seatMeshes, pointerRef, invalidate]);

    useEffect(() => {
        const previousKeys = previousPulseKeysRef.current;
        previousPulseKeysRef.current = new Set(pulseKeys);

        if (isStill) return;

        const group = ripplesRef.current;

        for (const key of pulseKeys) {
            const index = indexByKey.get(key);
            if (previousKeys.has(key) || index === undefined) continue;

            pulsesRef.current.set(index, elapsedRef.current);

            if (!group) continue;

            const placement = layout[index];
            const ripple = new Mesh(
                rippleGeometry,
                new MeshBasicMaterial({
                    color: SEAT_COLORS.glow,
                    transparent: true,
                    opacity: 0.9,
                    side: DoubleSide,
                    depthWrite: false,
                }),
            );

            ripple.rotation.x = -Math.PI / 2;
            ripple.position.set(placement.x, placement.y + 0.05, placement.z);
            ripple.userData.bornAt = elapsedRef.current;
            group.add(ripple);
        }
    }, [pulseKeys, indexByKey, layout, rippleGeometry, isStill]);

    useFrame((state, delta) => {
        const mesh = seatsRef.current;
        const rippleGroup = ripplesRef.current;
        if (!mesh || !rippleGroup) return;

        const step = Math.min(delta, MAX_FRAME_SECONDS);

        if (!isStill) elapsedRef.current += step;

        const camera = state.camera as PerspectiveCamera;
        const frame: SeatFrame = {
            mesh,
            layout,
            seatColors,
            time: isStill ? riseTiming.end + 1 : elapsedRef.current,
            step,
            isStill,
            dirtyMatrices: dirtyMatricesRef.current,
            dirtyColors: dirtyColorsRef.current,
        };
        let isFullUpload = fullUploadRef.current;

        frame.dirtyMatrices.length = 0;
        frame.dirtyColors.length = 0;
        fullUploadRef.current = false;

        updateCameraOrbit(
            camera,
            state.size.width / Math.max(1, state.size.height),
            { ...orbitRef.current, tiltTarget: tiltTargetRef.current },
            hall,
            highlightFocus,
            step,
            isStill,
        );

        if (isRisingRef.current) {
            isRisingRef.current = animateRise(frame, riseTiming);
            isFullUpload = true;
        }

        animatePulses(frame, pulsesRef.current);

        if (highlightFocus) {
            animateHighlight(
                frame,
                highlightFocus,
                riseTiming.end,
                markerRef.current,
                markerMaterialRef.current,
            );
        }

        if (pointerRef.current.hasMoved && !isRisingRef.current) {
            hoveredRef.current = updateHover(
                frame,
                camera,
                pointerRef.current,
                seatStates,
                onSeatHover,
            );
        }

        if (!isStill && !isRisingRef.current) {
            animateHoverLifts(frame, hoverLiftRef.current, hoveredRef.current, [pulsesRef.current]);
        }

        ageRipples(rippleGroup, frame.time);

        uploadInstances(mesh.instanceMatrix, frame.dirtyMatrices, 16, isFullUpload);
        uploadInstances(mesh.instanceColor, frame.dirtyColors, 3, isFullUpload);
    });

    return (
        <>
            {!isLowPower && <StudioEnvironment intensity={0.25} />}
            <hemisphereLight args={['#ffffff', '#a1a1aa', isLowPower ? 0.75 : 0.4]} />
            <primitive object={lighting.target} />
            <directionalLight
                position={lighting.position}
                target={lighting.target}
                intensity={isLowPower ? 1 : 0.85}
                castShadow={!isLowPower}
                shadow-mapSize={[2048, 2048]}
                shadow-radius={4}
                shadow-bias={-0.0004}
                shadow-normalBias={0.02}
                shadow-camera-left={-lighting.extent}
                shadow-camera-right={lighting.extent}
                shadow-camera-top={lighting.extent}
                shadow-camera-bottom={-lighting.extent}
                shadow-camera-far={lighting.far}
            />

            <AuditoriumHall
                rows={zoneRowCount(seating)}
                zoneSigns={zoneSigns}
                hall={hall}
                eventName={eventName}
                fontFamily={fontFamily}
                softDiscTexture={seatMeshes.softDiscTexture}
            />

            <primitive object={seatMeshes.shadow} />
            <primitive object={seatMeshes.frame} />
            <primitive object={seatMeshes.rowEnd} />
            <primitive ref={seatsRef} object={seatMeshes.upholstery} />

            {highlightFocus && markerGeometry && (
                <mesh
                    ref={markerRef}
                    geometry={markerGeometry}
                    rotation={[-Math.PI / 2, 0, 0]}
                    position={highlightFocus.center}
                >
                    <meshBasicMaterial
                        ref={markerMaterialRef}
                        color={MARKER_COLOR}
                        transparent
                        opacity={0}
                        side={DoubleSide}
                    />
                </mesh>
            )}

            <group ref={ripplesRef} />
        </>
    );
}

export function Auditorium({
    className,
    onFirstFrame,
    ...props
}: AuditoriumProps & { className?: string; onFirstFrame?: () => void }) {
    const prefersReducedMotion = usePrefersReducedMotion();
    const fontFamily = useLabelFontFamily();
    const hoverLabelRef = useRef<HTMLDivElement>(null);

    const showSeatHover = useCallback((hover: SeatHover | null) => {
        const label = hoverLabelRef.current;
        if (!label) return;

        label.dataset.visible = hover ? 'true' : 'false';

        if (!hover) return;

        label.textContent = hover.text;

        const bounds = label.parentElement?.getBoundingClientRect();
        const width = label.offsetWidth;
        const height = label.offsetHeight;
        const areaWidth = bounds?.width ?? Infinity;
        const fitsRight = hover.x + LABEL_GAP + width <= areaWidth - LABEL_INSET;
        const fitsAbove = hover.y - LABEL_GAP - height >= LABEL_INSET;
        const preferredX = fitsRight ? hover.x + LABEL_GAP : hover.x - LABEL_GAP - width;
        const preferredY = fitsAbove ? hover.y - LABEL_GAP - height : hover.y + LABEL_GAP * 1.5;
        const x = Math.min(Math.max(LABEL_INSET, preferredX), areaWidth - width - LABEL_INSET);

        label.style.transform = `translate3d(${x}px, ${preferredY}px, 0)`;
    }, []);

    return (
        <div className={classNames('auditorium', className)}>
            {fontFamily && (
                <SceneCanvas
                    fallback={
                        <AuditoriumFallback
                            zones={props.zones}
                            highlightedZone={props.highlightedZone}
                            eventName={props.eventName}
                            variant={props.variant}
                        />
                    }
                    camera={{
                        fov: AUDITORIUM_CAMERA.fov,
                        near: 0.1,
                        far: 1000,
                        position: [0, 15, 21],
                    }}
                    shadows
                    transparent
                    isStill={prefersReducedMotion}
                    isLowPowerOnMobile
                    onFirstFrame={onFirstFrame}
                >
                    <AuditoriumContents
                        {...props}
                        onSeatHover={showSeatHover}
                        fontFamily={fontFamily}
                        isStill={prefersReducedMotion}
                    />
                </SceneCanvas>
            )}
            <div
                ref={hoverLabelRef}
                className="auditorium-seat-tooltip"
                data-visible="false"
                aria-hidden="true"
            />
        </div>
    );
}
