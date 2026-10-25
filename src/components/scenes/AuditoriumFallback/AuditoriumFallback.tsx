'use client';
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import './auditoriumFallback.scss';
import { classNames } from '@/utils/class-names';
import {
    AUDITORIUM_CAMERA,
    auditoriumRestView,
    createOrbitProjection,
    type OrbitProjection,
} from '@/components/scenes/cameraMath';
import {
    CHAIR_PROFILE,
    computeHallLayout,
    computeHighlightFocus,
    computeRowEnds,
    computeSeatLayout,
    FRONT_ROW_Z,
    ROW_RISE,
    ROW_SPACING,
    SEAT_COLORS,
    SEAT_SPACING,
    seatStatus,
    zoneRowCount,
    zoneSeatKeys,
    zoneSeatStates,
    zoneSignPositions,
    type HallLayout,
    type Point3,
    type SeatStatus,
} from '@/components/scenes/seatLayout';
import { useZoneSeating } from '@/hooks/useZoneSeating';
import { ZONE_LABELS, type ZoneName, type ZoneOccupancy } from '@/types/booking';

type DrawingSize = { width: number; height: number };

type HallDrawingInput = {
    seating: { name: ZoneName; capacity: number }[];
    zones: ZoneOccupancy[];
    highlightedZone: ZoneName | undefined;
    eventName: string;
    variant: 'booking' | 'admin';
    size: DrawingSize;
    idPrefix: string;
};

const REFERENCE_SIZE: DrawingSize = { width: 600, height: 400 };
const EMPTY_ZONES: ZoneOccupancy[] = [];
const ZONE_SIGN_HEIGHT = 0.65;
const ZONE_SIGN_FONT_RATIO = 130 / 256;
const RUNNER_LIFT = 0.012;
const FLOOR_THICKNESS = 0.2;
const SCREEN_LABEL = { textureHeight: 512, fontSize: 190, padding: 124, textureWidth: 2048 };
const AVERAGE_GLYPH_WIDTH = 0.66;
const LABEL_LETTER_SPACING = 0.12;
const MARKER_SEGMENTS = 32;
const MARKER_WIDTH = 0.08;

const GRADIENT_COLORS = {
    shadow: '#18181b',
    screen: '#141418',
    screenGlow: '#1f1f26',
    beam: '#ffe2b0',
    pool: '#ffd9a0',
    stepGlow: '#f5b544',
};

const roundTo = (value: number, digits: number) => {
    const factor = 10 ** digits;

    return Math.round(value * factor) / factor;
};

function polygon(projection: OrbitProjection, points: Point3[]): string {
    return points
        .map((point) => {
            const { x, y } = projection.project(point);

            return `${roundTo(x, 1)},${roundTo(y, 1)}`;
        })
        .join(' ');
}

function box(x: [number, number], y: [number, number], z: [number, number]) {
    return {
        top: [
            [x[0], y[1], z[0]],
            [x[1], y[1], z[0]],
            [x[1], y[1], z[1]],
            [x[0], y[1], z[1]],
        ] as Point3[],
        back: [
            [x[0], y[0], z[1]],
            [x[1], y[0], z[1]],
            [x[1], y[1], z[1]],
            [x[0], y[1], z[1]],
        ] as Point3[],
    };
}

function riserZ(row: number): number {
    return FRONT_ROW_Z + row * ROW_SPACING - ROW_SPACING / 2;
}

function ellipseAt(projection: OrbitProjection, center: Point3, width: number, depth: number) {
    const [x, y, z] = center;
    const middle = projection.project(center);
    const left = projection.project([x - width / 2, y, z]);
    const right = projection.project([x + width / 2, y, z]);
    const near = projection.project([x, y, z + depth / 2]);
    const far = projection.project([x, y, z - depth / 2]);

    return {
        cx: roundTo(middle.x, 1),
        cy: roundTo(middle.y, 1),
        rx: roundTo(Math.abs(right.x - left.x) / 2, 1),
        ry: roundTo(Math.abs(near.y - far.y) / 2, 1),
    };
}

