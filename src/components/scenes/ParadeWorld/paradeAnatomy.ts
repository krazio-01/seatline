import {
    BoxGeometry,
    BufferAttribute,
    CylinderGeometry,
    IcosahedronGeometry,
    LatheGeometry,
    Quaternion,
    SphereGeometry,
    TorusGeometry,
    Vector2,
    Vector3,
    type BufferGeometry,
    type ColorRepresentation,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeAndDispose, paintGeometry } from '@/components/scenes/geometry';
import type { Point3 } from '@/components/scenes/seatLayout';

type Profile = [number, number][];

type Placement = { scale?: Point3; rotation?: Point3; position?: Point3 };

export const LIMB = {
    body: 0,
    leftThigh: 1,
    rightThigh: 2,
    leftShin: 3,
    rightShin: 4,
    leftArm: 5,
    rightArm: 6,
    leftForearm: 7,
    rightForearm: 8,
    sword: 9,
    rifle: 10,
};

export const CADET_JOINTS = {
    hipX: 0.095,
    hipY: 0.95,
    kneeY: 0.51,
    shoulderX: 0.215,
    shoulderY: 1.44,
    elbowY: 1.16,
};

export const GUEST_PART = { always: 0, firstLook: -1, secondLook: 1 };

const TUNIC = 0x5d7394;
const TROUSERS = 0x4f6386;
const CUFF = 0x4a5d7e;
const POCKET = 0x566b8c;
const CAP_BAND = 0x2c3a55;
const WHITE = 0xf5f4ef;
const BLACK = 0x121316;
const BRASS = 0xc9a24a;
const CADET_SKIN = 0xae8266;
const HAIR = 0x1b1816;
const WOOD = 0x6e4b2f;
const GUNMETAL = 0x4a4f58;
const STEEL = 0xe6e9ee;
const HILT = 0xc9a24a;
const GUEST_CLOTH = 0xffffff;
const GUEST_SHADE = 0xb8b8b8;
const GUEST_TROUSERS = 0x6a6a6a;
const GUEST_SHOES = 0x1a1a1a;
const GUEST_SKIN = 0xffffff;
const GUEST_HAIR = 0x1a1512;
const UP = new Vector3(0, 1, 0);
const TORSO_SCALE: [number, number] = [1.12, 0.74];
const HEAD_PROFILE: Profile = [
    [0, 1.6],
    [0.045, 1.605],
    [0.072, 1.63],
    [0.09, 1.67],
    [0.098, 1.71],
    [0.097, 1.75],
    [0.085, 1.79],
    [0.055, 1.82],
    [0, 1.832],
];

function lathe(profile: Profile, segments: number, [scaleX, scaleZ] = [1, 1]): BufferGeometry {
    const geometry = new LatheGeometry(
        profile.map(([radius, y]) => new Vector2(radius, y)),
        segments,
    );

    return geometry.scale(scaleX, 1, scaleZ);
}

function roundedTube(
    bottom: number,
    top: number,
    [bottomRadius, topRadius]: [number, number],
    segments: number,
): BufferGeometry {
    return lathe(
        [
            [0, bottom - bottomRadius * 0.7],
            [bottomRadius * 0.72, bottom - bottomRadius * 0.45],
            [bottomRadius, bottom],
            [topRadius, top],
            [topRadius * 0.72, top + topRadius * 0.45],
            [0, top + topRadius * 0.7],
        ],
        segments,
    );
}

function placed(geometry: BufferGeometry, [x, y, z]: Point3): BufferGeometry {
    return geometry.translate(x, y, z);
}

function mergeWelded(parts: BufferGeometry[]): BufferGeometry {
    const merged = mergeAndDispose(parts);
    const welded = mergeVertices(merged);

    merged.dispose();

    return welded;
}

function shaped(
    geometry: BufferGeometry,
    { scale = [1, 1, 1], rotation = [0, 0, 0], position = [0, 0, 0] }: Placement,
): BufferGeometry {
    geometry.scale(...scale);
    geometry.rotateX(rotation[0]);
    geometry.rotateY(rotation[1]);
    geometry.rotateZ(rotation[2]);

    return geometry.translate(...position);
}

