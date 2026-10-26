import {
    Color,
    MathUtils,
    Matrix4,
    Raycaster,
    Vector2,
    Vector3,
    type PerspectiveCamera,
} from 'three';
import type { Shot } from '@/components/scenes/paradeCamera';
import {
    buildHotspots,
    DAIS,
    ENCLOSURE_X,
    fullZoneViewSeat,
    hotspotAnchor,
    leadingContingent,
    nearestPin,
    nextFreeSeat,
    pickHotspot,
    sightlineBlockers,
    updateContingentHotspots,
    type Hotspot,
    type HotspotView,
    type ParadeSeat,
    type ScreenPin,
} from '@/components/scenes/paradeLayout';
import type { ParadeScenery } from '@/components/scenes/ParadeWorld/paradeScenery';
import type { StirUniforms } from '@/components/scenes/ParadeWorld/paradeSky';
import type { EventZone, ZoneName } from '@/types/booking';

type Viewpoint = { position: Vector3; direction: Vector3; scroll: number };

type Pin = {
    element: HTMLElement;
    label: HTMLElement;
    hotspot: Hotspot | null;
    isContingent: boolean;
    screen: ScreenPin;
    transform: string;
};

export type InteractionOptions = {
    camera: PerspectiveCamera;
    overlay: HTMLElement;
    scenery: ParadeScenery;
    stir: StirUniforms;
    zones: EventZone[];
    paradeBegins: string;
    isDaylight: () => boolean;
    isNight: () => boolean;
    marchTime: () => number;
};

export type ParadeInteraction = {
    update: (delta: number, wallTime: number, elapsed: number) => void;
    steerGoal: (goal: Shot) => void;
    orbitCamera: (position: Vector3, target: Vector3) => void;
    swayScale: () => number;
    isViewing: () => boolean;
    pointerOffset: () => [number, number];
    isIdle: () => boolean;
    dispose: () => void;
};

