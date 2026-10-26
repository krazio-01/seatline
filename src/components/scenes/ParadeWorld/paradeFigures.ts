import {
    Group,
    InstancedBufferAttribute,
    InstancedMesh,
    Matrix4,
    MeshDepthMaterial,
    MeshLambertMaterial,
    Quaternion,
    RGBADepthPacking,
    Vector3,
    type Material,
} from 'three';
import {
    CADET_JOINTS,
    cadetGeometry,
    cadetShadowGeometry,
    LIMB,
} from '@/components/scenes/ParadeWorld/paradeAnatomy';
import { SHADOW_PROXY_MATERIAL } from '@/components/scenes/ParadeWorld/paradeGarden';
import {
    COMMANDER_LEAD,
    CONTINGENTS,
    FILES,
    GUARD_COLUMNS,
    GUARD_ROWS,
    GUARD_SQUADS,
    LANE_Z,
    MARCH_FADE,
    MARCH_SPAN,
    MARCH_SPEED,
    RANK_SPACING,
    RANKS,
    SQUAD_LENGTH,
} from '@/components/scenes/paradeLayout';
import { WORLD_LAYERS } from '@/components/scenes/ParadeWorld/paradeScenery';

export type ParadeFigures = {
    group: Group;
    cadets: InstancedMesh;
    shadows: InstancedMesh;
    marchTime: { value: number };
    dispose: () => void;
};

type AddCadet = (
    x: number,
    z: number,
    yaw: number,
    isMarching: boolean,
    carries: 'sword' | 'rifle',
    start: number,
) => void;

const STEP_RATE = 5.969;
const FILE_SPACING = 0.95;

const MARCH_ALONG = `mod(aStart + uMarchTime * ${MARCH_SPEED.toFixed(2)}, ${MARCH_SPAN.toFixed(1)})`;

const END_FADE = `smoothstep(0.0, ${MARCH_FADE.toFixed(1)}, ${MARCH_ALONG}) * (1.0 - smoothstep(${(MARCH_SPAN - MARCH_FADE).toFixed(1)}, ${MARCH_SPAN.toFixed(1)}, ${MARCH_ALONG}))`;

const DITHER_SHADER = `
    varying float vMarchFade;
    float ditherNoise() {
        return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    }`;

