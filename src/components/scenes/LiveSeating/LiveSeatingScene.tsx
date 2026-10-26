'use client';
import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';
import { SEATING_SHOTS } from '@/components/scenes/paradeCamera';
import {
    createSeatingRuntime,
    type LiveSeatingState,
    type SeatingEvents,
    type SeatingRuntime,
} from '@/components/scenes/LiveSeating/seatingRuntime';
import { SceneCanvas, useSceneQuality } from '@/components/scenes/SceneCanvas/SceneCanvas';
import type { EventZone, ZoneName } from '@/types/booking';

export type { LiveSeatingState };

export type LiveSeatingSceneProps = {
    zones: EventZone[];
    ownZone: ZoneName | null;
    focusedZone: ZoneName | null;
    onHoverZone: SeatingEvents['onHoverZone'];
    onReady: SeatingEvents['onReady'];
    onStateChange: SeatingEvents['onStateChange'];
};

function SeatingDriver({
    zones,
    ownZone,
    focusedZone,
    onHoverZone,
    onReady,
    onStateChange,
    onStillChange,
}: LiveSeatingSceneProps & { onStillChange: SeatingEvents['onStillChange'] }) {
    const gl = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);
    const camera = useThree((state) => state.camera) as PerspectiveCamera;
    const size = useThree((state) => state.size);
    const invalidate = useThree((state) => state.invalidate);
    const { isLowPower } = useSceneQuality();
    const runtimeRef = useRef<SeatingRuntime | null>(null);
    const eventsRef = useRef<SeatingEvents>({ onHoverZone, onReady, onStateChange, onStillChange });

    useEffect(() => {
        eventsRef.current = { onHoverZone, onReady, onStateChange, onStillChange };
    }, [onHoverZone, onReady, onStateChange, onStillChange]);

    useEffect(() => {
        const runtime = createSeatingRuntime({
            renderer: gl,
            scene,
            camera,
            invalidate,
            events: {
                onHoverZone: (zone, anchor) => eventsRef.current.onHoverZone(zone, anchor),
                onReady: () => eventsRef.current.onReady(),
                onStateChange: (state) => eventsRef.current.onStateChange(state),
                onStillChange: (isStill) => eventsRef.current.onStillChange(isStill),
            },
        });

        runtimeRef.current = runtime;

        return () => {
            runtime.dispose();
            runtimeRef.current = null;
        };
    }, [gl, scene, camera, invalidate]);

    useEffect(() => {
        runtimeRef.current?.update({ zones, ownZone, focusedZone, isLowPower });
    }, [zones, ownZone, focusedZone, isLowPower]);

    useEffect(() => {
        runtimeRef.current?.resize(size.width, size.height);
    }, [size]);

    useFrame((_state, delta) => runtimeRef.current?.frame(delta));

    return null;
}

export function LiveSeatingScene(props: LiveSeatingSceneProps) {
    const [isStill, setIsStill] = useState(false);

    return (
        <SceneCanvas
            fallback={null}
            transparent
            shadows
            isLowPowerOnMobile
            isStill={isStill}
            camera={{
                fov: SEATING_SHOTS.overview.fov,
                near: 0.3,
                far: 400,
                position: SEATING_SHOTS.overview.position,
            }}
        >
            <SeatingDriver {...props} onStillChange={setIsStill} />
        </SceneCanvas>
    );
}