const BLOCKERS = 'a, button, input, label, [data-world-blocker]';
const DRAG_THRESHOLD = 6;
const ORBIT_LIMIT = 0.9;
const LOOK_YAW_LIMIT = 1.35;
const LOOK_PITCH = { min: -0.3, max: 0.35 };
const ORBIT_RATE = 0.0045;
const LOOK_RATE = 0.0042;
const PITCH_RATE = 0.003;
const SPRING_DELAY_SECONDS = 1.6;
const EXIT_SCROLL = 140;
const RESIZE_SETTLE_MS = 600;
const SEAT_EYE = new Vector3(0, 1.24, 0.1);
const SEAT_VIEW_SETTINGS = { fov: 38, dark: 0, tilt: 0, bloom: 0, fogNear: 90, fogFar: 560 };
const HIGHLIGHT_SHIFT: Record<ZoneName, number> = { C: -7, D: 8 };
const CHAIR_IDLE = new Color(0xffffff);
const CHAIR_DIMMED = new Color(0xb9b9b6);
const Y_AXIS = new Vector3(0, 1, 0);
const CURSOR_CLASSES = ['world-grabbable', 'world-pointing', 'world-dragging'];
const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const PIN_RADIUS = { mouse: 22, touch: 40 };
const PIN_MAX_DISTANCE = 300;
const OFF_SCREEN = 2;
const TURNED_YAW = 0.01;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function createInteraction(options: InteractionOptions): ParadeInteraction {
    const { camera, overlay, scenery, stir } = options;
    const find = <Target extends HTMLElement>(selector: string) =>
        overlay.querySelector<Target>(selector) as Target;
    const callout = {
        root: find('.world-callout'),
        card: find('.world-callout-card'),
        line: find('.world-callout-line'),
        index: find('.world-callout-index'),
        title: find('.world-callout-title'),
        detail: find('.world-callout-detail'),
        action: find('.world-callout-action'),
    };
    const viewpointEyebrow = find('.world-viewpoint-eyebrow');
    const viewpointLabel = find('.world-viewpoint-label');
    const viewpointExit = find<HTMLButtonElement>('.world-viewpoint-exit');
    const root = document.documentElement;
    const hotspots = buildHotspots(options.zones, options.paradeBegins);
    const raycaster = new Raycaster();
    const hit = new Vector3();
    const anchor = new Vector3();
    const direction = new Vector3();
    const seatTarget = new Vector3();
    const matrix = new Matrix4();
    const pointer = {
        x: 0,
        y: 0,
        ndc: new Vector2(OFF_SCREEN, OFF_SCREEN),
        overWorld: false,
        motion: 0,
        isTouch: false,
    };
    const pinLayer = find('.world-pins');
    const indexLabel = (hotspot: Hotspot) => String(hotspots.indexOf(hotspot) + 1).padStart(2, '0');
    const createPin = (hotspot: Hotspot | null): Pin => {
        const element = document.createElement('span');
        const label = document.createElement('span');
        element.className = 'world-pin';
        label.className = 'world-pin-index';
        label.textContent = hotspot ? indexLabel(hotspot) : '';
        element.append(label);
        pinLayer.append(element);

        return {
            element,
            label,
            hotspot,
            isContingent: hotspot === null,
            screen: { x: 0, y: 0, isVisible: false },
            transform: '',
        };
    };
    const pins = [
        ...hotspots.filter((hotspot) => hotspot.contingent === undefined).map(createPin),
        createPin(null),
    ];
    const pinScreens = pins.map((pin) => pin.screen);
    const drag = {
        active: false,
        moved: false,
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
        releasedAt: -10,
    };
    const orbit = { yaw: 0, velocity: 0 };
    const look = { yaw: 0, pitch: 0, velocity: 0 };
    const hiddenGuests: number[] = [];
    let viewpoint: Viewpoint | null = null;
    let opener: HTMLElement | null = null;
    let resizedAt = -Infinity;
    let highlightedZone: ZoneName | null = null;
    let paintedZone: ZoneName | null | 'initial' = 'initial';
    let activeHotspot: Hotspot | null = null;
    let armedHotspot: Hotspot | null = null;
    let placement = '';
    let cursorClass = '';
    let wallTime = 0;
    let isTurned = false;

    const trackPointer = (event: MouseEvent) => {
        if ('pointerType' in event && event.pointerType)
            pointer.isTouch = (event as PointerEvent).pointerType !== 'mouse';
        const x = event.clientX / innerWidth - 0.5;
        const y = event.clientY / innerHeight - 0.5;
        const element = event.target instanceof Element ? event.target : document.body;
        const card = element.closest<HTMLElement>('[data-world-view]');
        const isSurface =
            element.closest('[data-window]') !== null ||
            element === document.body ||
            element === root;

        pointer.motion = Math.min(1, pointer.motion + Math.hypot(x - pointer.x, y - pointer.y) * 5);
        pointer.x = x;
        pointer.y = y;
        pointer.ndc.set(x * 2, -y * 2);
        pointer.overWorld = !element.closest(BLOCKERS) && (isSurface || viewpoint !== null);
        highlightedZone =
            card && card.dataset.worldView !== 'dais' ? (card.dataset.worldView as ZoneName) : null;
    };

    const clearSightline = (viewer: ParadeSeat | null) => {
        const { clothing, skin, seats } = scenery.guests;

        for (const index of hiddenGuests.splice(0)) {
            matrix.makeTranslation(...seats[index].position);
            clothing.setMatrixAt(index, matrix);
            skin.setMatrixAt(index, matrix);
        }

        if (viewer) {
            matrix.makeScale(0, 0, 0);
            for (const index of sightlineBlockers(seats, viewer)) {
                clothing.setMatrixAt(index, matrix);
                skin.setMatrixAt(index, matrix);
                hiddenGuests.push(index);
            }
        }

        clothing.instanceMatrix.needsUpdate = true;
        skin.instanceMatrix.needsUpdate = true;
    };

    const openViewpoint = (
        position: Vector3,
        viewDirection: Vector3,
        eyebrow: string,
        label: string,
    ) => {
        viewpoint = { position, direction: viewDirection.normalize(), scroll: scrollY };
        look.yaw = 0;
        look.pitch = 0;
        look.velocity = 0;
        orbit.yaw = 0;
        viewpointEyebrow.textContent = eyebrow;
        viewpointLabel.textContent = label;
        root.dataset.worldViewOpen = '';
    };

    const enterViewpoint = (view: HotspotView) => {
        if (view === 'dais') {
            clearSightline(null);
            openViewpoint(
                new Vector3(0, DAIS.height + 1.62, DAIS.front - 1.3),
                new Vector3(0, -0.1, 1),
                'The view from',
                'The dais, where the salute is taken',
            );
            return;
        }

        const layout = scenery.enclosures[view];
        if (!layout) return;

        const freeSeat = nextFreeSeat(layout.seats);
        const seat = freeSeat ?? fullZoneViewSeat(layout.seats);
        const position = new Vector3(...seat.position).add(SEAT_EYE);
        const viewDirection = new Vector3(ENCLOSURE_X[view] < 0 ? 0.3 : -0.3, -0.07, 1);

        clearSightline(seat);
        openViewpoint(
            position,
            viewDirection,
            freeSeat ? 'Your view from' : 'Preview',
            freeSeat
                ? `Enclosure ${view} · Row ${seat.row + 1} · Seat ${seat.column + 1}`
                : `View from Enclosure ${view}`,
        );
    };

    const exitViewpoint = () => {
        if (!viewpoint) return;

        const shouldReturnFocus = document.activeElement === viewpointExit;

        viewpoint = null;
        clearSightline(null);
        delete root.dataset.worldViewOpen;
        if (shouldReturnFocus) opener?.focus({ preventScroll: true });
        opener = null;
    };

    const pick = (): Hotspot | null => {
        if (!pointer.overWorld || !options.isDaylight() || viewpoint || drag.moved) return null;

        const pinIndex = nearestPin(
            pinScreens,
            (pointer.x + 0.5) * innerWidth,
            (pointer.y + 0.5) * innerHeight,
            pointer.isTouch ? PIN_RADIUS.touch : PIN_RADIUS.mouse,
        );
        const pinned = pinIndex >= 0 ? pins[pinIndex].hotspot : null;
        if (pinned) {
            hotspotAnchor(pinned, hit);
            return pinned;
        }

        raycaster.setFromCamera(pointer.ndc, camera);

        return pickHotspot(raycaster.ray, hotspots, hit);
    };

    const onPointerDown = (event: PointerEvent) => {
        trackPointer(event);
        if (!pointer.overWorld || !options.isDaylight()) return;

        Object.assign(drag, {
            active: true,
            moved: false,
            startX: event.clientX,
            startY: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
        });
    };

    const onPointerMove = (event: PointerEvent) => {
        trackPointer(event);
        if (!drag.active) return;

        const deltaX = event.clientX - drag.lastX;
        const deltaY = event.clientY - drag.lastY;
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;

        if (
            !drag.moved &&
            Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > DRAG_THRESHOLD
        ) {
            drag.moved = true;
            root.dataset.worldDragged = '';
        }
        if (!drag.moved) return;

        if (viewpoint) {
            look.velocity = deltaX * LOOK_RATE;
            look.yaw = clamp(look.yaw + look.velocity, -LOOK_YAW_LIMIT, LOOK_YAW_LIMIT);
            look.pitch = clamp(look.pitch + deltaY * PITCH_RATE, LOOK_PITCH.min, LOOK_PITCH.max);
            return;
        }

        orbit.velocity = -deltaX * ORBIT_RATE;
        orbit.yaw = clamp(orbit.yaw + orbit.velocity, -ORBIT_LIMIT, ORBIT_LIMIT);
    };

    const onPointerUp = (event: PointerEvent) => {
        if (event.type === 'pointercancel' && event.pointerType !== 'mouse') {
            pointer.ndc.set(OFF_SCREEN, OFF_SCREEN);
            pointer.overWorld = false;
        }
        if (!drag.active) return;

        drag.active = false;
        drag.releasedAt = wallTime;
    };

    const onClick = (event: MouseEvent) => {
        if (drag.moved) return;

        const element = event.target instanceof Element ? event.target : null;
        const card = element?.closest<HTMLButtonElement>('[data-world-view]');

        if (card) {
            enterViewpoint(card.dataset.worldView as HotspotView);
            if (!viewpoint) return;

            opener = card;
            viewpointExit.focus({ preventScroll: true });
            return;
        }

        trackPointer(event);
        const hotspot = pick();
        if (!hotspot?.view) return;

        if (pointer.isTouch && armedHotspot !== hotspot) {
            if (hotspot !== activeHotspot) showCallout(hotspot);
            armedHotspot = hotspot;
            callout.action.textContent = actionText(hotspot);
            return;
        }

        armedHotspot = null;
        enterViewpoint(hotspot.view);
    };

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') exitViewpoint();
    };

    const onScroll = () => {
        if (!viewpoint) return;

        if (performance.now() - resizedAt < RESIZE_SETTLE_MS) {
            viewpoint.scroll = scrollY;
            return;
        }
        if (Math.abs(scrollY - viewpoint.scroll) > EXIT_SCROLL) exitViewpoint();
    };

    const onResize = () => {
        resizedAt = performance.now();
    };

    addEventListener('pointerdown', onPointerDown, { passive: true });
    addEventListener('pointermove', onPointerMove, { passive: true });
    addEventListener('pointerup', onPointerUp);
    addEventListener('pointercancel', onPointerUp);
    addEventListener('click', onClick);
    addEventListener('keydown', onKeyDown);
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onResize);
    viewpointExit.addEventListener('click', exitViewpoint);

    const actionText = (hotspot: Hotspot) => {
        if (!hotspot.action || !pointer.isTouch) return hotspot.action ?? '';

        return armedHotspot === hotspot
            ? `Tap again · ${hotspot.action}`
            : `Tap · ${hotspot.action}`;
    };

    const showCallout = (hotspot: Hotspot | null) => {
        if (hotspot !== activeHotspot) armedHotspot = null;
        for (const pin of pins)
            pin.element.classList.toggle('is-active', Boolean(hotspot) && pin.hotspot === hotspot);
        activeHotspot = hotspot;
        callout.root.classList.toggle('is-visible', Boolean(hotspot));

        if (!hotspot) {
            delete callout.root.dataset.worldHotspot;
            return;
        }

        callout.root.dataset.worldHotspot = hotspot.id;
        callout.index.textContent = indexLabel(hotspot);
        callout.title.textContent = hotspot.title;
        callout.detail.textContent = hotspot.detail;
        callout.action.textContent = actionText(hotspot);
        callout.card.animate(
            [
                { opacity: 0, transform: 'translateY(10px) scale(0.97)' },
                { opacity: 1, transform: 'none' },
            ],
            { duration: 420, easing: EASE_OUT },
        );
        callout.line.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], {
            duration: 360,
            easing: EASE_OUT,
        });
    };

    const projectToScreen = (point: Vector3): [number, number, boolean] => {
        anchor.copy(point).project(camera);
        const x = ((anchor.x + 1) / 2) * innerWidth;
        const y = ((1 - anchor.y) / 2) * innerHeight;
        const isOnScreen =
            anchor.z < 1 && x > 60 && x < innerWidth - 60 && y > 100 && y < innerHeight - 60;

        return [x, y, isOnScreen];
    };

    const updateCallout = () => {
        const hotspot = pick();
        if (hotspot !== activeHotspot) showCallout(hotspot);
        if (!hotspot) return;

        const box = hotspot.boxes[0];
        direction.set((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);

        const boxAnchor = projectToScreen(direction);
        const [x, y] = boxAnchor[2] ? boxAnchor : projectToScreen(hit);

        const isBelow = y < 300;
        const isLeft = x > innerWidth - 320;
        const nextPlacement = `${isBelow} ${isLeft}`;

        if (nextPlacement !== placement) {
            placement = nextPlacement;
            callout.root.classList.toggle('is-below', isBelow);
            callout.root.classList.toggle('is-left', isLeft);
        }

        callout.root.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    };

    const updatePins = () => {
        const showsPins = options.isDaylight() && viewpoint === null;
        const marchTime = options.marchTime();
        updateContingentHotspots(hotspots, marchTime);
        pinLayer.classList.toggle('is-visible', showsPins);

        for (const pin of pins) {
            if (pin.isContingent) {
                const leading = leadingContingent(hotspots, marchTime);
                if (leading !== pin.hotspot && leading) pin.label.textContent = indexLabel(leading);
                pin.hotspot = leading;
            }

            let isVisible = false;
            if (showsPins && pin.hotspot) {
                hotspotAnchor(pin.hotspot, direction);
                const isNear = camera.position.distanceTo(direction) < PIN_MAX_DISTANCE;
                const [x, y, isOnScreen] = projectToScreen(direction);
                isVisible = isNear && isOnScreen;
                pin.screen.x = x;
                pin.screen.y = y;

                const transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
                if (isVisible && transform !== pin.transform) {
                    pin.transform = transform;
                    pin.element.style.transform = transform;
                }
            }

            if (isVisible !== pin.screen.isVisible)
                pin.element.classList.toggle('is-visible', isVisible);
            pin.screen.isVisible = isVisible;
        }
    };

    const updateCursor = () => {
        const next =
            drag.active && drag.moved
                ? 'world-dragging'
                : activeHotspot?.view
                  ? 'world-pointing'
                  : pointer.overWorld && options.isDaylight()
                    ? 'world-grabbable'
                    : '';
        if (next === cursorClass) return;

        root.classList.remove(...CURSOR_CLASSES);
        if (next) root.classList.add(next);
        cursorClass = next;
    };

    const paintChairs = (elapsed: number) => {
        if (highlightedZone === null && paintedZone === null) return;

        paintedZone = highlightedZone;
        scenery.chairSeats.forEach((seat, index) => {
            const isDimmed = highlightedZone !== null && seat.zone !== highlightedZone;
            const lift =
                highlightedZone === seat.zone && !seat.isBooked
                    ? Math.max(0, Math.sin(elapsed * 3.2 - seat.position[0] * 0.9)) * 0.22
                    : 0;

            scenery.chairs.setColorAt(index, isDimmed ? CHAIR_DIMMED : CHAIR_IDLE);
            matrix.makeTranslation(seat.position[0], seat.position[1] + lift, seat.position[2]);
            scenery.chairs.setMatrixAt(index, matrix);
        });

        if (scenery.chairs.instanceColor) scenery.chairs.instanceColor.needsUpdate = true;
        scenery.chairs.instanceMatrix.needsUpdate = true;
    };

    return {
        update: (delta, nextWallTime, elapsed) => {
            wallTime = nextWallTime;

            if (!drag.active) {
                orbit.yaw = clamp(orbit.yaw + orbit.velocity, -ORBIT_LIMIT, ORBIT_LIMIT);
                orbit.velocity *= Math.exp(-delta * 5);
                look.yaw = clamp(look.yaw + look.velocity, -LOOK_YAW_LIMIT, LOOK_YAW_LIMIT);
                look.velocity *= Math.exp(-delta * 5);
                if (wallTime - drag.releasedAt > SPRING_DELAY_SECONDS || !options.isDaylight()) {
                    orbit.yaw = MathUtils.lerp(orbit.yaw, 0, 1 - Math.exp(-delta * 1.4));
                }
                if (wallTime - drag.releasedAt > 0.3) drag.moved = false;
            }

            pointer.motion *= Math.exp(-delta * 1.6);

            if (Math.abs(orbit.yaw) > TURNED_YAW !== isTurned) {
                isTurned = !isTurned;
                root.toggleAttribute('data-world-turned', isTurned);
            }

            if (options.isNight()) {
                raycaster.setFromCamera(pointer.ndc, camera);
                stir.origin.value.copy(raycaster.ray.origin);
                stir.direction.value.copy(raycaster.ray.direction);
                stir.strength.value = pointer.ndc.x > 1.5 ? 0 : 0.35 + 0.65 * pointer.motion;
            }

            updatePins();
            updateCallout();
            updateCursor();
            paintChairs(elapsed);
        },
        steerGoal: (goal) => {
            if (highlightedZone && !viewpoint) goal.target[0] += HIGHLIGHT_SHIFT[highlightedZone];
            if (!viewpoint) return;

            direction.copy(viewpoint.direction).applyAxisAngle(Y_AXIS, look.yaw);
            direction.y += look.pitch;
            viewpoint.position.toArray(goal.position);
            seatTarget.copy(viewpoint.position).addScaledVector(direction, 10);
            seatTarget.toArray(goal.target);
            Object.assign(goal, SEAT_VIEW_SETTINGS);
        },
        orbitCamera: (position, target) => {
            if (Math.abs(orbit.yaw) < 1e-4) return;

            position.sub(target);
            position.applyAxisAngle(Y_AXIS, orbit.yaw);
            position.add(target);
        },
        swayScale: () => (viewpoint ? 0.08 : 1),
        isViewing: () => viewpoint !== null,
        pointerOffset: () => [pointer.x, pointer.y],
        isIdle: () =>
            !drag.active &&
            Math.abs(orbit.velocity) + Math.abs(look.velocity) < 1e-4 &&
            Math.abs(orbit.yaw) < 1e-3,
        dispose: () => {
            removeEventListener('pointerdown', onPointerDown);
            removeEventListener('pointermove', onPointerMove);
            removeEventListener('pointerup', onPointerUp);
            removeEventListener('pointercancel', onPointerUp);
            removeEventListener('click', onClick);
            removeEventListener('keydown', onKeyDown);
            removeEventListener('scroll', onScroll);
            removeEventListener('resize', onResize);
            viewpointExit.removeEventListener('click', exitViewpoint);
            for (const pin of pins) pin.element.remove();
            root.classList.remove(...CURSOR_CLASSES);
            delete root.dataset.worldViewOpen;
            delete root.dataset.worldDragged;
            delete root.dataset.worldTurned;
        },
    };
}
