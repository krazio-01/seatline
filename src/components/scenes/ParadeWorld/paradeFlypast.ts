import { MathUtils } from 'three';
import { DAY_FLYPAST_PLAN, type Formation } from '@/components/scenes/ParadeWorld/paradeSky';

export type FlypastStage = 'flying' | 'smoke' | 'done';

export type FlypastOptions = {
    formation: Formation;
    canLaunch: () => boolean;
};

export type ParadeFlypast = {
    launch: (byVisitor: boolean) => void;
    update: (delta: number) => void;
    glance: () => number;
    isActive: () => boolean;
    dispose: () => void;
};

export const FLYPAST_SMOKE_SECONDS = 6;

const TRIGGER = '[data-flypast-trigger]';
const IDLE = -1;
const ROAR = { seconds: 10, peakGain: 0.3, lowHz: 200, highHz: 1500 };
const BUZZ_PATTERN = [30, 60, 110];

const closestPassSeconds =
    (-DAY_FLYPAST_PLAN.from[2] / (DAY_FLYPAST_PLAN.to[2] - DAY_FLYPAST_PLAN.from[2])) *
    DAY_FLYPAST_PLAN.duration;

export function flypastStage(seconds: number): FlypastStage {
    if (seconds < DAY_FLYPAST_PLAN.duration) return 'flying';

    return seconds < DAY_FLYPAST_PLAN.duration + FLYPAST_SMOKE_SECONDS ? 'smoke' : 'done';
}

export function flypastGlance(seconds: number): number {
    const rise = MathUtils.smoothstep(seconds, 0.8, 3.2);
    const fall = MathUtils.smoothstep(
        seconds,
        DAY_FLYPAST_PLAN.duration - 1.2,
        DAY_FLYPAST_PLAN.duration + 2,
    );

    return rise * (1 - fall);
}

function playRoar(onEnded: () => void): AudioContext | undefined {
    if (!('AudioContext' in window)) return undefined;

    const context = new AudioContext();
    const start = context.currentTime;
    const length = Math.floor(context.sampleRate * ROAR.seconds);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let rumble = 0;

    for (let index = 0; index < length; index += 1) {
        rumble = (rumble + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        samples[index] = rumble * 3.5;
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const pan = context.createStereoPanner();

    source.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(ROAR.lowHz, start);
    filter.frequency.exponentialRampToValueAtTime(ROAR.highHz, start + closestPassSeconds);
    filter.frequency.exponentialRampToValueAtTime(ROAR.lowHz, start + ROAR.seconds);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(ROAR.peakGain, start + closestPassSeconds);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + ROAR.seconds);
    pan.pan.setValueAtTime(0.6, start);
    pan.pan.linearRampToValueAtTime(-0.7, start + ROAR.seconds);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(context.destination);
    source.onended = onEnded;
    source.start();

    return context;
}

export function createFlypast({ formation, canLaunch }: FlypastOptions): ParadeFlypast {
    const root = document.documentElement;
    let seconds = IDLE;
    let buzzTimer: ReturnType<typeof setTimeout> | undefined;
    let roarContext: AudioContext | undefined;

    const stopRoar = () => {
        void roarContext?.close();
        roarContext = undefined;
    };

    formation.smoke.points.material.uniforms.uLife.value = FLYPAST_SMOKE_SECONDS;

    const launch = (byVisitor: boolean) => {
        if (seconds !== IDLE || !canLaunch()) return;

        seconds = 0;
        formation.group.visible = true;
        root.dataset.worldFlypast = 'flying';

        if (!byVisitor) {
            root.toggleAttribute('data-world-arrival-flypast', true);
            return;
        }

        roarContext = playRoar(stopRoar);
        buzzTimer = setTimeout(() => navigator.vibrate?.(BUZZ_PATTERN), closestPassSeconds * 1000);
    };

    const onClick = (event: MouseEvent) => {
        const element = event.target instanceof Element ? event.target : null;
        if (element?.closest(TRIGGER)) launch(true);
    };

    document.addEventListener('click', onClick);

    return {
        launch,
        update: (delta) => {
            if (seconds === IDLE) return;

            seconds += delta;
            formation.update(seconds, delta, 0);

            if (flypastStage(seconds) !== 'done') return;

            formation.group.visible = false;
            delete root.dataset.worldFlypast;
            seconds = IDLE;
        },
        glance: () => (seconds === IDLE ? 0 : flypastGlance(seconds)),
        isActive: () => seconds !== IDLE,
        dispose: () => {
            clearTimeout(buzzTimer);
            stopRoar();
            document.removeEventListener('click', onClick);
            delete root.dataset.worldFlypast;
            root.removeAttribute('data-world-arrival-flypast');
        },
    };
}
