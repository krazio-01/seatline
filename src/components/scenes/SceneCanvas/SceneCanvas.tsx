'use client';
import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from 'react';
import { Canvas, useFrame, useThree, type CameraProps } from '@react-three/fiber';
import { PCFShadowMap, PMREMGenerator, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import './sceneCanvas.scss';
import { classNames } from '@/utils/class-names';
import { silenceClockDeprecation } from '@/components/scenes/geometry';
import {
    isConstrainedDevice,
    readServerWebglSupport,
    readWebglSupport,
    subscribeToNothing,
} from '@/components/scenes/sceneSupport';

const MAX_PIXEL_RATIO = 1.75;
const SLOW_FRAME_SECONDS = 0.02;
const SLOW_STREAK_SECONDS = 1;
const IGNORED_GAP_SECONDS = 0.25;
const SOFT_SHADOWS = { enabled: true, type: PCFShadowMap };
const SLOW_STREAKS_BEFORE_LOW_POWER = 2;
const SceneQualityContext = createContext({ isLowPower: false });

silenceClockDeprecation();

function FrameloopController({ isActive, isStill }: { isActive: boolean; isStill: boolean }) {
    const setFrameloop = useThree((state) => state.setFrameloop);
    const invalidate = useThree((state) => state.invalidate);

    useEffect(() => {
        if (!isActive) {
            setFrameloop('never');
            return;
        }

        setFrameloop(isStill ? 'demand' : 'always');
        invalidate();
    }, [isActive, isStill, setFrameloop, invalidate]);

    return null;
}

function FirstFrameNotifier({ onFirstFrame }: { onFirstFrame: () => void }) {
    const hasNotifiedRef = useRef(false);

    useFrame(() => {
        if (hasNotifiedRef.current) return;

        hasNotifiedRef.current = true;
        requestAnimationFrame(onFirstFrame);
    });

    return null;
}

function SlowFrameMonitor({
    onSustainedSlowFrames,
}: {
    onSustainedSlowFrames: (slowStreakCount: number) => void;
}) {
    const slowStreakRef = useRef(0);
    const streakCountRef = useRef(0);

    useFrame((_state, delta) => {
        if (streakCountRef.current >= SLOW_STREAKS_BEFORE_LOW_POWER) return;

        const isSlowFrame = delta > SLOW_FRAME_SECONDS && delta < IGNORED_GAP_SECONDS;
        slowStreakRef.current = isSlowFrame ? slowStreakRef.current + delta : 0;

        if (slowStreakRef.current < SLOW_STREAK_SECONDS) return;

        slowStreakRef.current = 0;
        streakCountRef.current += 1;
        onSustainedSlowFrames(streakCountRef.current);
    });

    return null;
}

export function useSceneQuality() {
    return useContext(SceneQualityContext);
}

export function StudioEnvironment({ intensity = 1 }: { intensity?: number }) {
    const getState = useThree((state) => state.get);

    useEffect(() => {
        const { gl, scene, invalidate } = getState();
        const generator = new PMREMGenerator(gl);
        const room = new RoomEnvironment();
        const target = generator.fromScene(room, 0.04);

        room.dispose();
        generator.dispose();

        scene.environment = target.texture;
        scene.environmentIntensity = intensity;
        invalidate();

        return () => {
            if (scene.environment === target.texture) scene.environment = null;

            target.dispose();
        };
    }, [getState, intensity]);

    return null;
}

export function SceneCanvas({
    fallback,
    className,
    camera,
    shadows,
    transparent = false,
    isStill = false,
    isLowPowerOnMobile = false,
    onFirstFrame,
    children,
}: {
    fallback: ReactNode;
    className?: string;
    camera?: CameraProps;
    shadows?: boolean;
    transparent?: boolean;
    isStill?: boolean;
    isLowPowerOnMobile?: boolean;
    onFirstFrame?: () => void;
    children: ReactNode;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isOnScreen, setIsOnScreen] = useState(true);
    const [isTabVisible, setIsTabVisible] = useState(true);
    const [isContextLost, setIsContextLost] = useState(false);
    const [maxPixelRatio, setMaxPixelRatio] = useState(MAX_PIXEL_RATIO);
    const [hasSustainedSlowFrames, setHasSustainedSlowFrames] = useState(false);

    const webgl = useSyncExternalStore(
        subscribeToNothing,
        readWebglSupport,
        readServerWebglSupport,
    );
    const isMobile = useSyncExternalStore(subscribeToNothing, isConstrainedDevice, () => false);
    const isLowPower =
        webgl.isSoftware || hasSustainedSlowFrames || (isLowPowerOnMobile && isMobile);
    const quality = useMemo(() => ({ isLowPower }), [isLowPower]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new IntersectionObserver(([entry]) => {
            setIsOnScreen(entry.isIntersecting);
        });

        observer.observe(container);

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const updateVisibility = () => setIsTabVisible(!document.hidden);

        updateVisibility();
        document.addEventListener('visibilitychange', updateVisibility);

        return () => document.removeEventListener('visibilitychange', updateVisibility);
    }, []);

    const shouldShowFallback = !webgl.isSupported || isContextLost;

    return (
        <div ref={containerRef} className={classNames('scene-canvas', className)}>
            {shouldShowFallback ? (
                fallback
            ) : (
                <Canvas
                    aria-hidden="true"
                    className="scene-canvas-element"
                    camera={camera}
                    shadows={shadows && !isLowPower ? SOFT_SHADOWS : undefined}
                    flat
                    dpr={[1, isLowPower ? 1 : maxPixelRatio]}
                    gl={({ canvas }) =>
                        new WebGLRenderer({ canvas, antialias: true, alpha: transparent })
                    }
                    onCreated={({ gl }) => {
                        gl.domElement.setAttribute('aria-hidden', 'true');
                        gl.domElement.addEventListener('webglcontextlost', () =>
                            setIsContextLost(true),
                        );
                    }}
                >
                    <FrameloopController isActive={isOnScreen && isTabVisible} isStill={isStill} />
                    <SlowFrameMonitor
                        onSustainedSlowFrames={(slowStreakCount) => {
                            setMaxPixelRatio(1);

                            if (slowStreakCount >= SLOW_STREAKS_BEFORE_LOW_POWER)
                                setHasSustainedSlowFrames(true);
                        }}
                    />
                    {onFirstFrame && <FirstFrameNotifier onFirstFrame={onFirstFrame} />}
                    <SceneQualityContext value={quality}>{children}</SceneQualityContext>
                </Canvas>
            )}
        </div>
    );
}
