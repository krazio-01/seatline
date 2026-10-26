import {
    HalfFloatType,
    Vector2,
    WebGLRenderTarget,
    type Object3D,
    type PerspectiveCamera,
    type Scene,
    type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';

export type ParadeEffects = {
    composer: EffectComposer;
    aoPass: GTAOPass;
    bloom: UnrealBloomPass;
    tiltHorizontal: ShaderPass;
    tiltVertical: ShaderPass;
    film: ShaderPass;
    setSize: (width: number, height: number, pixelRatio: number) => void;
    dispose: () => void;
};

const FILM_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uVignette: { value: 0.4 },
        uGrain: { value: 0.03 },
        uSaturation: { value: 1 },
        uContrast: { value: 1 },
        uWarmth: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uGrain; uniform float uSaturation; uniform float uContrast; uniform float uWarmth;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
            color.rgb = mix(vec3(luma), color.rgb, uSaturation);
            color.rgb = max((color.rgb - 0.18) * uContrast + 0.18, 0.0);
            color.rgb = mix(color.rgb, color.rgb * vec3(1.035, 1.0, 0.94), uWarmth * smoothstep(0.35, 1.0, luma));
            color.rgb += uWarmth * vec3(-0.012, 0.0, 0.016) * (1.0 - smoothstep(0.0, 0.5, luma));
            float distanceFromCenter = distance(vUv, vec2(0.5));
            color.rgb *= 1.0 - uVignette * smoothstep(0.3, 0.85, distanceFromCenter);
            color.rgb += (hash(vUv * vec2(1280.0, 720.0) + fract(uTime) * 91.0) - 0.5) * uGrain;
            gl_FragColor = color;
        }`,
};

const AO_SETTINGS = { radius: 1.1, distanceExponent: 1.4, thickness: 1.2, scale: 1.15, samples: 8 };

export function buildEffects(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    hideFromOcclusion: Object3D[],
    samples: number,
): ParadeEffects {
    const size = renderer.getDrawingBufferSize(new Vector2());
    const composer = new EffectComposer(
        renderer,
        new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples }),
    );
    composer.addPass(new RenderPass(scene, camera));

    const aoPass = new GTAOPass(scene, camera, size.x, size.y);
    aoPass.updateGtaoMaterial(AO_SETTINGS);
    aoPass.blendIntensity = 1;

    const renderOcclusion = aoPass.render.bind(aoPass);
    const occlusionVisibility = hideFromOcclusion.map((object) => object.visible);
    aoPass.render = (...passArguments: Parameters<GTAOPass['render']>) => {
        for (let index = 0; index < hideFromOcclusion.length; index += 1) {
            occlusionVisibility[index] = hideFromOcclusion[index].visible;
            hideFromOcclusion[index].visible = false;
        }
        renderOcclusion(...passArguments);
        for (let index = 0; index < hideFromOcclusion.length; index += 1) {
            hideFromOcclusion[index].visible = occlusionVisibility[index];
        }
    };
    composer.addPass(aoPass);

    const bloom = new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.6, 0.55, 0.78);
    composer.addPass(bloom);

    const tiltHorizontal = new ShaderPass(HorizontalTiltShiftShader);
    const tiltVertical = new ShaderPass(VerticalTiltShiftShader);
    composer.addPass(tiltHorizontal);
    composer.addPass(tiltVertical);

    const film = new ShaderPass(FILM_SHADER);
    composer.addPass(film);
    composer.addPass(new OutputPass());

    const setSize = (width: number, height: number, pixelRatio: number) => {
        composer.setPixelRatio(pixelRatio);
        composer.setSize(width, height);
        bloom.setSize(Math.round((width * pixelRatio) / 2), Math.round((height * pixelRatio) / 2));
        aoPass.setSize(Math.round((width * pixelRatio) / 2), Math.round((height * pixelRatio) / 2));
    };

    return {
        composer,
        aoPass,
        bloom,
        tiltHorizontal,
        tiltVertical,
        film,
        setSize,
        dispose: () => {
            for (const pass of composer.passes) pass.dispose();
            composer.dispose();
        },
    };
}
