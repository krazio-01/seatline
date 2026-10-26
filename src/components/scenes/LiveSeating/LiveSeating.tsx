'use client';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import './liveSeating.scss';
import type { LiveSeatingState } from '@/components/scenes/LiveSeating/LiveSeatingScene';
import { LazyLiveSeatingScene, useSceneGate } from '@/components/scenes/LazyScenes';
import { flypastReady } from '@/components/scenes/sceneSupport';
import { useAppContext } from '@/context/appContext';
import { toEventZones, ZONE_LABELS, zoneSeatsText, type ZoneName } from '@/types/booking';

type Hover = { zone: ZoneName; anchor: { x: number; y: number } } | null;

const POSTER_SRC = '/images/seating-day.webp';
const POSTER_SIZES = '(max-width: 960px) 100vw, 640px';
const SCENE_START_DELAY_MS = 1000;
const CALLOUT_GAP_PX = 14;

export function LiveSeating() {
    const { zones, ownBooking } = useAppContext('booking');
    const stageRef = useRef<HTMLDivElement>(null);
    const calloutRef = useRef<HTMLParagraphElement>(null);
    const [focusedZone, setFocusedZone] = useState<ZoneName | null>(null);
    const [hover, setHover] = useState<Hover>(null);
    const [isSceneReady, setIsSceneReady] = useState(false);
    const [sceneState, setSceneState] = useState<LiveSeatingState | null>(null);

    const shouldLoadScene = useSceneGate(stageRef, {
        startDelayMs: SCENE_START_DELAY_MS,
        waitFor: flypastReady,
    });
    const eventZones = useMemo(() => toEventZones(zones), [zones]);
    const ownZone = ownBooking?.zone ?? null;
    const hoveredZone = hover?.zone ?? null;
    const hoveredOccupancy = zones.find((zone) => zone.name === hoveredZone);

    const handleHoverZone = useCallback(
        (zone: ZoneName | null, anchor: { x: number; y: number } | null) =>
            setHover(zone && anchor ? { zone, anchor } : null),
        [],
    );
    const handleReady = useCallback(() => setIsSceneReady(true), []);

    useLayoutEffect(() => {
        const callout = calloutRef.current;
        const stage = stageRef.current;
        if (!callout || !stage || !hover) return;

        const width = callout.offsetWidth;
        const height = callout.offsetHeight;
        const above = hover.anchor.y - height - CALLOUT_GAP_PX;
        const top = above >= 0 ? above : hover.anchor.y + CALLOUT_GAP_PX;
        const left = Math.min(
            Math.max(hover.anchor.x - width / 2, 0),
            Math.max(stage.clientWidth - width, 0),
        );

        callout.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }, [hover]);

    return (
        <div
            className="live-seating"
            data-own-zone={ownZone ?? undefined}
            data-focused-zone={focusedZone ?? undefined}
            data-hovered-zone={hoveredZone ?? undefined}
            data-scene-ready={isSceneReady ? '' : undefined}
            data-low-power={sceneState ? String(sceneState.isLowPower) : undefined}
            data-squad={sceneState?.squad}
            data-camera-shot={sceneState?.shot}
        >
            <div className="live-seating-header">
                <p className="live-seating-title">
                    Live seating <span className="live-seating-place">· Parade ground</span>
                </p>

                <ul className="live-seating-legend" aria-label="Seat key">
                    <li>
                        <span
                            className="live-seating-swatch"
                            data-state="free"
                            aria-hidden="true"
                        />
                        Free
                    </li>
                    <li>
                        <span
                            className="live-seating-swatch"
                            data-state="booked"
                            aria-hidden="true"
                        />
                        Booked
                    </li>
                    {ownZone && (
                        <li>
                            <span
                                className="live-seating-swatch"
                                data-state="own"
                                aria-hidden="true"
                            />
                            Your zone
                        </li>
                    )}
                </ul>
            </div>

            <div ref={stageRef} className="live-seating-stage">
                <Image
                    className="live-seating-poster"
                    src={POSTER_SRC}
                    alt=""
                    aria-hidden="true"
                    fill
                    sizes={POSTER_SIZES}
                />

                {shouldLoadScene && (
                    <div className="live-seating-scene">
                        <LazyLiveSeatingScene
                            zones={eventZones}
                            ownZone={ownZone}
                            focusedZone={focusedZone}
                            onHoverZone={handleHoverZone}
                            onReady={handleReady}
                            onStateChange={setSceneState}
                        />
                    </div>
                )}

                <p
                    ref={calloutRef}
                    className="live-seating-callout"
                    data-visible={hoveredOccupancy ? '' : undefined}
                    aria-hidden="true"
                >
                    {hoveredOccupancy &&
                        `${ZONE_LABELS[hoveredOccupancy.name]} · ${zoneSeatsText(hoveredOccupancy)}`}
                </p>
            </div>

            <div className="live-seating-zones">
                {zones.map((zone) => {
                    const isOwn = zone.name === ownZone;

                    return (
                        <button
                            key={zone.name}
                            type="button"
                            className="live-seating-zone"
                            data-zone={zone.name}
                            data-hovered={hoveredZone === zone.name ? '' : undefined}
                            data-own={isOwn ? '' : undefined}
                            disabled={zone.capacity === 0}
                            onMouseEnter={() => setFocusedZone(zone.name)}
                            onMouseLeave={() => setFocusedZone(null)}
                            onFocus={() => setFocusedZone(zone.name)}
                            onBlur={() => setFocusedZone(null)}
                        >
                            <span className="live-seating-zone-title">
                                {ZONE_LABELS[zone.name]}
                            </span>
                            <span className="live-seating-zone-seats">{zoneSeatsText(zone)}</span>
                            {isOwn && <span className="live-seating-zone-own">Your zone</span>}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