function tagged(
    geometry: BufferGeometry,
    color: ColorRepresentation,
    attributeName: string,
    value: number,
): BufferGeometry {
    const piece = paintGeometry(geometry, color, true);
    piece.setAttribute(
        attributeName,
        new BufferAttribute(new Float32Array(piece.attributes.position.count).fill(value), 1),
    );

    return piece;
}

function limbPart(
    geometry: BufferGeometry,
    color: ColorRepresentation,
    limb: number,
): BufferGeometry {
    return tagged(geometry, color, 'aLimb', limb);
}

function headParts(skin: number, hair: number): [BufferGeometry, number][] {
    const ears = [-1, 1].map((side): [BufferGeometry, number] => [
        placed(new SphereGeometry(0.024, 6, 5).scale(0.5, 1, 0.8), [side * 0.092, 1.71, -0.005]),
        skin,
    ]);

    return [
        [lathe(HEAD_PROFILE, 12, [0.86, 1]), skin],
        [placed(new CylinderGeometry(0.052, 0.06, 0.12, 10), [0, 1.565, -0.005]), skin],
        [placed(new BoxGeometry(0.026, 0.05, 0.03).rotateX(-0.25), [0, 1.69, 0.093]), skin],
        [
            shaped(new SphereGeometry(0.104, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), {
                scale: [0.9, 1, 1],
                rotation: [-0.75, 0, 0],
                position: [0, 1.73, -0.022],
            }),
            hair,
        ],
        ...ears,
    ];
}

