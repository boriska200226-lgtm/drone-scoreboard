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

/** Фото-текстуры рельефа. */
export interface TerrainTextures {
  grass: THREE.Texture; grassN: THREE.Texture; meadow: THREE.Texture; dirt: THREE.Texture; dirtN: THREE.Texture;
  rock: THREE.Texture; rockN: THREE.Texture; sand: THREE.Texture;
}

/**
 * Материал земли: смешивание фото-текстур (трава, луг, лесная подстилка, грунт, песок, камень, снег) по весам,
 * с картами нормалей и подавлением видимого повтора текстур (случайные сдвиги тайлов по шуму).
 * Веса: атрибут splat (лес, грунт, песок, луг) + крутизна склона. Атрибут color — затемнение (гарь) и макровариации.
 */
export function makeTerrainMaterial(tex: TerrainTextures, opts: { snow: boolean; grassTint: THREE.Color }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      tGrass: { value: tex.grass }, tGrassN: { value: tex.grassN }, tMeadow: { value: tex.meadow }, tDirt: { value: tex.dirt },
      tDirtN: { value: tex.dirtN }, tRock: { value: tex.rock }, tRockN: { value: tex.rockN }, tSand: { value: tex.sand },
      uSnow: { value: opts.snow ? 1 : 0 }, uGrassTint: { value: opts.grassTint },
    });
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 splat;\nvarying vec3 vWPos; varying vec3 vWNrm; varying vec4 vSplat;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal); vSplat = splat;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", /* glsl */ `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm; varying vec4 vSplat;
        uniform sampler2D tGrass, tGrassN, tMeadow, tDirt, tDirtN, tRock, tRockN, tSand;
        uniform float uSnow; uniform vec3 uGrassTint;
        ${NOISE_GLSL}
        // выборка без видимого повтора: два случайных сдвига тайла, переход по шуму
        vec3 ntex(sampler2D s, vec2 uv, out float mixK, out vec2 oa, out vec2 ob) {
          float k = vnoise(uv * .37) * 8.;
          float i = floor(k), f = fract(k);
          oa = sin(vec2(3., 7.) * i); ob = sin(vec2(3., 7.) * (i + 1.));
          vec2 dx = dFdx(uv), dy = dFdy(uv);
          vec3 a = textureGrad(s, uv + oa, dx, dy).rgb, b = textureGrad(s, uv + ob, dx, dy).rgb;
          mixK = smoothstep(.2, .8, f - .1 * dot(a - b, vec3(1.)));
          return mix(a, b, mixK);
        }
        vec3 nmap(sampler2D s, vec2 uv, float k, vec2 oa, vec2 ob) {
          vec2 dx = dFdx(uv), dy = dFdy(uv);
          return mix(textureGrad(s, uv + oa, dx, dy).xyz, textureGrad(s, uv + ob, dx, dy).xyz, k) * 2. - 1.;
        }
        float tRough;
        vec3 tNormal;
      `)
      .replace("#include <map_fragment>", /* glsl */ `
        {
          vec2 w = vWPos.xz;
          float macro = fbm3(w * .006), meso = vnoise(w * .05), micro = vnoise(w * .9);
          float slope = 1. - normalize(vWNrm).y;
          float wRock = smoothstep(.2, .4, slope + (meso - .5) * .14);
          float wForest = clamp(vSplat.x, 0., 1.);
          float wDirt = clamp(vSplat.y + smoothstep(.66, .82, meso * .6 + macro * .55) * .45 * (1. - wForest), 0., 1.);
          float wSand = clamp(vSplat.z, 0., 1.);
          float wMeadow = clamp(vSplat.w, 0., 1.) * smoothstep(.42, .62, macro + micro * .1);

          float kG, kM, kD, kR, kS; vec2 aG, bG, aM, bM, aD, bD, aR, bR, aS, bS;
          vec3 grass = ntex(tGrass, w / 7., kG, aG, bG) * uGrassTint;
          vec3 meadow = ntex(tMeadow, w / 4.5, kM, aM, bM) * mix(uGrassTint, vec3(1.), .4);
          vec3 dirt = ntex(tDirt, w / 4., kD, aD, bD);
          vec3 rock = ntex(tRock, w / 6., kR, aR, bR);
          vec3 sand = ntex(tSand, w / 3., kS, aS, bS);
          // таёжная подстилка: мох, бурая хвоя, мелкие ягодники
          vec3 moss = grass * vec3(.5, .62, .38);
          vec3 needles = dirt * vec3(.62, .45, .32);
          vec3 forest = mix(moss, needles, smoothstep(.35, .7, vnoise(w * .35) + micro * .2));
          // сухие пятна и вариации тона травы
          grass *= mix(vec3(1.), vec3(1.12, 1.02, .72), smoothstep(.55, .8, macro) * .6) * (.86 + .28 * meso);

          vec3 col = grass;
          col = mix(col, meadow, wMeadow * .75);
          col = mix(col, forest, wForest);
          col = mix(col, dirt * .9, wDirt);
          col = mix(col, sand, wSand);
          col = mix(col, rock, wRock);

          vec3 nG = nmap(tGrassN, w / 7., kG, aG, bG);
          vec3 nD = nmap(tDirtN, w / 4., kD, aD, bD);
          vec3 nR = nmap(tRockN, w / 6., kR, aR, bR);
          vec3 tn = mix(nG, nD, max(wDirt, wForest * .6));
          tn = mix(tn, nD * vec3(.5, .5, 1.), wSand);
          tn = mix(tn, nR, wRock);
          float rough = mix(.94, .9, wDirt);
          rough = mix(rough, .82, wSand);
          rough = mix(rough, .72, wRock);

          if (uSnow > .5) {
            float cover = clamp(1. - wRock * .75 - wDirt * .25 - wForest * .2 + (micro - .5) * .15, 0., 1.);
            vec3 snow = vec3(.9, .93, .97) * (.92 + .08 * vnoise(w * 3.1));
            snow = mix(snow, vec3(.8, .85, .93), smoothstep(.5, .9, vnoise(w * .2)) * .3);
            col = mix(col, snow, smoothstep(.15, .6, cover));
            tn = mix(tn, vec3(nG.xy * .15, 1.), smoothstep(.15, .6, cover));
            rough = mix(rough, .5, cover);
          }
          diffuseColor.rgb = col;
          tRough = rough;
          tNormal = tn;
        }
      `)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = tRough;")
      .replace("#include <normal_fragment_maps>", /* glsl */ `#include <normal_fragment_maps>
        {
          vec3 N = normalize(vWNrm);
          vec3 T = normalize(vec3(1., 0., 0.) - N * N.x);
          vec3 B = cross(T, N);
          vec3 pn = normalize(T * tNormal.x * .9 + B * tNormal.y * .9 + N * max(tNormal.z, .2));
          normal = normalize(mat3(viewMatrix) * pn);
        }`);
  };
  return mat;
}

/**
 * Атмосфера для всех стандартных материалов: экспоненциальный туман + высотная дымка в низинах
 * и подсветка тумана в сторону солнца (рассеяние Ми). Константы вшиваются в шейдер при старте миссии.
 */
export function installAtmosphere(sunDir: THREE.Vector3, sunScatter: THREE.Color, heightDensity: number, falloff: number) {
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  const orig = (C.__atmoOrig ??= JSON.stringify({ pv: C.fog_pars_vertex, v: C.fog_vertex, pf: C.fog_pars_fragment, f: C.fog_fragment })) as string;
  const o = JSON.parse(orig);
  const v3 = (v: THREE.Vector3 | THREE.Color) => "x" in v ? `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})` : `vec3(${v.r.toFixed(4)}, ${v.g.toFixed(4)}, ${v.b.toFixed(4)})`;
  C.fog_pars_vertex = o.pv + "\n#ifdef USE_FOG\nvarying vec3 vFogPos;\n#endif\n";
  C.fog_vertex = o.v + "\n#ifdef USE_FOG\nvFogPos = mvPosition.xyz;\n#endif\n";
  C.fog_pars_fragment = o.pf + `
