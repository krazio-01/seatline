import {
    Color,
    DirectionalLight,
    Fog,
    Group,
    HemisphereLight,
    MathUtils,
    NeutralToneMapping,
    PCFShadowMap,
    Texture,
    Vector2,
    Vector3,
    type Mesh,
    type PerspectiveCamera,
    type Scene,
    type WebGLRenderer,
} from 'three';
import {
    anchorScroll,
    fitFov,
    interpolateShots,
    readoutValues,
    SHOTS,
    type ReadoutClock,
    type Shot,
    type ShotAlign,
    type ShotAnchor,
    type ShotName,
} from '@/components/scenes/paradeCamera';
import {
    detectTier,
    qualityFor,
    recordFrame,
    stepQuality,
    type GovernorState,
    type Quality,
    type Tier,
} from '@/components/scenes/paradeQuality';
import { readFontFamily, waitForFonts } from '@/components/scenes/geometry';
import { buildEffects, type ParadeEffects } from '@/components/scenes/ParadeWorld/paradeEffects';
import { buildFigures } from '@/components/scenes/ParadeWorld/paradeFigures';
import { createFlypast } from '@/components/scenes/ParadeWorld/paradeFlypast';
import { createInteraction } from '@/components/scenes/ParadeWorld/paradeInteraction';
import { buildScenery, WORLD_LAYERS } from '@/components/scenes/ParadeWorld/paradeScenery';
import {
    buildSky,
    FAR_GROUND_COLORS,
    SKY_PALETTES,
    SUN_DIRECTION,
} from '@/components/scenes/ParadeWorld/paradeSky';
import type { Point3 } from '@/components/scenes/seatLayout';
import type { EventZone } from '@/types/booking';

export type ParadeWorldData = {
    zones: EventZone[];
    eventName: string;
    eventYear: string;
    paradeBegins: string;
    clock: ReadoutClock & { paradeMinutes: number };
};

export type RuntimeOptions = {
    renderer: WebGLRenderer;
    scene: Scene;
    camera: PerspectiveCamera;
    data: ParadeWorldData;
    overlay: HTMLElement;
    setPixelRatio: (pixelRatio: number) => void;
};

export type ParadeRuntime = {
    frame: (delta: number) => void;
    resize: (width: number, height: number) => void;
    dispose: () => void;
};

const TIER_OVERRIDE_KEY = 'paradeTier';
const CONSTRAINED_QUERY = '(pointer: coarse), (max-width: 760px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const FONT_TIMEOUT_MS = 2500;
const MAX_DELTA_SECONDS = 0.1;
const SETTLED_GAP = 1e-3;
const NUMERIC_KEYS = ['fov', 'dark', 'bloom', 'tilt', 'fogNear', 'fogFar'] as const;
const SUN_TARGET = new Vector3(0, 0, -38);
const SHADOW_EXTENT = 95;
const SUN_COLORS = { day: 0xffe2bd, night: 0xffd2a6 };
const AUTO_FLYPAST_DELAY_SECONDS = 1.6;
const GLANCE_PULL = 0.45;
const PORTRAIT_LIFT = 0.16;
const FLYPAST_MAX_DELTA_SECONDS = 0.5;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = MathUtils.lerp;
const gap = (a: Point3, b: Point3) =>
    Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

function readTier(renderer: WebGLRenderer, isConstrained: boolean): Tier {
    const override =
        process.env.NODE_ENV !== 'production' ? localStorage.getItem(TIER_OVERRIDE_KEY) : null;
    if (override === 'high' || override === 'balanced' || override === 'lite') return override;

    const context = renderer.getContext();
    const debugInfo = context.getExtension('WEBGL_debug_renderer_info');
    const gpu = String(
        context.getParameter(debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : context.RENDERER),
    );
    const hints = navigator as Navigator & { deviceMemory?: number };

    return detectTier({
        gpu,
        memory: hints.deviceMemory ?? 8,
        cores: navigator.hardwareConcurrency ?? 8,
        isConstrained,
    });
}