export function cadetGeometry(): BufferGeometry {
    const { hipX, hipY, kneeY, shoulderX, shoulderY, elbowY } = CADET_JOINTS;
    const parts: BufferGeometry[] = [];
    const body = (geometry: BufferGeometry, color: ColorRepresentation) =>
        parts.push(limbPart(geometry, color, LIMB.body));

    body(
        lathe(
            [
                [0.128, 0.985],
                [0.134, 1.08],
                [0.158, 1.24],
                [0.17, 1.35],
                [0.165, 1.43],
                [0.13, 1.49],
                [0.07, 1.535],
                [0, 1.545],
            ],
            16,
            TORSO_SCALE,
        ),
        TUNIC,
    );
    body(
        lathe(
            [
                [0.124, 0.84],
                [0.142, 0.87],
                [0.138, 0.99],
            ],
            16,
            [1.14, 0.8],
        ),
        TUNIC,
    );
    body(
        lathe(
            [
                [0.118, 0.78],
                [0.128, 0.86],
            ],
            12,
            [1.14, 0.8],
        ),
        TROUSERS,
    );
    body(
        new CylinderGeometry(0.142, 0.142, 0.055, 16, 1, true)
            .scale(1.1, 1, 0.78)
            .translate(0, 0.995, 0),
        WHITE,
    );
    body(placed(new BoxGeometry(0.06, 0.045, 0.012), [0, 0.995, 0.112]), BRASS);
    for (const y of [1.08, 1.17, 1.26, 1.35])
        body(placed(new IcosahedronGeometry(0.009, 0), [0, y, 0.74 * 0.16 + 0.005]), BRASS);
    for (const side of [-1, 1]) {
        body(placed(new BoxGeometry(0.066, 0.06, 0.01), [side * 0.078, 1.31, 0.113]), POCKET);
        body(placed(new BoxGeometry(0.07, 0.018, 0.014), [side * 0.078, 1.345, 0.115]), TUNIC);
        body(
            shaped(new BoxGeometry(0.095, 0.014, 0.058), {
                rotation: [0, 0, side * -0.18],
                position: [side * 0.15, 1.468, 0],
            }),
            TUNIC,
        );
    }
    body(
        new CylinderGeometry(0.064, 0.074, 0.065, 12, 1, true)
            .scale(1, 1, 0.92)
            .translate(0, 1.535, 0),
        TUNIC,
    );
    body(
        shaped(new TorusGeometry(0.062, 0.006, 4, 14, Math.PI), {
            rotation: [0, 0.25, Math.PI],
            position: [-0.11, 1.4, 0.07],
        }),
        WHITE,
    );

    for (const [geometry, color] of headParts(CADET_SKIN, HAIR)) body(geometry, color);

    body(
        new CylinderGeometry(0.106, 0.104, 0.03, 16, 1, true).translate(0, 1.792, -0.004),
        CAP_BAND,
    );
    body(
        lathe(
            [
                [0.106, 1.806],
                [0.128, 1.84],
                [0.132, 1.855],
                [0.12, 1.866],
                [0, 1.87],
            ],
            16,
            [1, 1.04],
        ),
        WHITE,
    );
    body(
        shaped(new CylinderGeometry(0.112, 0.112, 0.01, 12, 1, false, -Math.PI / 2, Math.PI), {
            scale: [1, 1, 0.62],
            rotation: [0.32, 0, 0],
            position: [0, 1.778, 0.032],
        }),
        BLACK,
    );
    body(
        placed(
            new CylinderGeometry(0.016, 0.016, 0.006, 10).rotateX(Math.PI / 2),
            [0, 1.815, 0.112],
        ),
        BRASS,
    );

    for (const side of [-1, 1]) {
        const isRight = side > 0;
        const x = side * hipX;
        const armX = side * shoulderX;

        parts.push(
            limbPart(
                placed(roundedTube(kneeY, hipY - 0.02, [0.064, 0.088], 10), [x, 0, 0]),
                TROUSERS,
                isRight ? LIMB.rightThigh : LIMB.leftThigh,
            ),
            limbPart(
                placed(roundedTube(0.1, kneeY + 0.02, [0.052, 0.064], 10), [x, 0, 0]),
                TROUSERS,
                isRight ? LIMB.rightShin : LIMB.leftShin,
            ),
            limbPart(
                placed(new CylinderGeometry(0.056, 0.058, 0.04, 10, 1, true), [x, 0.11, 0]),
                TROUSERS,
                isRight ? LIMB.rightShin : LIMB.leftShin,
            ),
            limbPart(
                placed(new RoundedBoxGeometry(0.1, 0.075, 0.27, 1, 0.03), [x, 0.038, 0.05]),
                BLACK,
                isRight ? LIMB.rightShin : LIMB.leftShin,
            ),
            limbPart(
                placed(roundedTube(elbowY, shoulderY + 0.02, [0.047, 0.062], 10), [armX, 0, 0]),
                TUNIC,
                isRight ? LIMB.rightArm : LIMB.leftArm,
            ),
            limbPart(
                placed(roundedTube(0.92, elbowY + 0.01, [0.04, 0.047], 8), [armX, 0, 0]),
                TUNIC,
                isRight ? LIMB.rightForearm : LIMB.leftForearm,
            ),
            limbPart(
                placed(new CylinderGeometry(0.044, 0.044, 0.03, 8, 1, true), [armX, 0.93, 0]),
                CUFF,
                isRight ? LIMB.rightForearm : LIMB.leftForearm,
            ),
            limbPart(
                placed(new SphereGeometry(0.038, 8, 6).scale(0.8, 1.25, 0.95), [armX, 0.86, 0.008]),
                WHITE,
                isRight ? LIMB.rightForearm : LIMB.leftForearm,
            ),
        );
    }

    const blade = new BoxGeometry(0.022, 0.84, 0.006).translate(0, 0.46, 0);
    const guard = new TorusGeometry(0.045, 0.006, 4, 10, Math.PI)
        .rotateY(Math.PI / 2)
        .translate(0, 0.02, 0);
    for (const [geometry, color] of [
        [blade, STEEL],
        [guard, HILT],
        [new CylinderGeometry(0.012, 0.012, 0.1, 6).translate(0, -0.04, 0), HILT],
    ] as const) {
        geometry.rotateX(0.8);
        parts.push(limbPart(geometry.translate(shoulderX, 0.86, 0.02), color, LIMB.sword));
    }

    const rifle: [BufferGeometry, number][] = [
        [new RoundedBoxGeometry(0.045, 0.2, 0.09, 1, 0.012).translate(0, 0.1, 0.01), WOOD],
        [new BoxGeometry(0.036, 0.22, 0.05).translate(0, 0.3, 0), WOOD],
        [new BoxGeometry(0.032, 0.2, 0.038).translate(0, 0.5, 0), GUNMETAL],
        [new BoxGeometry(0.024, 0.08, 0.04).translate(0, 0.47, 0.038), GUNMETAL],
        [new BoxGeometry(0.034, 0.24, 0.042).translate(0, 0.72, 0), WOOD],
        [new CylinderGeometry(0.011, 0.011, 0.26, 6).translate(0, 0.95, 0), GUNMETAL],
        [new BoxGeometry(0.008, 0.62, 0.012).translate(0.022, 0.42, -0.026), WHITE],
    ];
    for (const [geometry, color] of rifle) {
        geometry.rotateX(-Math.PI / 4);
        parts.push(limbPart(geometry.translate(-0.2, 1.14, 0.33), color, LIMB.rifle));
    }

    return mergeWelded(parts);
}