const POSE_SHADER = `
    uniform float uMarchTime;
    varying float vMarchFade;
    attribute float aLimb;
    attribute float aMarch;
    attribute float aSword;
    attribute float aRifle;
    attribute float aStart;
    vec3 rotateAroundX(vec3 point, vec3 pivot, float angle) {
        vec3 local = point - pivot;
        float c = cos(angle);
        float s = sin(angle);
        return vec3(local.x, local.y * c - local.z * s, local.y * s + local.z * c) + pivot;
    }
    vec3 marchOffset() {
        return vec3(0.0, abs(sin(uMarchTime * ${STEP_RATE.toFixed(3)})) * 0.035 * aMarch, aMarch * ${MARCH_ALONG});
    }
    vec3 poseCadet(vec3 point, bool isDirection) {
        float limb = aLimb;
        if (limb < 0.5) return isDirection ? point : point + marchOffset();
        if (limb > ${(LIMB.rifle - 0.5).toFixed(1)}) return isDirection ? point : point * aRifle + marchOffset();
        bool isRight = limb > ${(LIMB.sword - 0.5).toFixed(1)} || mod(limb, 2.0) < 0.5;
        float side = isRight ? 1.0 : -1.0;
        float phase = uMarchTime * ${STEP_RATE.toFixed(3)} + (isRight ? 3.14159 : 0.0);
        float stride = sin(phase);
        float thigh = -0.5 * stride * aMarch;
        float knee = (0.08 + 0.8 * max(0.0, cos(phase))) * aMarch;
        float swing = stride * (stride < 0.0 ? 1.1 : 0.45) * aMarch;
        bool holdsSword = isRight && aSword > 0.5;
        bool holdsRifle = !isRight && aRifle > 0.5;
        float shoulderAngle = holdsSword ? -0.25 : holdsRifle ? -0.12 : swing;
        float elbowAngle = holdsSword ? -0.55 : holdsRifle ? -1.45 : -0.12 * aMarch;
        vec3 hip = isDirection ? vec3(0.0) : vec3(${CADET_JOINTS.hipX.toFixed(3)} * side, ${CADET_JOINTS.hipY.toFixed(3)}, 0.0);
        vec3 kneePivot = isDirection ? vec3(0.0) : vec3(${CADET_JOINTS.hipX.toFixed(3)} * side, ${CADET_JOINTS.kneeY.toFixed(3)}, 0.0);
        vec3 shoulder = isDirection ? vec3(0.0) : vec3(${CADET_JOINTS.shoulderX.toFixed(3)} * side, ${CADET_JOINTS.shoulderY.toFixed(3)}, 0.0);
        vec3 elbow = isDirection ? vec3(0.0) : vec3(${CADET_JOINTS.shoulderX.toFixed(3)} * side, ${CADET_JOINTS.elbowY.toFixed(3)}, 0.0);
        if (limb < ${(LIMB.leftShin - 0.5).toFixed(1)}) point = rotateAroundX(point, hip, thigh);
        else if (limb < ${(LIMB.leftArm - 0.5).toFixed(1)}) point = rotateAroundX(rotateAroundX(point, kneePivot, knee), hip, thigh);
        else if (limb < ${(LIMB.leftForearm - 0.5).toFixed(1)}) point = rotateAroundX(point, shoulder, shoulderAngle);
        else point = rotateAroundX(rotateAroundX(point, elbow, elbowAngle), shoulder, shoulderAngle);
        if (isDirection) return point;
        if (limb > ${(LIMB.sword - 0.5).toFixed(1)}) point *= aSword;
        return point + marchOffset();
    }`;

