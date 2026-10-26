import {
    ClampToEdgeWrapping,
    DirectionalLight,
    DoubleSide,
    Group,
    HemisphereLight,
    Mesh,
    MeshBasicMaterial,
    MeshLambertMaterial,
    NeutralToneMapping,
    NoColorSpace,
    PlaneGeometry,
    Raycaster,
    Vector2,
    Vector3,
    type BufferGeometry,
    type CanvasTexture,
    type PerspectiveCamera,
    type Scene,
    type WebGLRenderer,
} from 'three';
import {
    canvasTexture,
    mergeAndDispose,
    readFontFamily,
    seededRandom,
    waitForFonts,
} from '@/components/scenes/geometry';
import {
    fitFov,
    fitSeatingShot,
    laneFrameEdges,
    SEATING_SHOTS,
    type SeatingFocus,
    type SeatingShot,
} from '@/components/scenes/paradeCamera';
import {
    buildHotspots,
    ENCLOSURE_X,
    LANE_Z,
    MARCH_SPEED,
    pickHotspot,
    SQUAD_LENGTH,
    SQUAD_PASS,
    SQUAD_PASS_SECONDS,
    squadPass,
    type Hotspot,
} from '@/components/scenes/paradeLayout';
import {
    buildEnclosureParts,
    buildSeatedGuests,
    drawBoard,
    drawValance,
    ENCLOSURE_BOARD,
    enclosureBoardLines,
    TRICOLOUR,
} from '@/components/scenes/ParadeWorld/paradeEnclosures';
import { buildSquad } from '@/components/scenes/ParadeWorld/paradeFigures';
import { WORLD_LAYERS } from '@/components/scenes/ParadeWorld/paradeScenery';
import { SUN_DIRECTION } from '@/components/scenes/ParadeWorld/paradeSky';
import type { EventZone, ZoneName } from '@/types/booking';

export type LiveSeatingState = {
    isLowPower: boolean;
    squad: 'marching' | 'parked';
    shot: SeatingFocus;
};

export type SeatingInput = {
    zones: EventZone[];
    ownZone: ZoneName | null;
    focusedZone: ZoneName | null;
    isLowPower: boolean;
};

export type SeatingEvents = {
    onHoverZone: (zone: ZoneName | null, anchor: { x: number; y: number } | null) => void;
    onReady: () => void;
    onStateChange: (state: LiveSeatingState) => void;
    onStillChange: (isStill: boolean) => void;
};

export type SeatingRuntime = {
    update: (input: SeatingInput) => void;
    frame: (delta: number) => void;
    resize: (width: number, height: number) => void;
    dispose: () => void;
};

type Disposable = { dispose: () => void };

type Enclosures = {
    group: Group;
    outlines: Partial<Record<ZoneName, Mesh>>;
    textures: CanvasTexture[];
    dispose: () => void;
};

type Fonts = { serif: string; sans: string };