export function cadetShadowGeometry(): BufferGeometry {
    const { hipX, kneeY, shoulderX, elbowY } = CADET_JOINTS;
    const parts = [
        limbPart(roundedTube(0.86, 1.5, [0.15, 0.17], 5).scale(1.1, 1, 0.75), 0xffffff, LIMB.body),
        limbPart(new SphereGeometry(0.12, 6, 4).translate(0, 1.74, 0), 0xffffff, LIMB.body),
        limbPart(
            new CylinderGeometry(0.03, 0.03, 1, 4).rotateX(-Math.PI / 4).translate(-0.2, 1.5, 0),
            0xffffff,
            LIMB.rifle,
        ),
    ];

    for (const side of [-1, 1]) {
        const isRight = side > 0;

        parts.push(
            limbPart(
                placed(roundedTube(kneeY, 0.93, [0.065, 0.085], 4), [side * hipX, 0, 0]),
                0xffffff,
                isRight ? LIMB.rightThigh : LIMB.leftThigh,
            ),
            limbPart(
                placed(roundedTube(0.04, kneeY, [0.06, 0.065], 4), [side * hipX, 0, 0]),
                0xffffff,
                isRight ? LIMB.rightShin : LIMB.leftShin,
            ),
            limbPart(
                placed(roundedTube(elbowY, 1.44, [0.05, 0.06], 4), [side * shoulderX, 0, 0]),
                0xffffff,
                isRight ? LIMB.rightArm : LIMB.leftArm,
            ),
            limbPart(
                placed(roundedTube(0.84, elbowY, [0.045, 0.05], 4), [side * shoulderX, 0, 0]),
                0xffffff,
                isRight ? LIMB.rightForearm : LIMB.leftForearm,
            ),
        );
    }

    return mergeWelded(parts);
}

function guestPart(
    geometry: BufferGeometry,
    color: ColorRepresentation,
    part = GUEST_PART.always,
): BufferGeometry {
    return tagged(geometry, color, 'aGuestPart', part);
}

function limbBetween(from: Point3, to: Point3, radii: [number, number], segments: number) {
    const direction = new Vector3(...to).sub(new Vector3(...from));
    const geometry = roundedTube(0, direction.length(), radii, segments);

    geometry.applyQuaternion(new Quaternion().setFromUnitVectors(UP, direction.normalize()));

    return geometry.translate(...from);
}

