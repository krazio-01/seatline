import {
    BufferAttribute,
    CanvasTexture,
    Color,
    RepeatWrapping,
    setConsoleFunction,
    SRGBColorSpace,
    type BufferGeometry,
    type ColorRepresentation,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type CanvasTextureOptions = { repeat?: [number, number]; anisotropy?: number };

const DEPRECATED_CLOCK_WARNING = 'THREE.Clock: This module has been deprecated';

export function mergeAndDispose(parts: BufferGeometry[]): BufferGeometry {
    const isMixed = parts.some((part) => part.index === null);
    const compatible = isMixed
        ? parts.map((part) => (part.index ? part.toNonIndexed() : part))
        : parts;
    const merged = mergeGeometries(compatible);

    for (const part of new Set([...parts, ...compatible])) part.dispose();

    return merged;
}

export function seededRandom(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

export function paintGeometry(
    geometry: BufferGeometry,
    color: ColorRepresentation,
    keepIndex = false,
): BufferGeometry {
    const painted = geometry.index && !keepIndex ? geometry.toNonIndexed() : geometry;

    if (painted.attributes.uv) painted.deleteAttribute('uv');
    if (painted.attributes.uv1) painted.deleteAttribute('uv1');

    const { r, g, b } = new Color(color);
    const colors = new Float32Array(painted.attributes.position.count * 3);

    for (let offset = 0; offset < colors.length; offset += 3) colors.set([r, g, b], offset);

    painted.setAttribute('color', new BufferAttribute(colors, 3));

    return painted;
}

export function canvasTexture(
    width: number,
    height: number,
    draw: (context: CanvasRenderingContext2D, width: number, height: number) => void,
    { repeat = [1, 1], anisotropy = 1 }: CanvasTextureOptions = {},
): CanvasTexture {
    const element = document.createElement('canvas');
    element.width = width;
    element.height = height;

    const context = element.getContext('2d');
    if (context) draw(context, width, height);

    const texture = new CanvasTexture(element);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
    texture.anisotropy = anisotropy;

    return texture;
}

export function readFontFamily(
    variable: string,
    fallback: string,
): { primary: string; stack: string } {
    const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
    const primary = value.split(',')[0]?.trim() || fallback;

    return { primary, stack: value ? `${value}, ${fallback}` : fallback };
}

export function waitForFonts(fonts: string[], timeoutMs: number): Promise<unknown> {
    const loads = fonts.map((font) => document.fonts.load(font).catch(() => []));

    return Promise.race([
        Promise.all(loads),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
}

export function silenceClockDeprecation(): void {
    setConsoleFunction((type, message, ...params) => {
        if (message.startsWith(DEPRECATED_CLOCK_WARNING)) return;

        console[type](message, ...params);
    });
}