const GROUND = { minX: -50, maxX: 50, minZ: -88, maxZ: -30 };
const GROUND_COLOR = '#ffffff';
const GROUND_FADE = { centerX: 0, centerZ: -58, radiusX: 44, radiusZ: 27, solidShare: 0.55 };
const FRAME_MARGIN = 0.85;
const SQUAD_MAX_X = 100;
const GROUND_GLOW = 0x7a7a78;
const MODEL_CENTER_Z = -64;
const OUTLINE_WIDTH = 0.3;
const OUTLINE_FADE_SECONDS = 0.2;
const CAMERA_EASE_SECONDS = 1.2;
const SPRING_BACK_SECONDS = 0.6;
const DRAG_THRESHOLD_PX = 4;
const DRAG_RADIANS_PER_PX = 0.005;
const MAX_YAW = (25 * Math.PI) / 180;
const FONT_TIMEOUT_MS = 2500;
const SEAT_SEED = 20261115;
const SUN_TARGET = new Vector3(0, 0, -62);
const SHADOW_HALF_EXTENT = 62;
const MAX_DELTA_SECONDS = 0.1;
const WAKE_MARGIN_MS = 50;
const ZONES: ZoneName[] = ['C', 'D'];

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function groundTextures(hotspots: Hotspot[]): { map: CanvasTexture; alpha: CanvasTexture } {
    const width = 512;
    const height = Math.round((width * (GROUND.maxZ - GROUND.minZ)) / (GROUND.maxX - GROUND.minX));
    const toCanvasX = (x: number) => ((x - GROUND.minX) / (GROUND.maxX - GROUND.minX)) * width;
    const toCanvasY = (z: number) => ((z - GROUND.minZ) / (GROUND.maxZ - GROUND.minZ)) * height;

    const map = canvasTexture(width, height, (context) => {
        context.fillStyle = GROUND_COLOR;
        context.fillRect(0, 0, width, height);
        context.filter = 'blur(6px)';
        context.fillStyle = 'rgba(27, 28, 32, 0.22)';

        for (const hotspot of hotspots) {
            const { min, max } = hotspot.boxes[0];
            const left = toCanvasX(min.x + 0.7);
            const top = toCanvasY(min.z);

            context.fillRect(
                left,
                top,
                toCanvasX(max.x - 0.7) - left,
                toCanvasY(max.z - 1.2) - top,
            );
        }
    });
    map.wrapS = ClampToEdgeWrapping;
    map.wrapT = ClampToEdgeWrapping;

    const alpha = canvasTexture(256, 148, (context, alphaWidth, alphaHeight) => {
        const image = context.createImageData(alphaWidth, alphaHeight);

        for (let y = 0; y < alphaHeight; y += 1) {
            for (let x = 0; x < alphaWidth; x += 1) {
                const worldX = GROUND.minX + ((x + 0.5) / alphaWidth) * (GROUND.maxX - GROUND.minX);
                const worldZ =
                    GROUND.minZ + ((y + 0.5) / alphaHeight) * (GROUND.maxZ - GROUND.minZ);
                const distance = Math.hypot(
                    (worldX - GROUND_FADE.centerX) / GROUND_FADE.radiusX,
                    (worldZ - GROUND_FADE.centerZ) / GROUND_FADE.radiusZ,
                );
                const fade = clamp((1 - distance) / (1 - GROUND_FADE.solidShare), 0, 1);
                const value = Math.round(255 * smoothstep(fade));

                image.data.set([value, value, value, 255], (y * alphaWidth + x) * 4);
            }
        }

        context.putImageData(image, 0, 0);
    });
    alpha.colorSpace = NoColorSpace;
    alpha.wrapS = ClampToEdgeWrapping;
    alpha.wrapT = ClampToEdgeWrapping;

    return { map, alpha };
}

function outlineGeometry(hotspot: Hotspot): BufferGeometry {
    const { min, max } = hotspot.boxes[0];
    const width = max.x - min.x;
    const depth = max.z - min.z;
    const centerX = (min.x + max.x) / 2;
    const centerZ = (min.z + max.z) / 2;
    const strip = (length: number, isAlongX: boolean, x: number, z: number) => {
        const geometry = new PlaneGeometry(
            isAlongX ? length : OUTLINE_WIDTH,
            isAlongX ? OUTLINE_WIDTH : length,
        );
        geometry.rotateX(-Math.PI / 2);

        return geometry.translate(x, 0.07, z);
    };

    return mergeAndDispose([
        strip(width + OUTLINE_WIDTH, true, centerX, min.z),
        strip(width + OUTLINE_WIDTH, true, centerX, max.z),
        strip(depth, false, min.x, centerZ),
        strip(depth, false, max.x, centerZ),
    ]);
}

