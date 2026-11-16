// Шейдеры окружения: небо с облаками, вода, детализация ландшафта и хвои.
import * as THREE from "three";

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1.,0.)), f.x), mix(hash12(i+vec2(0.,1.)), hash12(i+vec2(1.,1.)), f.x), f.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++) { s += a*vnoise(p); p = p*2.03 + vec2(17.1, 9.2); a *= .5; } return s; }
float fbm3(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 3; i++) { s += a*vnoise(p); p = p*2.03 + vec2(17.1, 9.2); a *= .5; } return s; }
`;

export interface SkyParams {
  zenith: THREE.Color; horizon: THREE.Color; sunDir: THREE.Vector3; sunColor: THREE.Color;
  cover: number; cloudLit: THREE.Color; cloudDark: THREE.Color;
}

export function makeSkyMaterial(p: SkyParams, time: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uZenith: { value: p.zenith }, uHorizon: { value: p.horizon }, uSunDir: { value: p.sunDir }, uSunColor: { value: p.sunColor },
      uCover: { value: p.cover }, uCloudLit: { value: p.cloudLit }, uCloudDark: { value: p.cloudDark }, uTime: time,
    },
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position.z = gl_Position.w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uSunDir, uSunColor, uCloudLit, uCloudDark; uniform float uCover, uTime; varying vec3 vDir;
      ${NOISE_GLSL}
      void main(){
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.);
        vec3 col = mix(uHorizon, uZenith, pow(h, .48));
        float sd = max(dot(d, uSunDir), 0.);
        col += uSunColor * (pow(sd, 5.) * .07 + pow(sd, 48.) * .22);
        float disc = smoothstep(.99955, .9998, sd);
        if (d.y > .004) {
          vec2 uv = d.xz / (d.y + .13) * 1.5 + uTime * vec2(.007, .003);
          float n = fbm(uv * 1.2) * .7 + fbm(uv * 3.1 + 5.) * .3;
          float n2 = fbm((uv + uSunDir.xz * .14) * 1.2) * .7 + fbm((uv + uSunDir.xz * .14) * 3.1 + 5.) * .3;
          float dens = smoothstep(1. - uCover, 1. - uCover + .28, n * 1.3);
          float light = clamp(.5 + (n - n2) * 4.5, 0., 1.);
          vec3 cc = mix(uCloudDark, uCloudLit, light) + uSunColor * pow(sd, 9.) * .2 * (1. - dens * .6);
          col = mix(col, cc, dens * smoothstep(0., .2, d.y));
          disc *= 1. - dens;
        }
        col += uSunColor * disc * 14.;
        if (d.y < 0.) col = mix(uHorizon, uHorizon * .55, clamp(-d.y * 5., 0., 1.));
        gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function makeWaterMaterial(p: SkyParams, deep: THREE.Color, normals: THREE.Texture, fog: THREE.FogExp2, time: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uNormal: { value: normals }, uTime: time, uSunDir: { value: p.sunDir }, uSunColor: { value: p.sunColor },
      uZenith: { value: p.zenith }, uHorizon: { value: p.horizon }, uDeep: { value: deep },
      uFogColor: { value: fog.color }, uFogDensity: { value: fog.density },
    },
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNormal; uniform float uTime, uFogDensity;
      uniform vec3 uSunDir, uSunColor, uZenith, uHorizon, uDeep, uFogColor; varying vec3 vW;
      void main(){
        vec2 uv = vW.xz;
        vec3 n1 = texture2D(uNormal, uv * .035 + uTime * vec2(.011, .007)).xyz * 2. - 1.;
        vec3 n2 = texture2D(uNormal, uv * .11 - uTime * vec2(.013, .019)).xyz * 2. - 1.;
        vec3 n3 = texture2D(uNormal, uv * .006 + uTime * vec2(.002, .001)).xyz * 2. - 1.;
        vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
        float calm = 3. + dist * .02;
        vec3 N = normalize(vec3(n1.x + n2.x * .6 + n3.x, calm, n1.y + n2.y * .6 + n3.y));
        float fres = .025 + .975 * pow(1. - max(dot(N, V), 0.), 5.);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        vec3 sky = mix(uHorizon, uZenith, pow(R.y, .5));
        float sd = max(dot(R, uSunDir), 0.);
        vec3 col = mix(uDeep, sky, fres) + uSunColor * (pow(sd, 420.) * 9. + pow(sd, 40.) * .12);
        float f = 1. - exp(-uFogDensity * uFogDensity * dist * dist);
        gl_FragColor = vec4(mix(col, uFogColor, f), 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Процедурная детализация грунта поверх вершинных цветов: пятна мха, опад, камень на склонах, микрорельеф. */
export function makeTerrainMaterial(tintA: THREE.Color, tintB: THREE.Color, rock: THREE.Color, bump: number, roughness: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTintA = { value: tintA }; sh.uniforms.uTintB = { value: tintB }; sh.uniforms.uRock = { value: rock }; sh.uniforms.uBump = { value: bump };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos; varying float vSlope;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.)).xyz; vSlope = normal.y;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vWPos; varying float vSlope; uniform vec3 uTintA, uTintB, uRock; uniform float uBump;\n${NOISE_GLSL}`)
      .replace("#include <color_fragment>", /* glsl */ `#include <color_fragment>
        {
          float nL = fbm3(vWPos.xz * .03), nM = fbm3(vWPos.xz * .27 + 7.), nS = vnoise(vWPos.xz * 2.9), nF = vnoise(vWPos.xz * 17.);
          vec3 b = diffuseColor.rgb;
          b = mix(b, b * uTintA, smoothstep(.3, .65, nL));
          b = mix(b, uTintB, smoothstep(.5, .78, nM) * .5);
          b = mix(b, uRock, smoothstep(.9, .74, vSlope));
          b *= .72 + .34 * nS + .2 * nF;
          diffuseColor.rgb = b;
        }`)
      .replace("#include <normal_fragment_maps>", /* glsl */ `#include <normal_fragment_maps>
        {
          float e = .3; vec2 q = vWPos.xz * .8;
          float h0 = fbm3(q), hx = fbm3(q + vec2(e, 0.)), hz = fbm3(q + vec2(0., e));
          float m0 = vnoise(vWPos.xz * 6.), mx = vnoise(vWPos.xz * 6. + vec2(.5, 0.)), mz = vnoise(vWPos.xz * 6. + vec2(0., .5));
          vec3 bumpN = vec3(h0 - hx + (m0 - mx) * .35, 0., h0 - hz + (m0 - mz) * .35) * uBump;
          normal = normalize(normal + mat3(viewMatrix) * bumpN);
        }`);
  };
  return mat;
}

