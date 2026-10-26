'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PCFShadowMap, WebGLRenderer, type PerspectiveCamera } from 'three';
import './paradeWorld.scss';
import {
    createParadeRuntime,
    type ParadeRuntime,
    type ParadeWorldData,
} from '@/components/scenes/ParadeWorld/paradeRuntime';
import { silenceClockDeprecation } from '@/components/scenes/geometry';

export type ParadeWorldProps = ParadeWorldData;

silenceClockDeprecation();

const SHADOWS = { enabled: true, type: PCFShadowMap, autoUpdate: false };

const CAMERA = {
    fov: 42,
    near: 0.3,
    far: 6000,
    position: [0, 128, 268] as [number, number, number],
};

function WorldDriver({
    data,
    overlayRef,
    setPixelRatio,
}: {
    data: ParadeWorldData;
    overlayRef: RefObject<HTMLDivElement | null>;
    setPixelRatio: (pixelRatio: number) => void;
}) {
    const gl = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);
    const camera = useThree((state) => state.camera) as PerspectiveCamera;
    const size = useThree((state) => state.size);
    const getState = useThree((state) => state.get);
    const runtimeRef = useRef<ParadeRuntime | null>(null);
    const dataRef = useRef(data);

    useEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay) return;

        let isCancelled = false;
        const root = document.documentElement;
        const markLost = () => {
            root.dataset.world = 'lost';
        };
        gl.domElement.addEventListener('webglcontextlost', markLost);

        createParadeRuntime({
            renderer: gl,
            scene,
            camera,
            data: dataRef.current,
            overlay,
            setPixelRatio,
        })
            .then((runtime) => {
                if (isCancelled) {
                    runtime.dispose();
                    return;
                }

                const { width, height } = getState().size;
                runtimeRef.current = runtime;
                runtime.resize(width, height);
            })
            .catch((error: unknown) => {
                if (isCancelled) return;

                markLost();
                throw error;
            });

        return () => {
            isCancelled = true;
            gl.domElement.removeEventListener('webglcontextlost', markLost);
            runtimeRef.current?.dispose();
            runtimeRef.current = null;
        };
    }, [gl, scene, camera, overlayRef, setPixelRatio, getState]);

    useEffect(() => {
        runtimeRef.current?.resize(size.width, size.height);
    }, [size]);

    useFrame((_state, delta) => runtimeRef.current?.frame(delta), 1);

    return null;
}

export function ParadeWorld(props: ParadeWorldProps) {
    const overlayRef = useRef<HTMLDivElement>(null);
    const [pixelRatio, setPixelRatio] = useState(1);

    useEffect(() => {
        const root = document.documentElement;
        if (root.dataset.world === 'lost') delete root.dataset.world;

        return () => {
            delete root.dataset.world;
            delete root.dataset.worldTier;
            delete root.dataset.worldPixelRatio;
        };
    }, []);

    return (
        <>
            <div className="parade-world" aria-hidden="true">
                <Canvas
                    flat
                    dpr={pixelRatio}
                    shadows={SHADOWS}
                    camera={CAMERA}
                    gl={({ canvas }) =>
                        new WebGLRenderer({ canvas: canvas as HTMLCanvasElement, antialias: false })
                    }
                >
                    <WorldDriver
                        data={props}
                        overlayRef={overlayRef}
                        setPixelRatio={setPixelRatio}
                    />
                </Canvas>
            </div>

            <div className="world-overlay" ref={overlayRef}>
                <div className="world-pins" aria-hidden="true" />

                <p className="parade-readout" aria-hidden="true">
                    <span>
                        <b>ALT</b>
                        <span data-readout="altitude" />
                    </span>
                    <span>
                        <b>HDG</b>
                        <span data-readout="heading" />
                    </span>
                    <span>
                        <b>IST</b>
                        <span data-readout="clock" />
                    </span>
                </p>

                <div className="world-callout" aria-hidden="true">
                    <span className="world-callout-dot" />
                    <span className="world-callout-line" />
                    <span className="world-callout-card">
                        <span className="world-callout-index" />
                        <strong className="world-callout-title" />
                        <span className="world-callout-detail" />
                        <span className="world-callout-action" />
                    </span>
                </div>

                <div className="world-viewpoint" role="status">
                    <span className="world-viewpoint-text">
                        <span className="world-viewpoint-eyebrow" />
                        <strong className="world-viewpoint-label" />
                    </span>
                    <span className="world-viewpoint-hint">Drag to look around</span>
                    <button type="button" className="world-viewpoint-exit">
                        Back to overview <kbd>Esc</kbd>
                    </button>
                </div>
            </div>
        </>
    );
}