function buildEnclosures(
    zones: EventZone[],
    ownZone: ZoneName | null,
    hotspots: Hotspot[],
    fonts: Fonts,
    anisotropy: number,
): Enclosures {
    const group = new Group();
    const trash: Disposable[] = [];
    const textures: CanvasTexture[] = [];
    const keep = <Item extends Disposable>(item: Item): Item => {
        trash.push(item);
        return item;
    };
    const keepTexture = (texture: CanvasTexture) => {
        textures.push(texture);
        return keep(texture);
    };
    const { layouts, parts } = buildEnclosureParts(zones);
    const outlines: Partial<Record<ZoneName, Mesh>> = {};
    const [boardWidth, boardHeight] = ENCLOSURE_BOARD.pixels;

    for (const zone of zones) {
        const zoneParts = parts[zone.name];
        if (!zoneParts) continue;

        const isOwn = zone.name === ownZone;
        const solid = new Mesh(
            keep(mergeAndDispose(zoneParts.solid)),
            keep(new MeshLambertMaterial({ vertexColors: true })),
        );
        const fabric = new Mesh(
            keep(mergeAndDispose(zoneParts.fabric)),
            keep(new MeshLambertMaterial({ color: 0xffffff, side: DoubleSide })),
        );
        const valanceTexture = keepTexture(
            canvasTexture(256, 64, (context, width) =>
                drawValance(context, width, isOwn ? TRICOLOUR : ['#ffffff']),
            ),
        );
        valanceTexture.wrapT = ClampToEdgeWrapping;
        const valance = new Mesh(
            keep(mergeAndDispose(zoneParts.valance)),
            keep(
                new MeshLambertMaterial({ map: valanceTexture, alphaTest: 0.5, side: DoubleSide }),
            ),
        );
        const boardTexture = keepTexture(
            canvasTexture(
                boardWidth,
                boardHeight,
                (context) =>
                    drawBoard(
                        context,
                        boardWidth,
                        boardHeight,
                        enclosureBoardLines(zone, fonts),
                        isOwn,
                    ),
                { anisotropy },
            ),
        );
        const board = new Mesh(
            keep(new PlaneGeometry(ENCLOSURE_BOARD.width, ENCLOSURE_BOARD.height)),
            keep(new MeshLambertMaterial({ map: boardTexture })),
        );

        board.position.set(
            ENCLOSURE_X[zone.name] + ENCLOSURE_BOARD.offsetX,
            ENCLOSURE_BOARD.y,
            ENCLOSURE_BOARD.z,
        );
        for (const mesh of [solid, fabric, board]) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
        }
        group.add(solid, fabric, valance, board);

        const hotspot = hotspots.find((candidate) => candidate.view === zone.name);
        if (!hotspot) continue;

        const outline = new Mesh(
            keep(outlineGeometry(hotspot)),
            keep(
                new MeshBasicMaterial({
                    color: 0x2b2c30,
                    transparent: true,
                    opacity: 0,
                    depthWrite: false,
                }),
            ),
        );
        outline.visible = false;
        outlines[zone.name] = outline;
        group.add(outline);
    }

    const seated = buildSeatedGuests(layouts, seededRandom(SEAT_SEED));
    group.add(seated.chairs, seated.clothing, seated.skin);

    return {
        group,
        outlines,
        textures,
        dispose: () => {
            for (const item of trash) item.dispose();
            seated.dispose();
        },
    };
}