/** Материал кроны: покачивание на ветру, пёстрая хвоя. С атласом — ветви-карточки с альфа-тестом. */
export function makeFoliageMaterial(time: { value: number }, sway: number, map?: THREE.Texture, a2c = false): THREE.MeshStandardMaterial {
  const mat = map
    ? new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.33, alphaToCoverage: a2c })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide, flatShading: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time; sh.uniforms.uSway = { value: sway };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime, uSway; varying vec3 vWPos;")
      .replace("#include <begin_vertex>", /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float ph = ip.x * .13 + ip.z * .17;
          float k = transformed.y * transformed.y * uSway;
          transformed.x += (sin(uTime * 1.1 + ph) + .4 * sin(uTime * 2.7 + ph * 2.)) * k;
          transformed.z += (cos(uTime * .9 + ph * 1.3) + .4 * sin(uTime * 3.1 + ph)) * k * .7;
          vWPos = (instanceMatrix * vec4(transformed, 1.)).xyz;
        #else
          vWPos = transformed;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vWPos;\n${NOISE_GLSL}`)
      .replace("#include <color_fragment>", map ? /* glsl */ `#include <color_fragment>
        diffuseColor.rgb *= .8 + .4 * vnoise(vWPos.xz * .6 + vWPos.y * .3);` : /* glsl */ `#include <color_fragment>
        diffuseColor.rgb *= .62 + .6 * vnoise(vWPos.xz * 5. + vWPos.y * 7.) + .25 * vnoise(vWPos.xy * 23.);
        if (!gl_FrontFacing) diffuseColor.rgb *= .45;`);
  };
  return mat;
}

/** Финальный проход: виньетка и лёгкое зерно плёнки. */
export const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.035 }, uVignette: { value: 0.32 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = vUv - .5;
      c.rgb *= 1. - uVignette * smoothstep(.25, .85, length(q) * 1.25);
      c.rgb += (h(vUv * 911.) - .5) * uGrain;
      gl_FragColor = c;
    }`,
};