function chairPolygons(projection: OrbitProjection): { shape: string; tone: string }[] {
    const { right, up } = projection;
    const { width, cushion, backrest, shell, arm } = CHAIR_PROFILE;
    const halfWidth = width / 2;
    const tiltCos = Math.cos(backrest.tilt);
    const tiltSin = Math.sin(backrest.tilt);

    const toSymbol = ([x, y, z]: Point3) =>
        `${roundTo(x * right[0] + y * right[1] + z * right[2], 3)},${roundTo(
            -(x * up[0] + y * up[1] + z * up[2]),
            3,
        )}`;

    const onBackrest = (x: number, localY: number, localZ: number): Point3 => [
        x,
        backrest.y + localY * tiltCos - localZ * tiltSin,
        backrest.z + localY * tiltSin + localZ * tiltCos - backrest.bend * x * x,
    ];

    const leftToRight = [-1, 0, 1];
    const rightToLeft = [1, 0, -1];

    const slabFaces = (half: number, bottom: number, top: number, front: number, back: number) => ({
        top: [
            ...leftToRight.map((side) => onBackrest(side * half, top, front)),
            ...rightToLeft.map((side) => onBackrest(side * half, top, back)),
        ],
        back: [
            ...leftToRight.map((side) => onBackrest(side * half, bottom, back)),
            ...rightToLeft.map((side) => onBackrest(side * half, top, back)),
        ],
    });

    const cushionTop = cushion.y + cushion.height / 2;
    const pad = slabFaces(
        halfWidth,
        -backrest.height / 2,
        backrest.height / 2,
        -backrest.depth / 2,
        backrest.depth / 2,
    );
    const shellHalf = halfWidth + shell.extraWidth / 2;
    const shellFaces = slabFaces(
        shellHalf,
        shell.offsetY - shell.height / 2,
        shell.offsetY + shell.height / 2,
        shell.offsetZ - shell.depth / 2,
        shell.offsetZ + shell.depth / 2,
    );
    const armX = -SEAT_SPACING / 2;
    const armTop = arm.y + arm.height / 2;

    const faces: { points: Point3[]; tone: string }[] = [
        {
            tone: 'shadow',
            points: [
                [-0.525, 0.008, -0.375],
                [0.525, 0.008, -0.375],
                [0.525, 0.008, 0.575],
                [-0.525, 0.008, 0.575],
            ],
        },
        {
            tone: 'fabric-top',
            points: [
                [-halfWidth, cushionTop, cushion.z - cushion.depth / 2],
                [halfWidth, cushionTop, cushion.z - cushion.depth / 2],
                [halfWidth, cushionTop, cushion.z + cushion.depth / 2],
                [-halfWidth, cushionTop, cushion.z + cushion.depth / 2],
            ],
        },
        {
            tone: 'shell',
            points: [
                [armX - arm.width / 2, armTop, arm.z - arm.depth / 2],
                [armX + arm.width / 2, armTop, arm.z - arm.depth / 2],
                [armX + arm.width / 2, armTop, arm.z + arm.depth / 2],
                [armX - arm.width / 2, armTop, arm.z + arm.depth / 2],
            ],
        },
        { tone: 'fabric-top', points: pad.top },
        { tone: 'fabric', points: pad.back },
        { tone: 'shell-top', points: shellFaces.top },
        { tone: 'shell', points: shellFaces.back },
    ];

    return faces.map((face) => ({ shape: face.points.map(toSymbol).join(' '), tone: face.tone }));
}