function measureAnchors(): ShotAnchor[] {
    const maxScroll = document.documentElement.scrollHeight - innerHeight;
    const markers = [...document.querySelectorAll<HTMLElement>('[data-shot]')];
    const anchors = markers.map((marker) => {
        const host = marker.hidden && marker.parentElement ? marker.parentElement : marker;
        const top = host.getBoundingClientRect().top + scrollY;

        return {
            name: marker.dataset.shot as ShotName,
            at: anchorScroll(
                (marker.dataset.align ?? 'center') as ShotAlign,
                top,
                host.offsetHeight,
                innerHeight,
                maxScroll,
            ),
        };
    });

    return anchors.sort((a, b) => a.at - b.at);
}

export async function createParadeRuntime(options: RuntimeOptions): Promise<ParadeRuntime> {
    const { renderer, scene, camera, data, overlay } = options;
    const readout = {
        altitude: overlay.querySelector<HTMLElement>('[data-readout="altitude"]'),
        heading: overlay.querySelector<HTMLElement>('[data-readout="heading"]'),
        clock: overlay.querySelector<HTMLElement>('[data-readout="clock"]'),
    };
    const isConstrained = matchMedia(CONSTRAINED_QUERY).matches;
    const tier = readTier(renderer, isConstrained);
    const governor: GovernorState = {
        quality: {
            ...qualityFor(tier, isConstrained),
            isCalm: matchMedia(REDUCED_MOTION_QUERY).matches,
        },
        pixelRatio: Math.min(devicePixelRatio, qualityFor(tier, isConstrained).pixelRatio),
        frameCost: 16.7,
        cpuCost: 4,
        renderedFrames: 0,
        lastAdjust: 0,
        refreshInterval: Infinity,
        pixelRatioCeiling: Math.min(devicePixelRatio, qualityFor(tier, isConstrained).pixelRatio),
    };
    const applyPixelRatio = (pixelRatio: number) => {
        options.setPixelRatio(pixelRatio);
        document.documentElement.dataset.worldPixelRatio = String(pixelRatio);
    };
    const quality = (): Quality => governor.quality;

    document.documentElement.dataset.worldTier = tier;
    applyPixelRatio(governor.pixelRatio);

    renderer.toneMapping = NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    camera.near = 0.3;
    camera.far = 6000;
    camera.layers.enable(WORLD_LAYERS.detail);
    camera.layers.enable(WORLD_LAYERS.shadow);
    scene.fog = new Fog(0x05070a, 300, 1500);

    const sky = buildSky(renderer);
    scene.add(sky.group);

    const serif = readFontFamily('--font-serif', 'Georgia, serif');
    const sans = readFontFamily('--font-geist-sans', 'system-ui, sans-serif');
    await waitForFonts(
        [`600 220px ${serif.primary}`, `500 210px ${serif.primary}`, `500 52px ${sans.primary}`],
        FONT_TIMEOUT_MS,
    );

    const scenery = buildScenery({
        zones: data.zones,
        eventName: data.eventName,
        eventYear: data.eventYear,
        paradeMinutes: data.clock.paradeMinutes,
        trees: quality().trees,
        serifFamily: serif.stack,
        sansFamily: sans.stack,
        anisotropy: renderer.capabilities.getMaxAnisotropy(),
    });
    const figures = buildFigures();
    figures.shadows.visible = quality().movingShadows;

    const paradeGround = new Group();
    paradeGround.add(scenery.group, figures.group);
    scene.add(paradeGround);

    const hemisphere = new HemisphereLight(0xdde9f8, 0xd9ccb2, 0.85);
    const sun = new DirectionalLight(SUN_COLORS.day, 3.3);
    sun.target.position.copy(SUN_TARGET);
    sun.position.copy(SUN_TARGET).addScaledVector(SUN_DIRECTION, 240);
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality().shadowSize, quality().shadowSize);
    Object.assign(sun.shadow.camera, {
        left: -SHADOW_EXTENT,
        right: SHADOW_EXTENT,
        top: SHADOW_EXTENT,
        bottom: -SHADOW_EXTENT,
        near: 20,
        far: 520,
    });
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 2.4;
    sun.shadow.intensity = 0.9;
    const rim = new DirectionalLight(0xc9d8ff, 0.9);
    rim.position.set(-220, 260, -320);
    scene.add(hemisphere, sun, sun.target, rim);

    const effects: ParadeEffects | null = quality().post
        ? buildEffects(
              renderer,
              scene,
              camera,
              [
                  figures.cadets,
                  figures.shadows,
                  ...scenery.garden.shadowCasters,
                  ...scenery.garden.leafCanopies,
              ],
              quality().samples,
          )
        : null;

    const canvasSize = renderer.getSize(new Vector2());
    let anchors = measureAnchors();
    let viewport = { width: canvasSize.x, height: canvasSize.y };
    let visibleWindows = 0;
    let elapsed = 0;
    let wallTime = 0;
    let hasRendered = false;
    let shadowsDirty = true;
    let wasParadeVisible = false;
    let isRunning = true;

    const goal: Shot = structuredClone(SHOTS.hero);
    const current: Shot = structuredClone(SHOTS.hero);
    current.position = [
        SHOTS.hero.position[0],
        SHOTS.hero.position[1] - 70,
        SHOTS.hero.position[2] + 170,
    ];
    current.target = [SHOTS.hero.target[0], SHOTS.hero.target[1] - 40, SHOTS.hero.target[2]];

    const pointer = { smoothX: 0, smoothY: 0 };
    const target = new Vector3();
    const lookDirection = new Vector3();
    const cameraRight = new Vector3();
    const cameraUp = new Vector3();
    const readoutState = { altitude: '', heading: '', clock: '' };

    let maxScroll = Math.max(document.documentElement.scrollHeight - innerHeight, 1);
    const remeasure = () => {
        anchors = measureAnchors();
        maxScroll = Math.max(document.documentElement.scrollHeight - innerHeight, 1);
    };
    const applyAtmosphere = () => {
        const dark = current.dark;
        const isNight = dark > 0.5;
        const uniforms = sky.sky.material.uniforms;

        uniforms.uTop.value.lerpColors(SKY_PALETTES.day.top, SKY_PALETTES.night.top, dark);
        uniforms.uHorizon.value.lerpColors(
            SKY_PALETTES.day.horizon,
            SKY_PALETTES.night.horizon,
            dark,
        );
        uniforms.uBottom.value.lerpColors(SKY_PALETTES.day.bottom, SKY_PALETTES.night.bottom, dark);
        uniforms.uSunStrength.value = Math.pow(1 - dark, 2) * 0.18;
        uniforms.uGlow.value = Math.sin(dark * Math.PI) * 0.06 + dark * 0.03;

        const fog = scene.fog as Fog;
        fog.color.copy(uniforms.uHorizon.value as Color);
        fog.near = current.fogNear;
        fog.far = current.fogFar;

        scene.environment = isNight ? sky.nightEnvironment : sky.dayEnvironment;
        scene.environmentIntensity = isNight ? 0.55 : 0.35;
        sky.stars.material.opacity = Math.pow(dark, 4) * 0.7;
        hemisphere.intensity = lerp(0.85, 0.15, dark);
        sun.intensity = lerp(3.3, 1.3, dark);
        sun.color.setHex(isNight ? SUN_COLORS.night : SUN_COLORS.day);
        rim.intensity = lerp(0, 1.1, dark);
        renderer.toneMappingExposure = lerp(1.08, 1.05, dark);
        sky.farGround.material.color.lerpColors(
            FAR_GROUND_COLORS.day,
            FAR_GROUND_COLORS.night,
            dark,
        );
        paradeGround.visible = dark < 0.85;
        sky.farGround.visible = dark > 0.3;
        sky.clouds.material.color.setRGB(
            lerp(1, 0.13, dark),
            lerp(1, 0.14, dark),
            lerp(1, 0.17, dark),
        );
        sky.clouds.material.opacity =
            clamp01((camera.position.y - 90) / 40) * lerp(0.85, 0.32, dark);
        sky.clouds.visible = sky.clouds.material.opacity > 0.01;
        scenery.garden.dust.material.uniforms.uOpacity.value = 0.35 * (1 - clamp01(dark / 0.3));
        scenery.garden.dust.material.uniforms.uScale.value = renderer.domElement.height;
        scenery.garden.dust.visible = dark < 0.3;
        scenery.garden.fallingLeaves.material.uniforms.uScale.value = renderer.domElement.height;
        scenery.garden.fallingLeaves.visible = dark < 0.3;

        for (const formation of sky.formations) {
            formation.group.visible = isNight;
            formation.setPointScale(renderer.domElement.height * 1.3);
        }
        sky.dayFlypast.setPointScale(renderer.domElement.height * 1.3);

        if (!effects) return;

        const tilt = current.tilt * (1 - dark);
        effects.aoPass.enabled = quality().ao && dark < 0.3;
        effects.bloom.strength = current.bloom * smooth(clamp01((dark - 0.15) / 0.5));
        effects.bloom.enabled = effects.bloom.strength > 0.02;
        effects.tiltHorizontal.enabled = tilt > 0.05;
        effects.tiltVertical.enabled = tilt > 0.05;
        effects.tiltHorizontal.uniforms.h.value = tilt / renderer.domElement.width;
        effects.tiltVertical.uniforms.v.value = tilt / renderer.domElement.height;
        effects.tiltHorizontal.uniforms.r.value = 0.5;
        effects.tiltVertical.uniforms.r.value = 0.5;
        effects.film.uniforms.uVignette.value = lerp(0.2, 0.5, dark);
        effects.film.uniforms.uContrast.value = lerp(1.07, 1, dark);
        effects.film.uniforms.uWarmth.value = 1 - dark;
        effects.film.uniforms.uGrain.value = lerp(0.018, 0.03, dark);
        effects.film.uniforms.uTime.value = wallTime;
    };

    const render = () => {
        if (effects && quality().post) effects.composer.render();
        else renderer.render(scene, camera);
    };

    const updateReadout = () => {
        target.set(...current.target);
        lookDirection.set(...current.position);
        const heading = MathUtils.radToDeg(
            Math.atan2(target.x - lookDirection.x, -(target.z - lookDirection.z)),
        );
        const values = readoutValues(camera.position.y, heading, scrollY / maxScroll, data.clock);

        for (const key of ['altitude', 'heading', 'clock'] as const) {
            if (readoutState[key] === values[key]) continue;
            readoutState[key] = values[key];
            const element = readout[key];
            if (element) element.textContent = values[key];
        }
    };

    const applyQualityStep = () => {
        const previous = { ...governor.quality, pixelRatio: governor.pixelRatio };
        if (
            !stepQuality(
                governor,
                wallTime,
                Math.min(devicePixelRatio, qualityFor(tier, isConstrained).pixelRatio),
            )
        )
            return;

        if (governor.pixelRatio !== previous.pixelRatio) {
            applyPixelRatio(governor.pixelRatio);
            effects?.setSize(viewport.width, viewport.height, governor.pixelRatio);
        }
        if (previous.movingShadows && !governor.quality.movingShadows) {
            figures.shadows.visible = false;
            shadowsDirty = true;
        }
    };

    paradeGround.visible = true;
    sky.farGround.visible = true;
    for (const formation of sky.formations) formation.group.visible = true;
    renderer.setRenderTarget(effects ? effects.composer.readBuffer : null);
    if (renderer.extensions.has('KHR_parallel_shader_compile')) {
        await renderer.compileAsync(scene, camera);
    } else {
        renderer.compile(scene, camera);
    }
    renderer.setRenderTarget(null);
    renderer.shadowMap.needsUpdate = true;

    if (effects) {
        effects.setSize(viewport.width, viewport.height, governor.pixelRatio);
        effects.aoPass.enabled = quality().ao;
        effects.bloom.enabled = true;
        effects.tiltHorizontal.enabled = true;
        effects.tiltVertical.enabled = true;
    }

    const textures = new Set<Texture>();
    scene.traverse((object) => {
        const materials = (object as Mesh).material;
        for (const material of Array.isArray(materials) ? materials : [materials]) {
            for (const value of Object.values(material ?? {})) {
                if (value instanceof Texture) textures.add(value);
            }
        }
    });
    for (const texture of textures) renderer.initTexture(texture);

    const opening = structuredClone(current);
    for (const shot of [...Object.values(SHOTS), opening]) {
        Object.assign(current, structuredClone(shot));
        camera.position.set(...shot.position);
        camera.lookAt(target.set(...shot.target));
        applyAtmosphere();
        renderer.shadowMap.needsUpdate = true;
        render();
    }

    const bodyObserver = new ResizeObserver(remeasure);
    bodyObserver.observe(document.body);
    addEventListener('load', remeasure);

    const windowObserver = new IntersectionObserver((entries) => {
        for (const entry of entries)
            entry.target.toggleAttribute('data-world-visible', entry.isIntersecting);
        visibleWindows = document.querySelectorAll('[data-window][data-world-visible]').length;
    });
    for (const element of document.querySelectorAll('[data-window]'))
        windowObserver.observe(element);

    const interaction = createInteraction({
        camera,
        overlay,
        scenery,
        stir: sky.stir,
        zones: data.zones,
        paradeBegins: data.paradeBegins,
        isDaylight: () => paradeGround.visible && goal.dark < 0.2,
        isNight: () => sky.formations[0].group.visible,
        marchTime: () => figures.marchTime.value,
    });

    const flypast = createFlypast({
        formation: sky.dayFlypast,
        canLaunch: () => paradeGround.visible && goal.dark < 0.2,
    });
    let daylightSeconds = 0;
    let hasAutoLaunched = false;

    const frame = (rawDelta: number) => {
        if (!isRunning) return;
        if (renderer.getContext().isContextLost()) {
            isRunning = false;
            interaction.dispose();
            return;
        }

        const frameStart = performance.now();
        const delta = Math.min(rawDelta, MAX_DELTA_SECONDS);
        wallTime += delta;
        if (!quality().isCalm) elapsed += delta;

        interpolateShots(anchors, scrollY, goal);
        interaction.steerGoal(goal);

        if (!hasAutoLaunched && !quality().isCalm && visibleWindows > 0 && goal.dark < 0.01) {
            daylightSeconds += delta;
            if (daylightSeconds > AUTO_FLYPAST_DELAY_SECONDS) {
                hasAutoLaunched = true;
                flypast.launch(false);
            }
        }
        flypast.update(Math.min(rawDelta, FLYPAST_MAX_DELTA_SECONDS));
        const reach = Math.hypot(
            goal.target[0] - goal.position[0],
            goal.target[1] - goal.position[1],
            goal.target[2] - goal.position[2],
        );
        const portrait = interaction.isViewing() ? 0 : clamp01((1 / camera.aspect - 1) / 1.2);
        goal.target[1] += reach * portrait * PORTRAIT_LIFT * (1 - goal.dark);

        const glance = quality().isCalm ? 0 : flypast.glance() * GLANCE_PULL;
        const lead = sky.dayFlypast.lead;
        goal.target[0] = lerp(goal.target[0], lead.x, glance);
        goal.target[1] = lerp(goal.target[1], lead.y, glance);
        goal.target[2] = lerp(goal.target[2], lead.z, glance);

        const ease = 1 - Math.exp(-delta * Math.min(3.2, 0.5 + wallTime * 0.9));
        for (let axis = 0; axis < 3; axis += 1) {
            current.position[axis] = lerp(current.position[axis], goal.position[axis], ease);
            current.target[axis] = lerp(current.target[axis], goal.target[axis], ease);
        }
        for (const key of NUMERIC_KEYS) current[key] = lerp(current[key], goal[key], ease);
        const [pointerX, pointerY] = interaction.pointerOffset();
        pointer.smoothX = lerp(pointer.smoothX, pointerX, 1 - Math.exp(-delta * 2.5));
        pointer.smoothY = lerp(pointer.smoothY, pointerY, 1 - Math.exp(-delta * 2.5));

        const fov = fitFov(current.fov, camera.aspect);
        if (Math.abs(camera.fov - fov) > 0.01) {
            camera.fov = fov;
            camera.updateProjectionMatrix();
        }

        target.set(...current.target);
        camera.position.set(...current.position);
        interaction.orbitCamera(camera.position, target);
        camera.lookAt(target);
        lookDirection.subVectors(target, camera.position).normalize();
        cameraRight.crossVectors(lookDirection, camera.up).normalize();
        cameraUp.crossVectors(cameraRight, lookDirection).normalize();

        const calmScale = quality().isCalm ? 0 : 1;
        const sway =
            (clamp01(current.position[1] / 30) * 6 + 0.5) * interaction.swayScale() * calmScale;
        camera.position.addScaledVector(cameraRight, pointer.smoothX * sway);
        camera.position.addScaledVector(
            cameraUp,
            -pointer.smoothY * sway * 0.55 + Math.sin(wallTime * 0.5) * 0.08 * sway,
        );
        camera.lookAt(target);
        sky.sky.position.copy(camera.position);
        sky.stars.position.copy(camera.position);

        applyAtmosphere();

        if (sky.formations[0].group.visible) {
            for (const formation of sky.formations)
                formation.update(elapsed, quality().isCalm ? 0 : delta, current.dark);
        }
        if (paradeGround.visible) {
            figures.marchTime.value = elapsed;
            scenery.flagTime.value = elapsed;
            scenery.garden.time.value = elapsed;
        }

        if (paradeGround.visible && !wasParadeVisible) shadowsDirty = true;
        wasParadeVisible = paradeGround.visible;
        renderer.shadowMap.needsUpdate =
            shadowsDirty || (paradeGround.visible && quality().movingShadows && !quality().isCalm);

        updateReadout();
        interaction.update(delta, wallTime, elapsed);

        const isSettled =
            gap(current.position, goal.position) + gap(current.target, goal.target) < SETTLED_GAP &&
            Math.abs(pointer.smoothX - pointerX) + Math.abs(pointer.smoothY - pointerY) <
                SETTLED_GAP &&
            interaction.isIdle() &&
            !flypast.isActive();
        const shouldRender =
            (visibleWindows > 0 && !(quality().isCalm && isSettled)) || !hasRendered;

        if (!shouldRender) return;

        render();
        shadowsDirty = false;

        if (!hasRendered) {
            hasRendered = true;
            document.documentElement.dataset.world = 'ready';
        }

        recordFrame(governor, rawDelta * 1000, performance.now() - frameStart);
        applyQualityStep();
    };

    return {
        frame,
        resize: (width, height) => {
            viewport = { width, height };
            effects?.setSize(width, height, governor.pixelRatio);
            remeasure();
        },
        dispose: () => {
            isRunning = false;
            interaction.dispose();
            flypast.dispose();
            removeEventListener('load', remeasure);
            bodyObserver.disconnect();
            windowObserver.disconnect();
            effects?.dispose();
            scenery.dispose();
            figures.dispose();
            sky.dispose();
            scene.remove(sky.group, paradeGround, hemisphere, sun, sun.target, rim);
            if (document.documentElement.dataset.world === 'ready')
                delete document.documentElement.dataset.world;
        },
    };
}