function poseMaterial<Target extends Material>(
    material: Target,
    marchTime: { value: number },
    posesNormals: boolean,
    fadesAtEnds: boolean,
): Target {
    const fade = fadesAtEnds ? `mix(1.0, ${END_FADE}, aMarch)` : '1.0';

    material.onBeforeCompile = (shader) => {
        shader.uniforms.uMarchTime = marchTime;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>\n${POSE_SHADER}`,
        );
        if (posesNormals) {
            shader.vertexShader = shader.vertexShader.replace(
                '#include <beginnormal_vertex>',
                '#include <beginnormal_vertex>\nobjectNormal = poseCadet(objectNormal, true);',
            );
        }
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>\ntransformed = poseCadet(transformed, false);\nvMarchFade = ${fade};`,
        );
        if (!fadesAtEnds) return;

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>\n${DITHER_SHADER}`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <clipping_planes_fragment>',
            '#include <clipping_planes_fragment>\nif (vMarchFade < 0.999 && ditherNoise() > vMarchFade) discard;',
        );
    };
    material.customProgramCacheKey = () =>
        `parade-cadet-${posesNormals ? 'surface' : 'depth'}-${fadesAtEnds ? 'fading' : 'solid'}`;

    return material;
}

function buildCadets(
    count: number,
    fadesAtEnds: boolean,
    place: (addCadet: AddCadet) => void,
): ParadeFigures {
    const marchTime = { value: 0 };
    const geometry = cadetGeometry();
    const proxyGeometry = cadetShadowGeometry();
    const surface = poseMaterial(
        new MeshLambertMaterial({ vertexColors: true }),
        marchTime,
        true,
        fadesAtEnds,
    );
    const depth = poseMaterial(
        new MeshDepthMaterial({ depthPacking: RGBADepthPacking }),
        marchTime,
        false,
        fadesAtEnds,
    );
    const cadets = new InstancedMesh(geometry, surface, count);
    const marching = new Float32Array(count);
    const swords = new Float32Array(count);
    const rifles = new Float32Array(count);
    const starts = new Float32Array(count);
    const matrix = new Matrix4();
    const rotation = new Quaternion();
    const position = new Vector3();
    const unitScale = new Vector3(1, 1, 1);
    const yAxis = new Vector3(0, 1, 0);
    let index = 0;

    place((x, z, yaw, isMarching, carries, start) => {
        rotation.setFromAxisAngle(yAxis, yaw);
        matrix.compose(position.set(x, 0, z), rotation, unitScale);
        cadets.setMatrixAt(index, matrix);
        marching[index] = isMarching ? 1 : 0;
        swords[index] = carries === 'sword' ? 1 : 0;
        rifles[index] = carries === 'rifle' ? 1 : 0;
        starts[index] = start;
        index += 1;
    });

    const instanceAttributes = {
        aMarch: marching,
        aSword: swords,
        aRifle: rifles,
        aStart: starts,
    };
    for (const [name, values] of Object.entries(instanceAttributes)) {
        const attribute = new InstancedBufferAttribute(values, 1);
        geometry.setAttribute(name, attribute);
        proxyGeometry.setAttribute(name, attribute);
    }

    cadets.receiveShadow = true;
    cadets.frustumCulled = false;
    cadets.layers.set(WORLD_LAYERS.detail);

    const shadows = new InstancedMesh(proxyGeometry, SHADOW_PROXY_MATERIAL, count);
    shadows.instanceMatrix.copy(cadets.instanceMatrix);
    shadows.customDepthMaterial = depth;
    shadows.castShadow = true;
    shadows.frustumCulled = false;
    shadows.layers.set(WORLD_LAYERS.shadow);

    const group = new Group();
    group.add(cadets, shadows);

    return {
        group,
        cadets,
        shadows,
        marchTime,
        dispose: () => {
            cadets.dispose();
            shadows.dispose();
            geometry.dispose();
            proxyGeometry.dispose();
            surface.dispose();
            depth.dispose();
        },
    };
}

function placeContingent(addCadet: AddCadet, baseX: number, laneZ: number, start: number) {
    addCadet(baseX, laneZ, Math.PI / 2, true, 'sword', start + COMMANDER_LEAD);

    for (let rank = 0; rank < RANKS; rank += 1) {
        for (let file = 0; file < FILES; file += 1) {
            addCadet(
                baseX,
                laneZ + (file - (FILES - 1) / 2) * FILE_SPACING,
                Math.PI / 2,
                true,
                'rifle',
                start - rank * RANK_SPACING,
            );
        }
    }
}

export function buildFigures(): ParadeFigures {
    const count =
        CONTINGENTS * (FILES * RANKS + 1) + GUARD_SQUADS.length * GUARD_ROWS * GUARD_COLUMNS;

    return buildCadets(count, true, (addCadet) => {
        for (let contingent = 0; contingent < CONTINGENTS; contingent += 1) {
            placeContingent(
                addCadet,
                -MARCH_SPAN / 2,
                LANE_Z,
                contingent * (MARCH_SPAN / CONTINGENTS),
            );
        }

        for (const squadX of GUARD_SQUADS) {
            for (let row = 0; row < GUARD_ROWS; row += 1) {
                for (let column = 0; column < GUARD_COLUMNS; column += 1) {
                    addCadet(
                        squadX + (column - (GUARD_COLUMNS - 1) / 2) * FILE_SPACING,
                        -6 + row * RANK_SPACING,
                        Math.PI,
                        false,
                        'rifle',
                        0,
                    );
                }
            }
        }
    });
}

export function buildSquad(entryX: number, laneZ: number): ParadeFigures {
    return buildCadets(FILES * RANKS + 1, false, (addCadet) =>
        placeContingent(addCadet, entryX - SQUAD_LENGTH, laneZ, (RANKS - 1) * RANK_SPACING),
    );
}