function drawHall({
    seating,
    zones,
    highlightedZone,
    eventName,
    variant,
    size,
    idPrefix,
}: HallDrawingInput): ReactNode[] {
    const rows = zoneRowCount(seating);
    const hall: HallLayout = computeHallLayout(seating);
    const layout = computeSeatLayout(seating);
    const seatStates = zoneSeatStates(zones);
    const highlightFocus = highlightedZone
        ? computeHighlightFocus(
              zoneSeatKeys(layout, highlightedZone),
              layout,
              hall.width,
              AUDITORIUM_CAMERA.highlightYaw,
          )
        : null;
    const view = auditoriumRestView(highlightFocus?.yaw ?? null);
    const projection = createOrbitProjection(
        {
            points: hall.extents,
            yaw: view.yaw,
            elevation: view.elevation,
            verticalFov: AUDITORIUM_CAMERA.fov,
            aspect: size.width / size.height,
            margin: AUDITORIUM_CAMERA.margin,
        },
        AUDITORIUM_CAMERA.tiltRange,
        size,
    );

    const { floor, stage, backWall, curtain, valance, screen, runnerWidth } = hall;
    const halfFloor = floor.width / 2;
    const floorBack = floor.z + floor.depth / 2;
    const stageBack = floor.z - floor.depth / 2;
    const topHeight = (rows - 1) * ROW_RISE;
    const gradient = (name: string) => `url(#${idPrefix}-${name})`;
    const elements: ReactNode[] = [];

    const statusColors: Record<SeatStatus, string> = {
        available: SEAT_COLORS.available,
        booked: variant === 'admin' ? SEAT_COLORS.adminBooked : SEAT_COLORS.booked,
        checkedIn: SEAT_COLORS.checkedIn,
    };

    const add = (key: string, element: ReactNode) =>
        elements.push(<Fragment key={key}>{element}</Fragment>);

    const shadow = ellipseAt(
        projection,
        [0, -0.21, floor.z + floor.depth * 0.04],
        floor.width * 1.3,
        floor.depth * 1.3,
    );
    add('shadow', <ellipse {...shadow} fill={gradient('shadow')} />);

    const profile: [number, number][] = [
        [stageBack, -FLOOR_THICKNESS],
        [stageBack, 0],
    ];

    for (let row = 1; row < rows; row += 1) {
        profile.push([riserZ(row), (row - 1) * ROW_RISE], [riserZ(row), row * ROW_RISE]);
    }

    profile.push([floorBack, topHeight], [floorBack, -FLOOR_THICKNESS]);

    for (const side of [-1, 1]) {
        const isFacingCamera = (projection.cameraPosition[0] - side * halfFloor) * side > 0;

        if (!isFacingCamera) continue;

        add(
            `side-${side}`,
            <polygon
                points={polygon(
                    projection,
                    profile.map(([z, y]) => [side * halfFloor, y, z]),
                )}
                className="auditorium-fallback-plinth-side"
            />,
        );
    }

    add(
        'floor',
        <polygon
            points={polygon(
                projection,
                box(
                    [-halfFloor, halfFloor],
                    [-FLOOR_THICKNESS, 0],
                    [stageBack, rows > 1 ? riserZ(1) : floorBack],
                ).top,
            )}
            className="auditorium-fallback-floor"
        />,
    );

    const wallHalf = (backWall.width + 0.2) / 2;
    add(
        'back-wall',
        <polygon
            points={polygon(projection, [
                [-wallHalf, 0, backWall.z],
                [wallHalf, 0, backWall.z],
                [wallHalf, backWall.height, backWall.z],
                [-wallHalf, backWall.height, backWall.z],
            ])}
            className="auditorium-fallback-back-wall"
        />,
    );

    const frameHalf = (screen.width + 0.24) / 2;
    const frameHalfHeight = (screen.height + 0.24) / 2;
    add(
        'screen-frame',
        <polygon
            points={polygon(projection, [
                [-frameHalf, screen.y - frameHalfHeight, screen.z],
                [frameHalf, screen.y - frameHalfHeight, screen.z],
                [frameHalf, screen.y + frameHalfHeight, screen.z],
                [-frameHalf, screen.y + frameHalfHeight, screen.z],
            ])}
            className="auditorium-fallback-screen-frame"
        />,
    );

    const screenCenter = projection.project([0, screen.y, screen.z]);
    const screenPixels = projection.pixelsPerUnit(screenCenter.depth);
    const labelMaxWidth =
        screen.width *
        ((SCREEN_LABEL.textureWidth - SCREEN_LABEL.padding * 2) / SCREEN_LABEL.textureWidth) *
        screenPixels;
    const baseFontSize =
        ((screen.height * SCREEN_LABEL.fontSize) / SCREEN_LABEL.textureHeight) * screenPixels;
    const estimatedWidth =
        Array.from(eventName).length * baseFontSize * (AVERAGE_GLYPH_WIDTH + LABEL_LETTER_SPACING);
    const labelFontSize = baseFontSize * Math.min(1, labelMaxWidth / Math.max(1, estimatedWidth));

    add(
        'screen',
        <>
            <polygon
                points={polygon(projection, [
                    [-screen.width / 2, screen.y - screen.height / 2, screen.z],
                    [screen.width / 2, screen.y - screen.height / 2, screen.z],
                    [screen.width / 2, screen.y + screen.height / 2, screen.z],
                    [-screen.width / 2, screen.y + screen.height / 2, screen.z],
                ])}
                fill={gradient('screen')}
            />
            <text
                className="auditorium-fallback-screen-label"
                x={roundTo(screenCenter.x, 1)}
                y={roundTo(screenCenter.y, 1)}
                fontSize={roundTo(labelFontSize, 1)}
            >
                {eventName}
            </text>
        </>,
    );

    for (const side of [-1, 1]) {
        const centerX = side * curtain.x;

        add(
            `curtain-${side}`,
            <polygon
                points={polygon(projection, [
                    [centerX - curtain.width / 2, 0, curtain.z],
                    [centerX + curtain.width / 2, 0, curtain.z],
                    [centerX + curtain.width / 2, curtain.height, curtain.z],
                    [centerX - curtain.width / 2, curtain.height, curtain.z],
                ])}
                fill={gradient('curtain')}
            />,
        );
    }

    add(
        'valance',
        <polygon
            points={polygon(projection, [
                [-wallHalf, valance.y - valance.height / 2, curtain.z + 0.08],
                [wallHalf, valance.y - valance.height / 2, curtain.z + 0.08],
                [wallHalf, valance.y + valance.height / 2, curtain.z + 0.08],
                [-wallHalf, valance.y + valance.height / 2, curtain.z + 0.08],
            ])}
            fill={gradient('curtain')}
        />,
    );

    const stageBox = box(
        [-stage.width / 2, stage.width / 2],
        [0, stage.height],
        [stage.z - stage.depth / 2, stage.frontZ],
    );

    add(
        'stage',
        <>
            <polygon
                points={polygon(projection, stageBox.top)}
                className="auditorium-fallback-stage-top"
            />
            <polygon
                points={polygon(projection, stageBox.back)}
                className="auditorium-fallback-stage-front"
            />
            <polygon
                points={polygon(projection, [
                    [-stage.width / 2, stage.height - 0.03, stage.frontZ + 0.012],
                    [stage.width / 2, stage.height - 0.03, stage.frontZ + 0.012],
                    [stage.width / 2, stage.height, stage.frontZ + 0.012],
                    [-stage.width / 2, stage.height, stage.frontZ + 0.012],
                ])}
                className="auditorium-fallback-stage-strip"
            />
        </>,
    );

    const stageLabel = projection.project([0, stage.height * 0.45, stage.frontZ]);
    const stageLabelHeight = Math.min(1, stage.width * 0.1);
    add(
        'stage-label',
        <text
            className="auditorium-fallback-stage-label"
            x={roundTo(stageLabel.x, 1)}
            y={roundTo(stageLabel.y, 1)}
            fontSize={roundTo(
                ((stageLabelHeight * 110) / 256) * projection.pixelsPerUnit(stageLabel.depth),
                1,
            )}
        >
            STAGE
        </text>,
    );

    const beamSourceY = backWall.height + stage.width * 0.18;
    const beamSourceZ = stage.frontZ + stage.width * 0.22;

    for (const side of [-1, 1]) {
        const source: Point3 = [side * stage.width * 0.34, beamSourceY, beamSourceZ];
        const target: Point3 = [side * stage.width * 0.13, stage.height + 0.01, stage.z + 0.2];
        const length = Math.hypot(
            source[0] - target[0],
            source[1] - target[1],
            source[2] - target[2],
        );
        const radius = length * 0.2;
        const pool = ellipseAt(projection, target, radius * 2.6, radius * 2);

        add(
            `beam-${side}`,
            <>
                <polygon
                    points={polygon(projection, [
                        [source[0] - radius * 0.06, source[1], source[2]],
                        [source[0] + radius * 0.06, source[1], source[2]],
                        [target[0] + radius, target[1], target[2]],
                        [target[0] - radius, target[1], target[2]],
                    ])}
                    fill={gradient('beam')}
                />
                <ellipse {...pool} fill={gradient('pool')} />
            </>,
        );
    }

    const runnerHalf = runnerWidth / 2;
    const apronFront = FRONT_ROW_Z + ROW_SPACING / 2;
    add(
        'runner-apron',
        <polygon
            points={polygon(
                projection,
                box([-runnerHalf, runnerHalf], [0, RUNNER_LIFT], [stage.frontZ, apronFront]).top,
            )}
            className="auditorium-fallback-runner"
        />,
    );

    const chairs = chairPolygons(projection);
    const rowSymbols: ReactNode[] = [];
    const rowEnds = computeRowEnds(seating);

    zoneSignPositions(layout).forEach(({ zone, position }) => {
        const center = projection.project(position);
        const scale = projection.pixelsPerUnit(center.depth);

        add(
            `zone-sign-${zone}`,
            <text
                className="auditorium-fallback-zone-sign"
                data-zone={zone}
                data-highlighted={zone === highlightedZone ? 'true' : undefined}
                x={roundTo(center.x, 1)}
                y={roundTo(center.y, 1)}
                fontSize={roundTo(ZONE_SIGN_HEIGHT * ZONE_SIGN_FONT_RATIO * scale, 1)}
            >
                {ZONE_LABELS[zone]}
            </text>,
        );
    });
    const markerRow = highlightFocus
        ? Math.min(
              rows - 1,
              Math.max(
                  0,
                  Math.round(
                      (highlightFocus.center[2] - highlightFocus.radius - FRONT_ROW_Z) /
                          ROW_SPACING,
                  ),
              ),
          )
        : -1;

    for (let row = 0; row < rows; row += 1) {
        const treadY = row * ROW_RISE;

        if (row > 0) {
            const treadFront = riserZ(row);
            const treadBack = row === rows - 1 ? floorBack : riserZ(row + 1);
            const runnerBack = treadFront + ROW_SPACING;

            add(
                `tread-${row}`,
                <>
                    <polygon
                        points={polygon(
                            projection,
                            box([-halfFloor, halfFloor], [0, treadY], [treadFront, treadBack]).top,
                        )}
                        className="auditorium-fallback-tread"
                    />
                    <polygon
                        points={polygon(
                            projection,
                            box(
                                [-runnerHalf, runnerHalf],
                                [0, treadY + RUNNER_LIFT],
                                [treadFront, runnerBack],
                            ).top,
                        )}
                        className="auditorium-fallback-runner"
                    />
                    {[-1, 1].map((side) => (
                        <ellipse
                            key={side}
                            {...ellipseAt(
                                projection,
                                [side * (runnerHalf + 0.07), treadY + 0.016, treadFront + 0.14],
                                0.5,
                                0.42,
                            )}
                            fill={gradient('glow')}
                        />
                    ))}
                </>,
            );
        }

        if (row === markerRow && highlightFocus) {
            const [centerX, centerY, centerZ] = highlightFocus.center;
            const ring = Array.from({ length: MARKER_SEGMENTS }, (_, segment): Point3 => {
                const angle = (segment / MARKER_SEGMENTS) * Math.PI * 2;
                const radius = highlightFocus.radius + MARKER_WIDTH / 2;

                return [
                    centerX + Math.cos(angle) * radius,
                    centerY,
                    centerZ + Math.sin(angle) * radius,
                ];
            });
            const markerDepth = projection.project(highlightFocus.center).depth;

            add(
                'marker',
                <polygon
                    points={polygon(projection, ring)}
                    data-zone={highlightedZone}
                    className="auditorium-fallback-marker"
                    strokeWidth={roundTo(MARKER_WIDTH * projection.pixelsPerUnit(markerDepth), 2)}
                />,
            );
        }

        const endPanels = rowEnds[row] ?? [];
        const rowSeats = layout.filter((placement) => placement.row === row);
        if (rowSeats.length === 0) continue;

        const middleSeat = rowSeats[Math.floor(rowSeats.length / 2)];
        const rowDepth = projection.project([middleSeat.x, middleSeat.y, middleSeat.z]).depth;

        rowSymbols.push(
            <use
                key={row}
                id={`${idPrefix}r${row}`}
                href={`#${idPrefix}-chair`}
                transform={`scale(${roundTo(projection.pixelsPerUnit(rowDepth), 2)})`}
            />,
        );

        add(
            `row-${row}`,
            <>
                {endPanels.map(([x, y, z], index) => (
                    <polygon
                        key={index}
                        points={polygon(projection, [
                            [x - 0.035, y, z + 0.35],
                            [x + 0.035, y, z + 0.35],
                            [x + 0.035, y + 0.92, z - 0.31],
                            [x - 0.035, y + 0.92, z - 0.31],
                        ])}
                        className="auditorium-fallback-row-end"
                    />
                ))}
                {rowSeats.map((placement) => {
                    const status = seatStatus(placement.key, seatStates);
                    const origin = projection.project([placement.x, placement.y, placement.z]);

                    return (
                        <use
                            key={placement.key}
                            href={`#${idPrefix}r${row}`}
                            x={roundTo(origin.x, 1)}
                            y={roundTo(origin.y, 1)}
                            data-status={status === 'available' ? undefined : status}
                            color={status === 'available' ? undefined : statusColors[status]}
                        />
                    );
                })}
            </>,
        );
    }

    add(
        'plinth-front',
        <polygon
            points={polygon(projection, [
                [-halfFloor, -FLOOR_THICKNESS, floorBack],
                [halfFloor, -FLOOR_THICKNESS, floorBack],
                [halfFloor, topHeight, floorBack],
                [-halfFloor, topHeight, floorBack],
            ])}
            className="auditorium-fallback-plinth-front"
        />,
    );

    elements.unshift(
        <defs key="defs">
            <radialGradient id={`${idPrefix}-shadow`}>
                <stop offset="0" stopColor={GRADIENT_COLORS.shadow} stopOpacity={0.28} />
                <stop offset="0.45" stopColor={GRADIENT_COLORS.shadow} stopOpacity={0.15} />
                <stop offset="1" stopColor={GRADIENT_COLORS.shadow} stopOpacity={0} />
            </radialGradient>
            <radialGradient id={`${idPrefix}-screen`}>
                <stop offset="0" stopColor={GRADIENT_COLORS.screenGlow} />
                <stop offset="1" stopColor={GRADIENT_COLORS.screen} />
            </radialGradient>
            <linearGradient id={`${idPrefix}-curtain`} x2="0.25" spreadMethod="reflect">
                <stop offset="0" style={{ stopColor: 'var(--auditorium-fallback-curtain)' }} />
                <stop offset="1" style={{ stopColor: 'var(--auditorium-fallback-curtain-fold)' }} />
            </linearGradient>
            <linearGradient id={`${idPrefix}-beam`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={GRADIENT_COLORS.beam} stopOpacity={0} />
                <stop offset="1" stopColor={GRADIENT_COLORS.beam} stopOpacity={0.22} />
            </linearGradient>
            <radialGradient id={`${idPrefix}-pool`}>
                <stop offset="0" stopColor={GRADIENT_COLORS.pool} stopOpacity={0.6} />
                <stop offset="0.45" stopColor={GRADIENT_COLORS.pool} stopOpacity={0.33} />
                <stop offset="1" stopColor={GRADIENT_COLORS.pool} stopOpacity={0} />
            </radialGradient>
            <radialGradient id={`${idPrefix}-glow`}>
                <stop offset="0" stopColor={GRADIENT_COLORS.stepGlow} stopOpacity={0.7} />
                <stop offset="1" stopColor={GRADIENT_COLORS.stepGlow} stopOpacity={0} />
            </radialGradient>
            <g id={`${idPrefix}-chair`}>
                {chairs.map((face, index) => (
                    <polygon
                        key={index}
                        points={face.shape}
                        style={{ fill: `var(--auditorium-fallback-chair-${face.tone})` }}
                    />
                ))}
            </g>
            {rowSymbols}
        </defs>,
    );

    return elements;
}

export function AuditoriumFallback({
    zones = EMPTY_ZONES,
    highlightedZone,
    eventName = '',
    variant = 'booking',
    className,
}: {
    zones?: ZoneOccupancy[];
    highlightedZone?: ZoneName;
    eventName?: string;
    variant?: 'booking' | 'admin';
    className?: string;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState(REFERENCE_SIZE);
    const idPrefix = useId().replace(/[^a-zA-Z0-9-]/g, '');

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver(([entry]) => {
            const width = Math.round(entry.contentRect.width);
            const height = Math.round(entry.contentRect.height);

            if (width > 0 && height > 0) setSize({ width, height });
        });

        observer.observe(container);

        return () => observer.disconnect();
    }, []);

    const seating = useZoneSeating(zones);

    const drawing = useMemo(
        () =>
            drawHall({
                seating,
                zones,
                highlightedZone,
                eventName,
                variant,
                size,
                idPrefix,
            }),
        [seating, zones, highlightedZone, eventName, variant, size, idPrefix],
    );

    return (
        <div
            ref={containerRef}
            data-fallback="auditorium"
            className={classNames('auditorium-fallback', className)}
        >
            <svg
                className="auditorium-fallback-drawing"
                viewBox={`0 0 ${size.width} ${size.height}`}
                preserveAspectRatio="xMidYMid meet"
                color={SEAT_COLORS.available}
                aria-hidden="true"
            >
                {drawing}
            </svg>
        </div>
    );
}