export function createSeatingRuntime({
    renderer,
    scene,
    camera,
    invalidate,
    events,
}: {
    renderer: WebGLRenderer;
    scene: Scene;
    camera: PerspectiveCamera;
    invalidate: () => void;
    events: SeatingEvents;
}): SeatingRuntime {
    const trash: Disposable[] = [];
    const pivot = new Group();
    const model = new Group();
    const hemisphere = new HemisphereLight(0xffffff, 0xd6d4cf, 0.8);
    const sun = new DirectionalLight(0xfff4e6, 3);
    const squad = buildSquad(SQUAD_PASS.entryX, LANE_Z);
    const raycaster = new Raycaster();
    const pointerNdc = new Vector2();
    const hit = new Vector3();
    const anchor = new Vector3();
    const easeFrom = new Vector3();
    const easeTo = new Vector3();
    const element = renderer.domElement;
    const holder = element.parentElement;
    let input: SeatingInput = { zones: [], ownZone: null, focusedZone: null, isLowPower: false };
    let builtKey = '';
    let groundKey = '';
    let hotspots: Hotspot[] = [];
    let ground: Mesh | null = null;
    let fonts: Fonts | null = null;
    let enclosures: Enclosures | null = null;
    let isReady = false;
    let isDisposed = false;
    let isStill = false;
    let passStartedAt = 0;
    let passSeconds = SQUAD_PASS_SECONDS;
    let squadTimer = 0;
    let reported = '';
    let hoveredZone: ZoneName | null = null;
    let goalShot: SeatingFocus = 'overview';
    let settledShot: SeatingFocus = 'overview';
    let shot = { from: SEATING_SHOTS.overview, to: SEATING_SHOTS.overview, startedAt: -Infinity };
    let aspect = 1;
    let fittedKey = '';
    let fittedShot: SeatingShot = SEATING_SHOTS.overview;
    let yaw = 0;
    let springFrom = 0;
    let springStartedAt = -Infinity;
    const drag = { isDown: false, isDragging: false, startX: 0, startYaw: 0 };
    const outlineOpacity: Record<ZoneName, number> = { C: 0, D: 0 };

    const goalFrame = (): SeatingShot => {
        const key = `${goalShot}|${aspect.toFixed(3)}|${builtKey}`;
        if (key === fittedKey) return fittedShot;

        const framed = hotspots.filter(
            (hotspot) => goalShot === 'overview' || hotspot.view === goalShot,
        );
        const points: SeatingShot['position'][] = framed.flatMap((hotspot) => {
            const { min, max } = hotspot.boxes[0];
            const laneX = (min.x + max.x) / 2;

            return [
                [min.x, 0, min.z],
                [max.x, 0, min.z],
                [min.x, max.y, min.z],
                [max.x, max.y, min.z],
                [min.x, 0, max.z],
                [max.x, 0, max.z],
                [laneX, 0, LANE_Z + 3],
            ];
        });

        fittedKey = key;
        fittedShot =
            points.length > 0
                ? fitSeatingShot(SEATING_SHOTS[goalShot], points, aspect, FRAME_MARGIN)
                : SEATING_SHOTS[goalShot];

        return fittedShot;
    };

    const wake = () => {
        window.clearTimeout(squadTimer);
        if (isStill) {
            isStill = false;
            events.onStillChange(false);
        }
        invalidate();
    };

    const rebuildGround = () => {
        if (ground) {
            model.remove(ground);
            ground.geometry.dispose();
            const material = ground.material as MeshLambertMaterial;
            material.map?.dispose();
            material.alphaMap?.dispose();
            material.dispose();
        }

        const textures = groundTextures(hotspots);
        ground = new Mesh(
            new PlaneGeometry(GROUND.maxX - GROUND.minX, GROUND.maxZ - GROUND.minZ),
            new MeshLambertMaterial({
                map: textures.map,
                alphaMap: textures.alpha,
                emissive: GROUND_GLOW,
                emissiveMap: textures.map,
                transparent: true,
                depthWrite: false,
            }),
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.set((GROUND.minX + GROUND.maxX) / 2, 0, (GROUND.minZ + GROUND.maxZ) / 2);
        ground.receiveShadow = true;
        ground.renderOrder = -1;
        model.add(ground);
    };

    const planPass = (now: number) => {
        const { left, right } = laneFrameEdges(goalFrame(), aspect, LANE_Z);
        const entryX = clamp(left, -SQUAD_MAX_X, 0);
        const exitX = clamp(right, 0, SQUAD_MAX_X);

        squad.group.position.x = entryX - SQUAD_PASS.entryX;
        passSeconds = (exitX - entryX + SQUAD_LENGTH) / MARCH_SPEED;
        passStartedAt = now;
    };

    const finishWarmUp = () => {
        if (isDisposed) return;

        pivot.visible = true;
        isReady = true;
        planPass(performance.now());
        renderer.shadowMap.needsUpdate = true;
        wake();
        requestAnimationFrame(() => {
            if (!isDisposed) events.onReady();
        });
    };

    const rebuild = () => {
        if (!fonts || input.zones.length === 0) return;

        const key = JSON.stringify([input.zones, input.ownZone]);
        if (key === builtKey) return;

        const capacityKey = JSON.stringify(input.zones.map((zone) => zone.capacity));

        builtKey = key;
        hotspots = buildHotspots(input.zones, '').filter(
            (hotspot) => hotspot.view === 'C' || hotspot.view === 'D',
        );
        if (capacityKey !== groundKey) {
            groundKey = capacityKey;
            rebuildGround();
        }

        const previous = enclosures;
        enclosures = buildEnclosures(
            input.zones,
            input.ownZone,
            hotspots,
            fonts,
            renderer.capabilities.getMaxAnisotropy(),
        );
        model.add(enclosures.group);
        if (previous) {
            model.remove(previous.group);
            previous.dispose();
        }
        goalShot = input.ownZone ?? 'overview';
        renderer.shadowMap.needsUpdate = true;

        if (isReady) {
            wake();
            return;
        }

        for (const texture of enclosures.textures) renderer.initTexture(texture);
        if (ground) {
            const material = ground.material as MeshLambertMaterial;
            for (const texture of [material.map, material.alphaMap])
                if (texture) renderer.initTexture(texture);
        }

        if (renderer.extensions.has('KHR_parallel_shader_compile')) {
            void renderer.compileAsync(scene, camera).then(finishWarmUp);
        } else {
            renderer.compile(scene, camera);
            finishWarmUp();
        }
    };

    const setHovered = (zone: ZoneName | null) => {
        if (zone === hoveredZone) return;

        hoveredZone = zone;
        wake();

        const box = hotspots.find((candidate) => candidate.view === zone)?.boxes[0];
        if (!zone || !box) {
            events.onHoverZone(null, null);
            return;
        }

        anchor.set((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
        anchor.project(camera);
        events.onHoverZone(zone, {
            x: ((anchor.x + 1) / 2) * element.clientWidth,
            y: ((1 - anchor.y) / 2) * element.clientHeight,
        });
    };

    const onHoverMove = (event: PointerEvent) => {
        if (!isReady || drag.isDown || event.pointerType === 'touch') return;

        const rect = element.getBoundingClientRect();
        pointerNdc.set(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(pointerNdc, camera);

        const picked = pickHotspot(raycaster.ray, hotspots, hit);
        setHovered((picked?.view as ZoneName | undefined) ?? null);
    };

    const onDragMove = (event: PointerEvent) => {
        if (!drag.isDown) return;

        const dx = event.clientX - drag.startX;

        if (!drag.isDragging && Math.abs(dx) > DRAG_THRESHOLD_PX) {
            drag.isDragging = true;
            holder?.classList.add('live-seating-dragging');
            setHovered(null);
        }
        if (!drag.isDragging) return;

        yaw = clamp(drag.startYaw + dx * DRAG_RADIANS_PER_PX, -MAX_YAW, MAX_YAW);
        springStartedAt = -Infinity;
        wake();
    };

    const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || !isReady) return;

        if (event.pointerType === 'mouse') event.preventDefault();
        element.setPointerCapture(event.pointerId);

        Object.assign(drag, {
            isDown: true,
            isDragging: false,
            startX: event.clientX,
            startYaw: yaw,
        });
    };

    const onPointerUp = () => {
        if (drag.isDragging) {
            springFrom = yaw;
            springStartedAt = performance.now();
            holder?.classList.remove('live-seating-dragging');
            wake();
        }
        drag.isDown = false;
        drag.isDragging = false;
    };

    const onPointerLeave = () => setHovered(null);

    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.autoUpdate = false;
    camera.layers.enable(WORLD_LAYERS.detail);

    sun.position.copy(SUN_TARGET).addScaledVector(SUN_DIRECTION, 120);
    sun.target.position.copy(SUN_TARGET);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
        left: -SHADOW_HALF_EXTENT,
        right: SHADOW_HALF_EXTENT,
        top: SHADOW_HALF_EXTENT,
        bottom: -SHADOW_HALF_EXTENT,
        near: 1,
        far: 300,
    });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 2.4;
    sun.shadow.intensity = 0.82;

    squad.shadows.visible = false;
    trash.push(squad, sun);
    pivot.position.set(0, 0, MODEL_CENTER_Z);
    model.position.set(0, 0, -MODEL_CENTER_Z);
    model.add(squad.group);
    pivot.add(model);
    pivot.visible = false;
    scene.add(hemisphere, sun, sun.target, pivot);

    holder?.classList.add('live-seating-grabbable');
    element.addEventListener('pointermove', onHoverMove);
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointerleave', onPointerLeave);
    element.addEventListener('lostpointercapture', onPointerUp);
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    const serif = readFontFamily('--font-serif', 'Georgia, serif');
    const sans = readFontFamily('--font-geist-sans', 'system-ui, sans-serif');

    void waitForFonts(
        [`600 220px ${serif.primary}`, `500 52px ${sans.primary}`],
        FONT_TIMEOUT_MS,
    ).then(() => {
        if (isDisposed) return;

        fonts = { serif: serif.stack, sans: sans.stack };
        rebuild();
    });

    return {
        update: (next) => {
            const hasQualityChanged = next.isLowPower !== input.isLowPower;
            const hasFocusChanged = next.focusedZone !== input.focusedZone;

            input = next;
            rebuild();
            if (hasQualityChanged) reported = '';
            if (hasQualityChanged || hasFocusChanged) wake();
        },
        resize: (width, height) => {
            aspect = width / Math.max(height, 1);
            wake();
        },
        frame: (rawDelta) => {
            if (!isReady) return;

            const delta = Math.min(rawDelta, MAX_DELTA_SECONDS);
            const now = performance.now();
            if ((now - passStartedAt) / 1000 >= passSeconds + SQUAD_PASS.pauseSeconds) {
                planPass(now);
            }

            const pass = squadPass((now - passStartedAt) / 1000, passSeconds);

            squad.marchTime.value = pass.marchTime;

            const goal = goalFrame();

            if (shot.to !== goal) {
                const isFirstFrame =
                    shot.startedAt === -Infinity && shot.to === SEATING_SHOTS.overview;

                shot = {
                    from: isFirstFrame
                        ? goal
                        : {
                              position: camera.position.toArray() as SeatingShot['position'],
                              target: shot.to.target,
                              fov: shot.to.fov,
                          },
                    to: goal,
                    startedAt: isFirstFrame ? -Infinity : now,
                };
            }

            const easeProgress = clamp((now - shot.startedAt) / (CAMERA_EASE_SECONDS * 1000), 0, 1);
            const eased = smoothstep(easeProgress);
            const fov = fitFov(shot.from.fov + (shot.to.fov - shot.from.fov) * eased, aspect);

            camera.position.lerpVectors(
                easeFrom.fromArray(shot.from.position),
                easeTo.fromArray(shot.to.position),
                eased,
            );
            camera.lookAt(
                easeFrom.fromArray(shot.from.target).lerp(easeTo.fromArray(shot.to.target), eased),
            );
            if (Math.abs(camera.fov - fov) > 1e-3 || camera.aspect !== aspect) {
                camera.fov = fov;
                camera.aspect = aspect;
                camera.updateProjectionMatrix();
            }

            const isEasing = easeProgress < 1;
            if (!isEasing) settledShot = goalShot;

            const isSpringing = springStartedAt > 0;
            if (isSpringing) {
                const springProgress = clamp(
                    (now - springStartedAt) / (SPRING_BACK_SECONDS * 1000),
                    0,
                    1,
                );

                yaw = springFrom * (1 - smoothstep(springProgress));
                if (springProgress >= 1) springStartedAt = -Infinity;
            }
            pivot.rotation.y = yaw;
            if (yaw !== 0 || isSpringing) renderer.shadowMap.needsUpdate = true;

            const outlineZone = hoveredZone ?? input.focusedZone;
            let isFading = false;

            for (const zone of ZONES) {
                const goal = zone === outlineZone ? 1 : 0;
                const current = outlineOpacity[zone];
                const step = delta / OUTLINE_FADE_SECONDS;
                const next =
                    goal > current
                        ? Math.min(goal, current + step)
                        : Math.max(goal, current - step);
                const outline = enclosures?.outlines[zone];

                outlineOpacity[zone] = next;
                if (next !== goal) isFading = true;
                if (!outline) continue;

                (outline.material as MeshBasicMaterial).opacity = next;
                outline.visible = next > 0;
            }

            const squadState = pass.isMarching ? 'marching' : 'parked';
            const report = `${input.isLowPower}|${squadState}|${settledShot}`;

            if (report !== reported) {
                reported = report;
                events.onStateChange({
                    isLowPower: input.isLowPower,
                    squad: squadState,
                    shot: settledShot,
                });
            }

            const isBusy =
                pass.isMarching ||
                drag.isDragging ||
                isSpringing ||
                yaw !== 0 ||
                isEasing ||
                isFading;

            if (isBusy || isStill) return;

            isStill = true;
            events.onStillChange(true);
            squadTimer = window.setTimeout(wake, pass.secondsToChange * 1000 + WAKE_MARGIN_MS);
        },
        dispose: () => {
            isDisposed = true;
            window.clearTimeout(squadTimer);
            holder?.classList.remove('live-seating-grabbable', 'live-seating-dragging');
            element.removeEventListener('pointermove', onHoverMove);
            element.removeEventListener('pointerdown', onPointerDown);
            element.removeEventListener('pointerleave', onPointerLeave);
            element.removeEventListener('lostpointercapture', onPointerUp);
            window.removeEventListener('pointermove', onDragMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
            scene.remove(hemisphere, sun, sun.target, pivot);
            enclosures?.dispose();
            if (ground) {
                const material = ground.material as MeshLambertMaterial;
                ground.geometry.dispose();
                material.map?.dispose();
                material.alphaMap?.dispose();
                material.dispose();
            }
            for (const item of trash) item.dispose();
            model.clear();
        },
    };
}