#ifdef USE_FOG
varying vec3 vFogPos;
const vec3 ATMO_SUN = ${v3(sunDir.clone().normalize())};
const vec3 ATMO_SCATTER = ${v3(sunScatter)};
const float ATMO_HDENS = ${heightDensity.toFixed(6)};
const float ATMO_FALL = ${falloff.toFixed(6)};
#endif
`;
  C.fog_fragment = `
#ifdef USE_FOG
  {
    float d = length(vFogPos);
    vec3 wd = transpose(mat3(viewMatrix)) * (vFogPos / max(d, 1e-3));
    float yd = wd.y * d;
    float hf = ATMO_HDENS * exp(-ATMO_FALL * cameraPosition.y) * d * (abs(yd) > .01 ? (1. - exp(-ATMO_FALL * yd)) / (ATMO_FALL * yd) : 1.);
    #ifdef FOG_EXP2
      float base = fogDensity * fogDensity * d * d;
    #else
      float base = 0.;
    #endif
    float fogF = 1. - exp(-(base + hf));
    float sunK = pow(max(dot(wd, ATMO_SUN), 0.), 6.);
    vec3 fc = mix(fogColor, ATMO_SCATTER, sunK * .75);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, clamp(fogF, 0., 1.));
  }
#endif
`;
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

/** Финальный проход: контраст, насыщенность, виньетка, зерно. */
export const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.025 }, uVignette: { value: 0.28 }, uSat: { value: 1.08 }, uContrast: { value: 1.06 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette, uSat, uContrast; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(.2126, .7152, .0722));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      c.rgb = clamp((c.rgb - .5) * uContrast + .5, 0., 1.);
      vec2 q = vUv - .5;
      c.rgb *= 1. - uVignette * smoothstep(.25, .85, length(q) * 1.25);
      c.rgb += (h(vUv * 911.) - .5) * uGrain;
      gl_FragColor = c;
    }`,
};
