'use client';
import { useRef, useState } from 'react';
import './seatMap.scss';
import { AuditoriumFallback } from '@/components/scenes/AuditoriumFallback/AuditoriumFallback';
import { LazyAuditorium, useSceneGate } from '@/components/scenes/LazyScenes';
import { useAppContext } from '@/context/appContext';
import { ZONE_LABELS } from '@/types/booking';

export function OwnZoneLegendItem() {
    const { ownBooking } = useAppContext('booking');

    if (!ownBooking) return null;

    return (
        <li className="seat-map-own-zone">
            <i className="seat-map-swatch" data-state="yours" />
            Your zone: {ZONE_LABELS[ownBooking.zone]}
        </li>
    );
}

export function SeatMapScene({ eventName }: { eventName: string }) {
    const { zones, ownBooking } = useAppContext('booking');
    const sceneRef = useRef<HTMLDivElement>(null);
    const [isSceneReady, setIsSceneReady] = useState(false);

    const shouldLoadScene = useSceneGate(sceneRef);
    const highlightedZone = ownBooking?.zone;

    return (
        <div
            ref={sceneRef}
            className="seat-map-scene"
            data-scene="auditorium"
            data-scene-ready={isSceneReady || undefined}
        >
            <AuditoriumFallback
                zones={zones}
                highlightedZone={highlightedZone}
                eventName={eventName}
            />

            {shouldLoadScene && (
                <LazyAuditorium
                    zones={zones}
                    highlightedZone={highlightedZone}
                    eventName={eventName}
                    startsAtRest
                    onFirstFrame={() => setIsSceneReady(true)}
                />
            )}
        </div>
    );
}