export function seatedGuestGeometry(): { clothing: BufferGeometry; skin: BufferGeometry } {
    const clothing: BufferGeometry[] = [];
    const skin: BufferGeometry[] = [];
    const lean = -0.1;

    clothing.push(
        guestPart(
            lathe(
                [
                    [0.13, 0.5],
                    [0.142, 0.6],
                    [0.15, 0.74],
                    [0.162, 0.86],
                    [0.158, 0.95],
                    [0.12, 1.0],
                    [0.066, 1.035],
                    [0, 1.045],
                ],
                10,
                TORSO_SCALE,
            )
                .rotateX(lean)
                .translate(0, 0, -0.07),
            GUEST_CLOTH,
        ),
        guestPart(
            new RoundedBoxGeometry(0.34, 0.15, 0.32, 1, 0.06).translate(0, 0.53, -0.04),
            GUEST_TROUSERS,
            GUEST_PART.firstLook,
        ),
        guestPart(
            new BoxGeometry(0.16, 0.11, 0.4).translate(0, 0.53, 0.18),
            GUEST_CLOTH,
            GUEST_PART.secondLook,
        ),
        guestPart(
            new BoxGeometry(0.14, 0.4, 0.05).translate(0, 0.31, 0.45),
            GUEST_SHADE,
            GUEST_PART.secondLook,
        ),
        guestPart(
            shaped(new BoxGeometry(0.075, 0.62, 0.02), {
                rotation: [lean, 0, 0.62],
                position: [0.01, 0.8, -0.015],
            }),
            GUEST_SHADE,
            GUEST_PART.secondLook,
        ),
    );

    for (const side of [-1, 1]) {
        const hip: Point3 = [side * 0.095, 0.52, -0.02];
        const knee: Point3 = [side * 0.1, 0.53, 0.4];
        const ankle: Point3 = [side * 0.1, 0.1, 0.43];
        const shoulder: Point3 = [side * 0.195, 0.97, -0.1];
        const elbow: Point3 = [side * 0.21, 0.72, 0.02];
        const wrist: Point3 = [side * 0.14, 0.63, 0.26];

        clothing.push(
            guestPart(
                limbBetween(hip, knee, [0.088, 0.07], 6),
                GUEST_TROUSERS,
                GUEST_PART.firstLook,
            ),
            guestPart(
                limbBetween(knee, ankle, [0.064, 0.052], 6),
                GUEST_TROUSERS,
                GUEST_PART.firstLook,
            ),

            guestPart(limbBetween(hip, knee, [0.1, 0.09], 6), GUEST_CLOTH, GUEST_PART.secondLook),
            guestPart(
                limbBetween(knee, ankle, [0.09, 0.084], 6),
                GUEST_CLOTH,
                GUEST_PART.secondLook,
            ),
            guestPart(
                placed(new BoxGeometry(0.09, 0.07, 0.22), [side * 0.1, 0.035, 0.48]),
                GUEST_SHOES,
            ),
            guestPart(limbBetween(shoulder, elbow, [0.058, 0.05], 6), GUEST_CLOTH),
            guestPart(
                limbBetween(elbow, wrist, [0.048, 0.042], 6),
                GUEST_CLOTH,
                GUEST_PART.firstLook,
            ),
        );
        skin.push(
            guestPart(
                limbBetween(elbow, wrist, [0.04, 0.034], 6),
                GUEST_SKIN,
                GUEST_PART.secondLook,
            ),
            guestPart(
                placed(new SphereGeometry(0.042, 6, 4).scale(0.8, 0.6, 1.3), [
                    side * 0.135,
                    0.62,
                    0.31,
                ]),
                GUEST_SKIN,
            ),
        );
    }

    for (const [geometry, color] of headParts(GUEST_SKIN, GUEST_HAIR)) {
        geometry.translate(0, -0.6, -0.1);
        skin.push(guestPart(geometry, color));
    }
    skin.push(
        guestPart(
            placed(new SphereGeometry(0.06, 8, 6), [0, 1.17, -0.215]),
            GUEST_HAIR,
            GUEST_PART.secondLook,
        ),
        guestPart(
            placed(new SphereGeometry(0.098, 10, 8).scale(0.95, 1.3, 0.55), [0, 1.05, -0.17]),
            GUEST_HAIR,
            GUEST_PART.secondLook,
        ),
    );

    return { clothing: mergeWelded(clothing), skin: mergeWelded(skin) };
}
