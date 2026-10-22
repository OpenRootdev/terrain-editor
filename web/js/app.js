/* Terrain Editor — Three.js heightfield sculpting engine.
   Tools: Sculpt / Pull / Flatten / Scale / Mountain / Lake / Smooth /
   Region (select + raise/move/scale) / Place (assets).
   All terrain edits operate on a Float32 height grid; rendering is a
   single indexed mesh with vertex colors (height/slope layered materials). */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise } from './noise.js';

/* ============================== helpers ============================== */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const $ = (id) => document.getElementById(id);
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };

/* ============================== state ============================== */
const N = 256;                       // grid verts per side (fixed)
const state = {
  tool: 'sculpt',
  size: 30, strength: 0.5, falloff: 0.5, shape: 'round',
  height: 3.0, brushMode: 'toggle',
  placementSeed: 4242, weights: {}, vScale: {},
  editMode: 'vertex', selVerts: new Set(), selQuads: new Set(),
  water: 0, base: 0, rough: 0.8, seed: 12345, worldSize: 512,
  layers: { rock: true, grass: true, dirt: true, sand: true, snow: true, water: true },
  flatShading: false, showGrid: false, play: false,
  assetCat: 'trees', selectedAsset: null, density: 0.5,
  strokeDir: 1, stroking: false, region: null, undo: [],
};
let noise = makeNoise(state.seed);

/* ============================== renderer ============================== */
const LITE = location.search.includes('lite');
const canvas = $('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LITE, powerPreference: 'high-performance' });
renderer.setPixelRatio(LITE ? 1 : Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
// Floating-island look: the world beyond the editable tile is plain light
// blue sky (the water plane is now tile-sized, see rebuildTerrain).
scene.background = new THREE.Color(0xcfe8ff);
scene.fog = new THREE.Fog(0xcfe8ff, 1600, 4200);

const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 4000);
camera.position.set(-state.worldSize * 0.55, state.worldSize * 0.42, state.worldSize * 0.62);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 20;
controls.maxDistance = state.worldSize * 3;
controls.target.set(0, 0, 0);
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

const hemi = new THREE.HemisphereLight(0xbcd4f0, 0x545c4a, 1.05);  // stylized
// even fill: backlit faces must not go near-black (they read as 'broken
// texture' - the black mountains in user screenshots were just shadow)
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2df, 2.4);
sun.position.set(0.6, 1.0, 0.35).multiplyScalar(600);
sun.castShadow = true;
sun.shadow.mapSize.set(LITE ? 1024 : 2048, LITE ? 1024 : 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
const sc = sun.shadow.camera;
sc.left = -400; sc.right = 400; sc.top = 400; sc.bottom = -400; sc.far = 2000;

const grid = new THREE.GridHelper(1024, 32, 0x39414d, 0x2a303a);
grid.visible = false;
scene.add(grid);

/* ============================== water ============================== */
/* Water: depth-mapped saturated ramp. A CPU-baked depth texture (water
   level - terrain height) drives turquoise shallows -> azure -> deep navy
   offshore, plus shore foam and procedural animated ripples. Styles are
   saturated presets picked in the right panel. */
const WATER_STYLES = {
  tropical: { sh: 0x5cf0d2, mid: 0x0fa2f2, deep: 0x0a3fd6 },
  alpine:   { sh: 0xa8f7ec, mid: 0x23aee2, deep: 0x0c46a6 },
  ocean:    { sh: 0x35d6e6, mid: 0x0b74e4, deep: 0x05207e },
};
const depthCanvas = document.createElement('canvas');   // sized on first bake
const depthTex = new THREE.CanvasTexture(depthCanvas);
depthTex.flipY = false;                       // world z row 0 = canvas row 0
depthTex.wrapS = depthTex.wrapT = THREE.ClampToEdgeWrapping;
depthTex.colorSpace = THREE.NoColorSpace;
const wuni = {
  uDepthTex: { value: depthTex },
  uTSize: { value: state.worldSize },   // terrain section is evaluated AFTER
                                         // this one; refreshed in rebuild
  uShallow: { value: new THREE.Color(WATER_STYLES.tropical.sh) },
  uMid: { value: new THREE.Color(WATER_STYLES.tropical.mid) },
  uDeep: { value: new THREE.Color(WATER_STYLES.tropical.deep) },
  uTime: { value: 0 },
};
function drawDepthMap() {
  if (depthCanvas.width !== N || depthCanvas.height !== N) {
    depthCanvas.width = depthCanvas.height = N;
  }
  const ctx = depthCanvas.getContext('2d');
  const img = ctx.createImageData(N, N);
  const dmax = Math.max(2, state.water - terrain.minH + 0.5);
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const h = terrain.heights[iz * N + ix];
      const d = clamp((state.water - h) / dmax, 0, 1) * 255;
      const o = (iz * N + ix) * 4;
      img.data[o] = d; img.data[o + 1] = d; img.data[o + 2] = d; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  depthTex.needsUpdate = true;
}
const waterMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, transparent: true, opacity: 1.0,
  roughness: 0.1, metalness: 0.0, clearcoat: 0.7, clearcoatRoughness: 0.2,
  depthWrite: false,
});
waterMat.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, wuni);
  shader.vertexShader = 'varying vec2 vWxz;\n' + shader.vertexShader.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\n  vWxz = position.xz;');
  shader.fragmentShader =
    'varying vec2 vWxz;\nuniform sampler2D uDepthTex;\nuniform float uTSize;\n' +
    'uniform vec3 uShallow;\nuniform vec3 uMid;\nuniform vec3 uDeep;\nuniform float uTime;\n' +
    shader.fragmentShader.replace('#include <map_fragment>',
      `#include <map_fragment>
      {
        vec2 duv = vWxz / uTSize + 0.5;
        float inside = step(0.0, duv.x) * step(duv.x, 1.0)
                     * step(0.0, duv.y) * step(duv.y, 1.0);
        float d = mix(1.0, texture2D(uDepthTex, duv).r, inside);
        // saturated ramp: turquoise shallows -> azure -> deep navy offshore
        vec3 col = mix(uShallow, uMid, smoothstep(0.05, 0.38, d));
        col = mix(col, uDeep, smoothstep(0.32, 0.9, d));
        // animated procedural ripples (scales + phase from world xz)
        float rip = sin(vWxz.x * 0.42 + uTime * 0.8)
                  * sin(vWxz.y * 0.36 - uTime * 0.6)
                  + 0.6 * sin((vWxz.x + vWxz.y) * 0.17 + uTime * 0.45);
        col *= 0.9 + 0.14 * rip;
        // shore foam band
        float foam = smoothstep(0.045, 0.0, d)
                   * (0.55 + 0.45 * sin(vWxz.x * 1.7 + vWxz.y * 1.3 + uTime * 1.6));
        col = mix(col, vec3(0.93, 0.99, 1.0), clamp(foam, 0.0, 1.0) * 0.85);
        diffuseColor.rgb = col;
        diffuseColor.a = max(mix(0.7, 0.97, smoothstep(0.0, 0.3, d)),
                             clamp(foam, 0.0, 1.0) * 0.9);
      }`);
};
waterMat.customProgramCacheKey = () => 'water-depth-v1';
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), waterMat);
water.receiveShadow = true;
water.renderOrder = 2;
scene.add(water);

/* ============================== terrain ============================== */
const terrain = {
  N, heights: new Float32Array(N * N), colors: new Float32Array(N * N * 3),
  wgt: new Float32Array(N * N * 4),          // per-layer weights for the shader
  wdirt: new Float32Array(N * N),            // 5th layer: dirt/earth
  geo: null, mesh: null, mat: null, size: state.worldSize, minH: 0, maxH: 1,
};

/* terrain textures (all CC0) + shader uniforms shared with onBeforeCompile */
const uni = {
  uTexBlend: { value: 0.0 },                // fades in once textures load
  uTileScale: { value: 1 / 8 },
  uTSand: { value: null }, uTGrass: { value: null },
  uTRock: { value: null }, uTSnow: { value: null },
  uTDirt: { value: null },
};

function cell() { return terrain.size / (N - 1); }
function hIdx(ix, iz) { return iz * N + ix; }
function worldToGrid(x, z) {
  const c = cell();
  return [(x + terrain.size / 2) / c, (z + terrain.size / 2) / c];
}
function sampleH(x, z) {                       // bilinear world sample
  const [gx, gz] = worldToGrid(x, z);
  const x0 = clamp(Math.floor(gx), 0, N - 2), z0 = clamp(Math.floor(gz), 0, N - 2);
  const fx = clamp(gx - x0, 0, 1), fz = clamp(gz - z0, 0, 1);
  const h00 = terrain.heights[hIdx(x0, z0)], h10 = terrain.heights[hIdx(x0 + 1, z0)];
  const h01 = terrain.heights[hIdx(x0, z0 + 1)], h11 = terrain.heights[hIdx(x0 + 1, z0 + 1)];
  return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz);
}
function slopeAt(ix, iz) {                     // 0 flat .. 1 vertical
  const c = cell();
  const ix0 = Math.max(0, ix - 1), ix1 = Math.min(N - 1, ix + 1);
  const iz0 = Math.max(0, iz - 1), iz1 = Math.min(N - 1, iz + 1);
  const dx = (terrain.heights[hIdx(ix1, iz)] - terrain.heights[hIdx(ix0, iz)]) / ((ix1 - ix0) * c);
  const dz = (terrain.heights[hIdx(ix, iz1)] - terrain.heights[hIdx(ix, iz0)]) / ((iz1 - iz0) * c);
  return 1 - 1 / Math.sqrt(1 + dx * dx + dz * dz);   // ~sin(angle)
}

/* ---- layered vertex colors (recomputed from heights + layer toggles) ---- */
const LAYER_HEX = {
  sand: 0xd8c291, grass: 0x64a44c, dirt: 0x8a6a48,
  rock: 0x7c7f86, snow: 0xf4f7fa, base: 0x7a7268,
};
const LCOL = {};
for (const k in LAYER_HEX) LCOL[k] = new THREE.Color(LAYER_HEX[k]);

/* Map Style presets: palette + rule params + layer multipliers + scatter
   weight rules + water style. 'stylized' reproduces the base look exactly. */
const MAP_STYLES = {
  stylized: {
    pal: LAYER_HEX, sandTop: 2.0, grassTopCap: 26, snowZOff: null,
    wMul: { sand: 1, grass: 1, dirt: 1, rock: 1, snow: 1 },
    water: 'tropical', neutral: 1.0, rules: [], sky: 0xcfe8ff, flat: false,
  },
  ps2: {
    // Sunset beach look of the reference: vivid saturated flats, warm pink
    // sky, palms/jungle/ruin props boosted, snow basically off, flat shading
    pal: { ...LAYER_HEX, grass: 0x6fcf3a, dirt: 0xc98a4a,
      sand: 0xf2d38a, rock: 0xa5906f },
    sandTop: 3.5, grassTopCap: 30, snowZOff: 60,
    wMul: { sand: 1.15, grass: 1, dirt: 0.9, rock: 1, snow: 1 },
    water: 'tropical', neutral: 0.5, sky: 0xffcfae, flat: true,
    rules: [['palm', 1], ['trop', 1], ['ruin', 1], ['temple', 1],
      ['jungle', 1], ['crate', 1], ['coconut', 1], ['jetty', 1],
      ['cactus', 0.5], ['fern', 0.85], ['flower', 0.9], ['grass', 0.7],
      ['pine', 0.15], ['tree', 0.45], ['rock', 0.6], ['stone', 0.5]],
  },
  autumn: {
    pal: { ...LAYER_HEX, grass: 0xcf8a2f, dirt: 0x9a5a30, sand: 0xdfb46c, rock: 0x8a8176 },
    sandTop: 2.0, grassTopCap: 26, snowZOff: null,
    wMul: { sand: 1, grass: 1, dirt: 1, rock: 1, snow: 1 },
    water: 'tropical', neutral: 0.5, sky: 0xdcecf7, flat: false,
    rules: [['palm', 0.08], ['cactus', 0.05], ['fall', 1.0], ['dark', 0.8],
      ['oak', 0.95], ['pine', 0.5], ['tree', 0.65], ['grass', 0.7], ['flower', 0.85]],
  },
  desert: {
    pal: { ...LAYER_HEX, grass: 0xc9c25c, dirt: 0xc4772f, sand: 0xf0cf94, rock: 0xb09a72 },
    sandTop: 7.0, grassTopCap: 13, snowZOff: 50,
    wMul: { sand: 1.3, grass: 0.6, dirt: 1.1, rock: 0.9, snow: 1 },
    water: 'tropical', neutral: 0.4, sky: 0xd6ecf7, flat: false,
    rules: [['palm', 1.0], ['cactus', 1.0], ['fern', 0.08], ['mushroom', 0.1],
      ['flower', 0.15], ['grass', 0.5], ['pine', 0.15], ['tree', 0.45],
      ['rock', 0.8], ['stone', 0.8]],
  },
  winter: {
    pal: { ...LAYER_HEX, grass: 0xdfe8ee, dirt: 0xb6c0ca, sand: 0xe8eef4, rock: 0x8f99a6 },
    sandTop: 2.0, grassTopCap: 12, snowZOff: 2.5,
    wMul: { sand: 1, grass: 0.75, dirt: 0.7, rock: 1, snow: 1 },
    water: 'alpine', neutral: 0.45, sky: 0xeef4fa, flat: false,
    rules: [['palm', 0.05], ['cactus', 0.05], ['fall', 0.2], ['fern', 0.25],
      ['flower', 0.3], ['pine', 1.0], ['dark', 0.7], ['grass', 0.4], ['tree', 0.6]],
  },
  volcanic: {
    // dark charcoal + soot ground; lava (dirt slot swap) shows only as
    // sparse veins/patches - first version read as bright Mars canyon
    pal: { ...LAYER_HEX, grass: 0x3d3830, dirt: 0x7a3320, sand: 0x4a453f, rock: 0x464a52 },
    sandTop: 3.0, grassTopCap: 26, snowZOff: 10000,
    wMul: { sand: 1, grass: 0.1, dirt: 0.5, rock: 1.15, snow: 0 },
    water: 'ocean', neutral: 0.3, sky: 0xe0cfc4, flat: false,
    rules: [['palm', 0.03], ['cactus', 0.05], ['fern', 0.03], ['flower', 0.03],
      ['mushroom', 0.12], ['grass', 0.04], ['lily', 0.02], ['tree', 0.05],
      ['rock', 1.0], ['stone', 1.0], ['log', 0.9], ['stump', 0.8]],
  },
};
let ST = MAP_STYLES.stylized;
let WM = ST.wMul;
function styleWeight(name) {
  const n = name.toLowerCase();
  for (const [pat, f] of ST.rules) if (n.includes(pat)) return f;
  return ST.neutral;
}

function computeColors() {
  const H = terrain.heights, C = terrain.colors;
  const w = state.water, L = state.layers;
  let mn = 1e9, mx = -1e9;
  for (let i = 0; i < H.length; i++) { if (H[i] < mn) mn = H[i]; if (H[i] > mx) mx = H[i]; }
  terrain.minH = mn; terrain.maxH = mx;
  const rockZ = Math.max(w + 7, mx * 0.5);     // rock line (altitude part)
  // snow line: relative BUT capped so one giant sculpted spike (mx=169)
  // can't push snow out of reach of every other peak; Map Styles override
  const snowZ = ST.snowZOff !== null
    ? w + ST.snowZOff
    : Math.max(w + 8, Math.min(mx * 0.7, w + 35));
  const grassTop = Math.max(w + 9,
    Math.min(mx * 0.55, w + ST.grassTopCap)); // grass thins with altitude
  const tmp = new THREE.Color();
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const i = hIdx(ix, iz), h = H[i], sl = slopeAt(ix, iz);
      /* Weights: ONE rule set feeds both the flat vertex colors and the
         texture blend, so modes can't disagree. Heights/slopes decide:
         sand ring -> dirt ground band -> grass (flat, low-mid) -> rock
         (steep AND above rockZ) -> snow cap. Dirt keeps its own 5th layer
         (brown ground patches no longer turn green under textures). */
      let wSand = L.sand ? sstep((w + ST.sandTop - h) / 1.6) *
        sstep((0.45 - sl) / 0.3) : 0;
      /* snow by HEIGHT (steep peaks still cap white - reference style);
         slope gate only kills it on literal walls. CRITICAL: rock=1 and
         snow=1 normalized to 50/50 grey - snow must DOMINATE (x2) and
         suppress the rock term where snowiness is high, or caps render
         grey no matter how white the texture is. */
      const snowRaw = L.snow ? sstep((h - snowZ) / 12.0) *
        sstep((0.99 - sl) / 0.12) : 0;
      let wSnow = snowRaw * 2.0;
      let wRock = L.rock ? Math.min(1, Math.max(
        sstep((sl - 0.33) / 0.17),              // slope rock starts early now
        sstep((h - rockZ) / 4.0)) * (1 - snowRaw * 0.85)) : 0;  // rock under snow
      const lowBand = sstep((h - (w + 0.8)) / 0.7) *
        (1 - sstep((h - (w + 3.4)) / 1.4));     // ground-level dirt band
      const midBand = sstep((sl - 0.20) / 0.14) *
        (1 - sstep((sl - 0.45) / 0.14)) * 0.7;  // eroded hillside dirt
      const patchy = hash(ix * 0.11, iz * 0.11) > 0.72 ? 0.55 : 0;
      let wDirt = L.dirt ? Math.min(1,
        lowBand * sstep((0.55 - sl) / 0.3)
        + midBand
        + patchy * (1 - sstep((sl - 0.30) / 0.2))) : 0;
      let wGrass = L.grass ? (1 - sstep((sl - 0.26) / 0.14))
        * sstep((h - (w + 2.0)) / 1.4)
        * (1 - sstep((h - grassTop) / 3.0)) : 0;
      // Map Style layer multipliers (volcanic kills grass/snow, desert
      // pushes sand, etc.) - applied BEFORE both color and shader outputs
      let wS2 = wSand * WM.sand, wG2 = wGrass * WM.grass,
        wD2 = wDirt * WM.dirt, wR2 = wRock * WM.rock, wN2 = wSnow * WM.snow;
      let sum = wS2 + wN2 + wR2 + wD2 + wG2;
      const wi = i * 4;
      terrain.wgt[wi] = wS2;
      terrain.wgt[wi + 1] = wG2;
      terrain.wgt[wi + 2] = wR2;
      terrain.wgt[wi + 3] = wN2;
      terrain.wdirt[i] = Math.min(1, wD2);
      // keep the color chain in sync with the scaled weights
      wSand = wS2; wGrass = wG2; wDirt = wD2; wRock = wR2; wSnow = wN2;
      if (sum < 1e-4) { tmp.copy(LCOL.base); }
      else {
        tmp.setRGB(0, 0, 0);
        const add = (col, wgt) => { tmp.r += col.r * wgt; tmp.g += col.g * wgt; tmp.b += col.b * wgt; };
        add(LCOL.sand, wSand); add(LCOL.snow, wSnow); add(LCOL.rock, wRock);
        add(LCOL.dirt, wDirt); add(LCOL.grass, wGrass);
        tmp.r /= sum; tmp.g /= sum; tmp.b /= sum;
      }
      // organic per-vertex tint (cheap deterministic dither, no simplex)
      const t = 0.92 + 0.16 * hash(ix, iz) + 0.05 * hash(iz * 0.37, ix * 0.71);
      C[i * 3] = tmp.r * t; C[i * 3 + 1] = tmp.g * t; C[i * 3 + 2] = tmp.b * t;
    }
  }
}

/* Textured terrain: per-vertex layer weights (wgt attribute, filled by
   computeColors) blend 4 seamless CC0 tiles in the fragment shader;
   uTexBlend cross-fades between the flat vertex-color look (0) and the
   full textured look (1). */
function makeTerrainMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0.0,
    flatShading: state.flatShading,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uni);
    shader.vertexShader =
      'attribute vec4 wgt;\nattribute float wdirt;\nvarying vec4 vWgt;\nvarying float vDirt;\n' +
      'varying vec2 vWuv;\nuniform float uTileScale;\n' +
      shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n  vWgt = wgt;\n  vDirt = wdirt;\n  vWuv = position.xz * uTileScale;');
    shader.fragmentShader =
      'uniform sampler2D uTSand;\nuniform sampler2D uTGrass;\nuniform sampler2D uTRock;\n' +
      'uniform sampler2D uTSnow;\nuniform sampler2D uTDirt;\nuniform float uTexBlend;\n' +
      'varying vec4 vWgt;\nvarying float vDirt;\nvarying vec2 vWuv;\n' +
      shader.fragmentShader.replace('#include <color_fragment>',
        `#include <color_fragment>
        {
          vec4 tw = vWgt;
          float td = clamp(vDirt, 0.0, 1.0);
          float snowW = max(tw.w, 0.0);
          float sumNo = max(tw.x + tw.y + tw.z + td, 1e-4);
          vec3 base = (texture2D(uTSand, vWuv).rgb * tw.x
                     + texture2D(uTGrass, vWuv).rgb * tw.y
                     + texture2D(uTRock, vWuv).rgb * tw.z
                     + texture2D(uTDirt, vWuv).rgb * td) / sumNo;
          float share = snowW / max(sumNo + snowW, 1e-4);
          /* CRISP snow/rock line: BINARY snap per ~1m world block with a
             noise-ordered threshold - each block flips whole to snow or
             rock (chunky stipple boundary over a ~3m height band) instead
             of a mushy per-pixel blend. Blockiness reads as stylized. */
          float sn = smoothstep(0.06, 0.45, share);
          float n = fract(sin(dot(floor(vWuv * 8.0),
                                  vec2(12.9898, 78.233))) * 43758.5453);
          float pick = step(n * 0.88 + 0.06, sn);
          vec3 texel = mix(base, texture2D(uTSnow, vWuv).rgb, pick);
          // contact band under the line (crevice shadow) across the zone
          float band = smoothstep(0.03, 0.20, sn) *
                       (1.0 - smoothstep(0.28, 0.60, sn));
          texel *= 1.0 - 0.30 * band;
          diffuseColor.rgb = mix(diffuseColor.rgb, texel, uTexBlend);
        }`);
  };
  mat.customProgramCacheKey = () => 'terrain-tex5-v1';
  return mat;
}

function buildGeometry() {
  const pos = new Float32Array(N * N * 3);
  const idx = new Uint32Array((N - 1) * (N - 1) * 6);
  const c = cell(), half = terrain.size / 2;
  for (let iz = 0; iz < N; iz++)
    for (let ix = 0; ix < N; ix++) {
      const i = hIdx(ix, iz);
      pos[i * 3] = -half + ix * c;
      pos[i * 3 + 1] = terrain.heights[i];
      pos[i * 3 + 2] = -half + iz * c;
    }
  let k = 0;
  for (let iz = 0; iz < N - 1; iz++)
    for (let ix = 0; ix < N - 1; ix++) {
      const a = hIdx(ix, iz), b = hIdx(ix + 1, iz), d = hIdx(ix, iz + 1), e = hIdx(ix + 1, iz + 1);
      idx[k++] = a; idx[k++] = d; idx[k++] = b;
      idx[k++] = b; idx[k++] = d; idx[k++] = e;
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(terrain.colors, 3));
  geo.setAttribute('wgt', new THREE.BufferAttribute(terrain.wgt, 4));
  geo.setAttribute('wdirt', new THREE.BufferAttribute(terrain.wdirt, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}

function syncPositions() {                       // during strokes
  const pos = terrain.geo.attributes.position;
  const arr = pos.array;
  for (let i = 0; i < terrain.heights.length; i++) arr[i * 3 + 1] = terrain.heights[i];
  pos.needsUpdate = true;
  terrain.geo.computeVertexNormals();
  terrain.geo.attributes.normal.needsUpdate = true;
}

function rebuildTerrain(full = true) {
  if (full && !terrain.geo) {
    terrain.geo = buildGeometry();
    if (!terrain.mat) terrain.mat = makeTerrainMaterial();
    const mat = terrain.mat;
    mat.flatShading = state.flatShading;
    terrain.mesh = new THREE.Mesh(terrain.geo, mat);
    terrain.mesh.castShadow = true;
    terrain.mesh.receiveShadow = true;
    scene.add(terrain.mesh);
  } else {
    syncPositions();
    terrain.geo.attributes.color.needsUpdate = true;
    terrain.geo.attributes.wgt.needsUpdate = true;
    terrain.geo.attributes.wdirt.needsUpdate = true;
  }
  computeColors();
  terrain.geo.attributes.wgt.needsUpdate = true;
  terrain.geo.attributes.wdirt.needsUpdate = true;
  if (full && terrain.mesh) {
    terrain.mesh.geometry = terrain.geo;
    terrain.mesh.material.flatShading = state.flatShading;
    terrain.mesh.material.needsUpdate = true;
  }
  const wantW = terrain.size * 1.02;          // tile-sized: sky beyond it
  if (Math.abs((water.geometry.parameters?.width || 0) - wantW) > 1) {
    water.geometry.dispose();
    water.geometry = new THREE.PlaneGeometry(wantW, wantW).rotateX(-Math.PI / 2);
  }
  water.position.y = state.water;
  water.visible = state.layers.water;
  updateProxy();
  drawMinimapBase();
  wuni.uTSize.value = terrain.size;
  drawDepthMap();
}

/* ---- coarse raycast proxy (exact heights sampled after hit) ---- */
let proxy = null;
function buildProxy() {
  proxy = new THREE.Mesh(
    new THREE.PlaneGeometry(terrain.size, terrain.size, 47, 47).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  scene.add(proxy);
}
function updateProxy() {
  const g = proxy.geometry, pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, sampleH(pos.getX(i), pos.getZ(i)));
  }
  pos.needsUpdate = true;
}

/* ============================== textures ============================== */
const TTEX = {};
async function loadTerrainTextures() {
  const tl = new THREE.TextureLoader();
  const files = { sand: 'sand.jpg', grass: 'grass.png', rock: 'rock.png',
    snow: 'snow.png', dirt: 'dirt.png', dunes: 'sand_dunes.png', lava: 'lava.png' };
  const uniKeys = { sand: 'uTSand', grass: 'uTGrass', rock: 'uTRock',
    snow: 'uTSnow', dirt: 'uTDirt' };   // dunes/lava swap in via Map Styles
  try {
    await Promise.all(Object.entries(files).map(async ([k, f]) => {
      const t = await tl.loadAsync('./assets/textures/terrain/' + f);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      TTEX[k] = t;
      if (uniKeys[k]) uni[uniKeys[k]].value = t;
    }));
    uni.uTexBlend.value = parseFloat($('tBlend').value);   // fade textures in
    flash('terrain textures loaded (grass/sand/rock/snow, CC0)');
  } catch (e) { console.warn('terrain textures failed', e); }

  // water surface texture (CC0 seamless), slow scroll in the render loop
  try {
    const w = await tl.loadAsync('./assets/textures/terrain/water_light.jpg');
    w.wrapS = w.wrapT = THREE.RepeatWrapping;
    w.colorSpace = THREE.SRGBColorSpace;
    w.repeat.set(24, 24);
    water.material.map = w;
    water.material.color.setHex(0xbfe0ff);
    water.material.needsUpdate = true;
  } catch (e) { console.warn('water texture failed', e); }
}

/* ============================== procedural ============================== */
function regenerate() {
  noise = makeNoise(state.seed);
  const H = terrain.heights, c = cell(), half = terrain.size / 2;
  const A = terrain.size * 0.075 * state.rough;
  const f = 3.2 / terrain.size;
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const x = -half + ix * c, z = -half + iz * c;
      const base = noise.fbm(x * f, z * f, 6, 2.0, 0.5);
      const ridge = Math.pow(noise.ridged(x * f * 0.7 + 40, z * f * 0.7 - 20, 4), 2.2);
      let h = state.base + A * (base * 0.62 + ridge * 0.85 - 0.38);
      // edge falloff so the tile reads as an island slab (like the reference)
      const ex = Math.abs(x) / half, ez = Math.abs(z) / half;
      const edge = Math.max(ex, ez);
      h *= 1 - sstep((edge - 0.86) / 0.14) * 0.9;
      H[hIdx(ix, iz)] = h;
    }
  }
  rebuildTerrain(true);
  afterEdit();
}

/* ============================== undo ============================== */
function pushUndo() {
  state.undo.push(terrain.heights.slice());
  if (state.undo.length > 25) state.undo.shift();
}
function undo() {
  const prev = state.undo.pop();
  if (!prev) { flash('nothing to undo'); return; }
  terrain.heights.set(prev);
  rebuildTerrain(false);
  if (state.region) rebuildRegion();   // region snapshot may be stale
  afterEdit();
}

/* ============================== brushes ============================== */
function falloffW(dx, dz, r) {
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= r) return 0;
  const t = 1 - d / r;
  if (state.shape === 'box') return sstep(clamp(t / Math.max(0.08, 1 - state.falloff), 0, 1));
  const soft = sstep(t);                    // smooth round
  return lerp(t, soft, state.falloff);
}

function applyBrush(wx, wz, alt) {
  const r = state.size;
  const dir = state.brushMode === 'lower' ? -1
    : state.brushMode === 'raise' ? 1
      : (alt ? -1 : 1);
  const step = state.strength * state.height;
  const c = cell(), half = terrain.size / 2;
  const [gx, gz] = worldToGrid(wx, wz);
  const ir = Math.ceil(r / c);
  const x0 = clamp(Math.floor(gx) - ir, 0, N - 1), x1 = clamp(Math.floor(gx) + ir, 0, N - 1);
  const z0 = clamp(Math.floor(gz) - ir, 0, N - 1), z1 = clamp(Math.floor(gz) + ir, 0, N - 1);
  const H = terrain.heights;
  const centerH = sampleH(wx, wz);
  const tool = state.tool;

  for (let iz = z0; iz <= z1; iz++) {
    for (let ix = x0; ix <= x1; ix++) {
      const x = -half + ix * c, z = -half + iz * c;
      const w = falloffW(x - wx, z - wz, r);
      if (w <= 0) continue;
      const i = hIdx(ix, iz);
      let h = H[i];
      switch (tool) {
        case 'sculpt':
          h += dir * step * w; break;
        case 'pull':
          h += Math.pow(w, 0.65) * step * 1.5; break;
        case 'flatten':
          h += (centerH - h) * clamp(step * 0.7 * w, 0, 1); break;
        case 'scale': {
          const k = 1 + dir * step * 0.28 * w;
          h = centerH + (h - centerH) * k;
          break;
        }
        case 'mountain':
          h += dir * (step * 0.9 * w) +
            noise.mountainDetail(x, z) * step * 0.55 * w;
          h = Math.min(h, terrain.size * 0.33);
          break;
        case 'lake': {
          const target = state.water - 2.5;
          if (h > target) h += (target - h) * clamp(step * 0.8 * w, 0, 1);
          break;
        }
        case 'smooth': {
          const ix0 = Math.max(0, ix - 1), ix1 = Math.min(N - 1, ix + 1);
          const iz0 = Math.max(0, iz - 1), iz1 = Math.min(N - 1, iz + 1);
          const avg = (H[hIdx(ix0, iz)] + H[hIdx(ix1, iz)] +
            H[hIdx(ix, iz0)] + H[hIdx(ix, iz1)]) * 0.25;
          h += (avg - h) * clamp(step * 0.9 * w, 0, 1);
          break;
        }
      }
      H[i] = h;
    }
  }
}

/* ============================== region tool ============================== */
let regionRect = null;        // live drag preview {x0,z0,x1,z1}
let regionLines = null;       // THREE line helpers
let regionArrow = null;
const regionParams = { raise: 0, mx: 0, mz: 0, sx: 1, sz: 1 };

function regionBounds(r) {
  return [Math.min(r.x0, r.x1), Math.max(r.x0, r.x1), Math.min(r.z0, r.z1), Math.max(r.z0, r.z1)];
}

function startRegion(x0, z0) {
  regionRect = { x0, z0, x1: x0, z1: z0 };
}
function commitRegion(x1, z1) {
  if (!regionRect) return;
  regionRect.x1 = x1; regionRect.z1 = z1;
  const [ax, bx, az, bz] = regionBounds(regionRect);
  if (bx - ax < 4 || bz - az < 4) { clearRegion(); return; }
  state.region = { x0: ax, x1: bx, z0: az, z1: bz, snap: null };
  const c = cell(), half = terrain.size / 2;
  const ix0 = clamp(Math.round((ax + half) / c), 0, N - 1);
  const ix1 = clamp(Math.round((bx + half) / c), 0, N - 1);
  const iz0 = clamp(Math.round((az + half) / c), 0, N - 1);
  const iz1 = clamp(Math.round((bz + half) / c), 0, N - 1);
  const w = ix1 - ix0 + 1, hgt = iz1 - iz0 + 1;
  const snap = new Float32Array(w * hgt);
  for (let iz = 0; iz < hgt; iz++)
    for (let ix = 0; ix < w; ix++)
      snap[iz * w + ix] = terrain.heights[hIdx(ix0 + ix, iz0 + iz)];
  state.region.g = { ix0, iz0, w, h: hgt };
  state.region.snap = snap;
  regionRect = null;
  regionParams.raise = regionParams.mx = regionParams.mz = 0;
  regionParams.sx = regionParams.sz = 1;
  syncRegionSliders();
  buildRegionHelpers();
  $('regionSect').classList.add('show');
  flash('region selected — use the sliders or drag the green arrow');
}

function rebuildRegion() {
  const R = state.region;
  if (!R || !R.snap) return;
  const { ix0, iz0, w, h: gh } = R.g;
  const H = terrain.heights;
  const cx = ix0 + (w - 1) / 2, cz = iz0 + (gh - 1) / 2;
  const { raise, mx, mz, sx, sz } = regionParams;
  const c = cell();
  const mdxi = Math.round(mx / c), mdzi = Math.round(mz / c);
  for (let iz = 0; iz < gh; iz++) {
    for (let ix = 0; ix < w; ix++) {
      // inverse-map dest cell -> snapshot cell (clamped)
      const gx = cx + ((ix - cx) - mdxi) / sx;
      const gz = cz + ((iz - cz) - mdzi) / sz;
      const sx0 = clamp(Math.floor(gx), 0, w - 2), sz0 = clamp(Math.floor(gz), 0, gh - 2);
      const fx = clamp(gx - sx0, 0, 1), fz = clamp(gz - sz0, 0, 1);
      const s00 = R.snap[sz0 * w + sx0], s10 = R.snap[sz0 * w + sx0 + 1];
      const s01 = R.snap[(sz0 + 1) * w + sx0], s11 = R.snap[(sz0 + 1) * w + sx0 + 1];
      const hv = lerp(lerp(s00, s10, fx), lerp(s01, s11, fx), fz);
      H[hIdx(ix0 + ix, iz0 + iz)] = hv + raise;
    }
  }
  rebuildTerrain(false);
  buildRegionHelpers();
  afterEdit();
}

function buildRegionHelpers() {
  if (regionLines) { scene.remove(regionLines); regionLines.geometry.dispose(); regionLines = null; }
  if (regionArrow) { scene.remove(regionArrow); regionArrow = null; }
  const R = state.region;
  if (!R) return;
  // dashed-looking white rectangle (like the reference)
  const top = terrain.maxH + 2;
  const pts = [
    R.x0, top, R.z0, R.x1, top, R.z0,
    R.x1, top, R.z0, R.x1, top, R.z1,
    R.x1, top, R.z1, R.x0, top, R.z1,
    R.x0, top, R.z1, R.x0, top, R.z0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  regionLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff }));
  scene.add(regionLines);
  // green up-arrow gizmo at region centre
  regionArrow = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0x35d07f }),
  );
  shaft.position.y = 7;
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(3, 7, 12),
    new THREE.MeshBasicMaterial({ color: 0x35d07f }),
  );
  head.position.y = 17.5;
  regionArrow.add(shaft, head);
  regionArrow.position.set((R.x0 + R.x1) / 2, sampleH((R.x0 + R.x1) / 2, (R.z0 + R.z1) / 2) + 1, (R.z0 + R.z1) / 2);
  scene.add(regionArrow);
}

function clearRegion() {
  state.region = null;
  regionRect = null;
  if (regionLines) { scene.remove(regionLines); regionLines.geometry.dispose(); regionLines = null; }
  if (regionArrow) { scene.remove(regionArrow); regionArrow = null; }
  $('regionSect').classList.remove('show');
}

function syncRegionSliders() {
  $('rRaise').value = regionParams.raise; $('rRaiseV').textContent = regionParams.raise.toFixed(1);
  $('rMx').value = regionParams.mx; $('rMxV').textContent = regionParams.mx;
  $('rMz').value = regionParams.mz; $('rMzV').textContent = regionParams.mz;
  $('rSx').value = regionParams.sx; $('rSxV').textContent = regionParams.sx.toFixed(2);
  $('rSz').value = regionParams.sz; $('rSzV').textContent = regionParams.sz.toFixed(2);
}

/* ============================== assets & instancing ============================== */
/* Low-poly asset pools: Kenney Nature Kit (CC0) for trees/rocks/vegetation;
   the Poly Haven originals moved to the HQ tab (they lagged at scale). */
const LP = ['tree_blocks', 'tree_blocks_dark', 'tree_blocks_fall', 'tree_cone',
  'tree_cone_dark', 'tree_cone_fall', 'tree_default', 'tree_default_dark',
  'tree_default_fall', 'tree_detailed', 'tree_detailed_dark', 'tree_detailed_fall',
  'tree_fat', 'tree_fat_darkh', 'tree_fat_fall', 'tree_oak', 'tree_oak_dark',
  'tree_oak_fall', 'tree_palm', 'tree_palmBend', 'tree_palmShort', 'tree_palmTall',
  'tree_pineDefaultA', 'tree_pineDefaultB', 'tree_pineRoundA', 'tree_pineRoundB',
  'tree_pineRoundC', 'tree_pineRoundD', 'tree_pineSmallA', 'tree_pineSmallB',
  'tree_pineTallA', 'tree_pineTallB', 'tree_pineTallC', 'tree_simple',
  'tree_simple_dark', 'tree_simple_fall', 'tree_small', 'tree_small_dark',
  'tree_small_fall', 'tree_tall', 'tree_tall_dark', 'tree_tall_fall',
  'tree_thin', 'tree_thin_dark', 'tree_thin_fall'];
const LP_ROCKS = ['rock_largeA', 'rock_largeB', 'rock_largeC', 'rock_largeD',
  'rock_smallA', 'rock_smallB', 'rock_smallC', 'rock_smallFlatA', 'rock_smallFlatB',
  'rock_tallA', 'rock_tallB', 'rock_tallC', 'stone_largeA', 'stone_largeB',
  'stone_smallA', 'stone_smallB', 'stone_smallFlatA', 'log', 'log_large',
  'log_stack', 'stump_old', 'stump_round', 'stump_square',
  'ground_pathRocks', 'ground_riverRocks'];
const LP_VEGETATION = ['grass', 'grass_large', 'grass_leafs', 'grass_leafsLarge',
  'flower_purpleA', 'flower_redA', 'flower_yellowA', 'flower_purpleB',
  'flower_redB', 'flower_yellowB', 'mushroom_red', 'mushroom_tan',
  'mushroom_redGroup', 'mushroom_tanGroup', 'plant_bush', 'plant_bushSmall',
  'plant_bushLarge', 'plant_flatShort', 'plant_flatTall', 'lily_small',
  'lily_large', 'cactus_short', 'cactus_tall'];
const CATS = {
  trees: LP,
  rocks: LP_ROCKS,
  vegetation: LP_VEGETATION,
  props: [],          // filled from assets/lp/manifest.json (3TD packs etc.)
  hq: ['V_fir_tree_01', 'V_island_tree_01', 'V_island_tree_02', 'V_island_tree_03',
    'V_jacaranda_tree', 'V_moon_rock_02', 'V_rock_07', 'V_rock_09',
    'V_rock_moss_set_02', 'V_grass_medium_01', 'V_fern_02'],
};
const assetPath = (name) => (name.startsWith('V_')
  ? `./assets/models/${name}.glb`
  : `./assets/lp/${name}.glb`);
const variants = [];            // {name, cat, parts:[{geo,mat}], cap, items:[]}
const variantIndex = {};
let assetsReady = false;

function normalizeGeo(g) {
  for (const k of Object.keys(g.attributes))
    if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  return g.index ? g.toNonIndexed() : g;
}

async function loadOne(loader, cat, name, out) {
    try {
      const gltf = await loader.loadAsync(assetPath(name));
      const byMat = new Map();
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const g = normalizeGeo(o.geometry.clone());
        g.applyMatrix4(o.matrixWorld);
        const key = o.material.uuid;
        if (!byMat.has(key)) byMat.set(key, { geos: [], mat: o.material });
        byMat.get(key).geos.push(g);
      });
      const parts = [];
      for (const { geos, mat } of byMat.values()) {
        const merged = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
        if (merged) parts.push({ geo: merged, mat });
      }
      if (!parts.length) return;
      // Bake real-world scale: Kenney kit is authored at ~1m trees - unreadable
      // specks on a 512m terrain. Normalize per category, pivot pinned to y=0.
      if (cat !== 'hq') {
        const tmp = new THREE.Group();
        for (const p of parts) tmp.add(new THREE.Mesh(p.geo, p.mat));
        const bb = new THREE.Box3().setFromObject(tmp);
        const h = Math.max(bb.max.y - bb.min.y, 1e-3);
        let s = 1;
        if (cat === 'trees') s = 9 / h;
        else if (cat === 'vegetation') s = Math.min(3.5, Math.max(0.6, 0.65 / h));
        else if (cat === 'rocks') s = Math.min(2.5, Math.max(0.8, 1.0 / h));
        for (const p of parts) {
          if (Math.abs(s - 1) > 0.02) p.geo.scale(s, s, s);
          p.geo.translate(0, -bb.min.y * s, 0);   // stand on the ground plane
        }
        tmp.clear();
      }
      const v = {
        name, cat, parts,
        cap: cat === 'hq' ? 700 : cat === 'props' ? 900
          : cat === 'trees' ? 3000 : cat === 'rocks' ? 3000 : 6000,
        items: [], meshes: [],
      };
      variantIndex[name] = variants.length;
      variants.push(v);
      out.push([cat, name, v]);
    } catch (e) {
      console.warn('asset failed', name, e);
      const v = { name, cat, parts: [], cap: 0, items: [], meshes: [] };
      variantIndex[name] = variants.length;
      variants.push(v);
      out.push([cat, name, v]);
    }
    await new Promise((r) => setTimeout(r, 0));   // breathe between parses
}

/* Eager pass = low-poly Kenney pools only (1.5 MB total). The 56 MB HQ
   Poly Haven set loads lazily on first HQ-tab open: parsing it eagerly
   OOM-crashed software-rendered browsers mid-load. */
const allThumbs = [];
let hqThumbs = [], hqLoaded = false, hqLoading = false;

async function loadAssets() {
  const loader = new GLTFLoader();
  // pack models converted by tools/convert_packs.py announce themselves here
  try {
    const m = await (await fetch('./assets/lp/manifest.json')).json();
    for (const cat of ['trees', 'rocks', 'vegetation', 'props'])
      for (const n of (m[cat] || []))
        if (Array.isArray(CATS[cat]) && !CATS[cat].includes(n)) CATS[cat].push(n);
  } catch (e) { console.warn('lp manifest missing (ok for bare installs)', e); }
  const all = Object.entries(CATS).flatMap(([cat, names]) => names.map((n) => [cat, n]));
  const eager = all.filter(([cat]) => cat !== 'hq');
  const lpThumbs = [];
  for (const [cat, name] of eager) await loadOne(loader, cat, name, lpThumbs);
  // HQ entries start as pending placeholders (tiles render gray)
  for (const name of CATS.hq) {
    const v = { name, cat: 'hq', parts: [], cap: 700, items: [], meshes: [], pending: true };
    variantIndex[name] = variants.length;
    variants.push(v);
    allThumbs.push(['hq', name, v]);
  }
  if (!location.search.includes('nothumbs')) await buildThumbCache(lpThumbs);
  allThumbs.push(...lpThumbs);
  assetsReady = true;
  buildAssetTiles(allThumbs);
  renderVariantRows();
  flash('low-poly assets ready — ' + lpThumbs.filter((t) => t[2].parts.length).length +
        ' variants (HQ loads on its tab)');
}

async function ensureHqLoaded() {
  if (hqLoaded || hqLoading) return;
  hqLoading = true;
  flash('loading HQ assets (56 MB) — one moment…');
  const loader = new GLTFLoader();
  const keep = variants.filter((v) => v.cat !== 'hq');
  variants.length = 0;
  variants.push(...keep);                       // drop pending placeholders
  for (const name of CATS.hq) delete variantIndex[name];
  for (const name of CATS.hq) await loadOne(loader, 'hq', name, hqThumbs);
  for (let i = allThumbs.length - 1; i >= 0; i--) {   // drop stale placeholders
    if (allThumbs[i][0] === 'hq') allThumbs.splice(i, 1);
  }
  allThumbs.push(...hqThumbs);
  if (!location.search.includes('nothumbs')) await buildThumbCache(hqThumbs);
  hqLoaded = true;
  hqLoading = false;
  buildAssetTiles(allThumbs);
  renderVariantRows();
  flash('HQ assets loaded — ' + hqThumbs.filter((t) => t[2].parts.length).length + ' variants');
}

/* Thumbs render through the MAIN renderer into ONE atlas RenderTarget:
   N viewport draws + a single readback. The previous per-item
   render->readback loop did ~93 sequential GPU syncs — each stalls the
   main thread for seconds on software rasterizers, so the page never
   finished loading (root-caused: loads hung exactly at thumb build).
   A separate WebGLRenderer is NOT an option either: a second context
   crashes software-rendered browsers. */
const thumbCache = new Map();
window.__thumbProgress = 0;
async function buildThumbCache(list) {
  const items = list.filter(([, , v]) => v.parts.length);
  if (!items.length) return;
  const W = 160, H = 92, COLS = 16;
  const rows = Math.ceil(items.length / COLS);
  const AW = COLS * W, AH = rows * H;
  const rt = new THREE.WebGLRenderTarget(AW, AH);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const sc2 = new THREE.Scene();
  sc2.add(new THREE.HemisphereLight(0xcfe0ff, 0x404040, 1.1));
  const d2 = new THREE.DirectionalLight(0xffffff, 2.2);
  d2.position.set(1, 2, 1.4);
  sc2.add(d2);
  const cam2 = new THREE.PerspectiveCamera(40, W / H, 0.1, 10000);
  const grp = new THREE.Group();
  sc2.add(grp);

  renderer.autoClear = false;
  renderer.setRenderTarget(rt);
  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, AW, AH);
  renderer.setScissor(0, 0, AW, AH);
  renderer.clear(true, true, true);

  window.__thumbProgress = 0;
  for (let i = 0; i < items.length; i++) {
    const [, name, v] = items[i];
    try {
      grp.clear();
      for (const p of v.parts) grp.add(new THREE.Mesh(p.geo, p.mat));
      const sph = new THREE.Box3().setFromObject(grp).getBoundingSphere(new THREE.Sphere());
      const dist = Math.max(sph.radius * 2.4, 1);
      cam2.position.set(sph.center.x + dist * 0.75, sph.center.y + dist * 0.5, sph.center.z + dist * 0.75);
      cam2.lookAt(sph.center);
      const col = i % COLS, row = (i / COLS) | 0;
      const px = col * W, py = (rows - 1 - row) * H;   // GL bottom-up rows
      renderer.setViewport(px, py, W, H);
      renderer.setScissor(px, py, W, H);
      renderer.render(sc2, cam2);
    } catch (e) { console.warn('thumb draw failed', name, e); }
    window.__thumbProgress = i + 1;
    if ((i & 7) === 7) await new Promise((r) => setTimeout(r, 0));
  }

  const buf = new Uint8Array(AW * AH * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, AW, AH, buf);   // ONE sync
  renderer.setRenderTarget(null);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
  renderer.autoClear = true;
  rt.dispose();

  for (let i = 0; i < items.length; i++) {
    const [, name, v] = items[i];
    const col = i % COLS, row = (i / COLS) | 0;
    const px = col * W, py = (rows - 1 - row) * H;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const src = ((py + H - 1 - y) * AW + px) * 4;
      img.data.set(buf.subarray(src, src + W * 4), y * W * 4);
    }
    ctx.putImageData(img, 0, 0);
    thumbCache.set(name, cv);
  }
  grp.clear();
}

function rebuildInstances() {
  for (const v of variants) {
    if (!v.meshes.length && v.parts.length) {
      for (const p of v.parts) {
        const m = new THREE.InstancedMesh(p.geo, p.mat, v.cap);
        m.castShadow = !LITE;   // lite mode: skip instance shadow pass
        m.receiveShadow = true;
        m.frustumCulled = false;
        m.count = 0;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(m);
        v.meshes.push(m);
      }
    }
    const n = Math.min(v.items.length, v.cap);
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const it = v.items[i];
      p.set(it.x, it.y, it.z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot);
      s.setScalar(it.scale);
      mat.compose(p, q, s);
      for (const m of v.meshes) m.setMatrixAt(i, mat);
    }
    for (const m of v.meshes) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
  }
}

/* ---- scatter: per-asset weights, placement seed, per-variant re-roll ---- */
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const SCALE_RANGES = { trees: [0.7, 1.5], vegetation: [0.5, 1.4],
  rocks: [0.4, 1.6], props: [0.8, 1.3] };

function weightedPick(pool, rnd) {
  let sum = 0;
  for (const v of pool) sum += (state.weights[v.name] ?? 1);
  if (sum <= 0) return null;
  let r = rnd() * sum;
  for (const v of pool) {
    r -= (state.weights[v.name] ?? 1);
    if (r <= 0) return v;
  }
  return pool[pool.length - 1];
}

function validSpot(rnd, half, snowZ) {
  for (let t = 0; t < 12; t++) {
    const x = (rnd() * 2 - 1) * half;
    const z = (rnd() * 2 - 1) * half;
    const h = sampleH(x, z);
    if (h < state.water + 0.6 || h > snowZ) continue;
    const [ix, iz] = worldToGrid(x, z);
    const sl = slopeAt(clamp(Math.round(ix), 0, N - 1), clamp(Math.round(iz), 0, N - 1));
    if (sl > 0.55) continue;
    // clumping mask -> groves, not uniform sprinkle
    const clump = 0.5 + 0.5 * noise.fbm(x * 0.012, z * 0.012, 3);
    if (rnd() > clump * 1.25) continue;
    return { x, z, h };
  }
  return null;
}

function scatter() {
  if (!assetsReady) { flash('assets still loading…'); return; }
  pushUndo();
  clearPlaced(false);
  const rnd = makeNoise((state.seed ^ 0x9e37 ^ state.placementSeed) >>> 0).rand;
  const pools = { trees: [], rocks: [], vegetation: [], props: [] };
  for (const v of variants) {
    if (v.parts.length && pools[v.cat] && (state.weights[v.name] ?? 1) > 0) pools[v.cat].push(v);
  }
  if (!pools.trees.length && !pools.rocks.length && !pools.vegetation.length) {
    flash('no included assets (weights all 0?)'); return;
  }
  const div = LITE ? 330 : 110;
  const target = Math.max(1, Math.round(state.density * terrain.size * terrain.size / div));
  const shares = { trees: 0.45, vegetation: 0.3, rocks: 0.15, props: 0.1 };
  const want = {};
  for (const c in shares) want[c] = Math.round(target * shares[c]);
  const half = terrain.size / 2 - 6;
  const snowZ = terrain.maxH * 0.72;
  let placed = 0, guard = 0;
  const attempts = target * 6;
  while (placed < target && guard < attempts) {
    guard++;
    const cats = Object.keys(want).filter((c) => want[c] > 0 && pools[c].length);
    if (!cats.length) break;
    const pool_total = cats.reduce((s, c) => s + want[c], 0);
    let cr = rnd() * pool_total, cat = cats[0];
    for (const c of cats) { cr -= want[c]; if (cr <= 0) { cat = c; break; } }
    const v = weightedPick(pools[cat], rnd);
    if (!v) { want[cat] = 0; continue; }
    const spot = validSpot(rnd, half, snowZ);
    if (!spot) continue;
    if (v.items.length >= v.cap) { want[cat] = 0; continue; }
    const [sc0, sc1] = SCALE_RANGES[cat] || [0.6, 1.4];
    const vs = state.vScale[v.name] ?? 1;
    v.items.push({
      x: spot.x, y: spot.h - 0.15, z: spot.z,
      rot: rnd() * Math.PI * 2,
      scale: lerp(sc0, sc1, rnd()) * vs,
    });
    want[cat]--;
    placed++;
  }
  rebuildInstances();
  updateVariantCounts();
  flash(`scattered ${placed} assets · placement seed ${state.placementSeed}` +
        ` (density ${state.density.toFixed(2)})`);
}

function randomizeVariant(v) {
  if (!assetsReady || !v.parts.length) return;
  if (!v.items.length) { flash(v.name + ' has no placements yet — scatter first'); return; }
  pushUndo();
  const rnd = makeNoise((state.placementSeed ^ hashStr(v.name)) >>> 0).rand;
  const half = terrain.size / 2 - 6;
  const snowZ = terrain.maxH * 0.72;
  const [sc0, sc1] = SCALE_RANGES[v.cat] || [0.6, 1.4];
  const vs = state.vScale[v.name] ?? 1;
  const n = v.items.length;
  const out = [];
  let guard = 0;
  while (out.length < n && guard < n * 14) {
    guard++;
    const spot = validSpot(rnd, half, snowZ);
    if (!spot) continue;
    out.push({ x: spot.x, y: spot.h - 0.15, z: spot.z,
      rot: rnd() * Math.PI * 2, scale: lerp(sc0, sc1, rnd()) * vs });
  }
  v.items = out;
  rebuildInstances();
  updateVariantCounts();
  flash(v.name + ': re-randomized ' + out.length + ' placements');
}

function clearPlaced(flashMsg = true) {
  for (const v of variants) v.items.length = 0;
  rebuildInstances();
  if (flashMsg) flash('placed assets cleared');
}

function placeAt(x, z) {
  const v = variants[variantIndex[state.selectedAsset]];
  if (!v || !v.parts.length) { flash('select an asset first'); return; }
  const h = sampleH(x, z);
  if (h < state.water + 0.3) { flash('cannot place under water'); return; }
  if (v.items.length >= v.cap) { flash('capacity reached'); return; }
  pushUndo();
  v.items.push({
    x, y: h - 0.1, z,
    rot: Math.random() * Math.PI * 2,
    scale: 0.75 + Math.random() * 0.7,
  });
  rebuildInstances();
}

/* ============================== minimap ============================== */
const mini = $('minimap');
const mctx = mini.getContext('2d');
let miniBase = document.createElement('canvas');
miniBase.width = N; miniBase.height = N;

function drawMinimapBase() {
  const ctx = miniBase.getContext('2d');
  const img = ctx.createImageData(N, N);
  const H = terrain.heights;
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const i = hIdx(ix, iz);
      const r = clamp(terrain.colors[i * 3], 0, 1);
      const g = clamp(terrain.colors[i * 3 + 1], 0, 1);
      const b = clamp(terrain.colors[i * 3 + 2], 0, 1);
      const o = (iz * N + ix) * 4;
      // linear -> sRGB-ish for the 2D canvas
      img.data[o] = 255 * Math.pow(r, 1 / 2.2);
      img.data[o + 1] = 255 * Math.pow(g, 1 / 2.2);
      img.data[o + 2] = 255 * Math.pow(b, 1 / 2.2);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function drawMinimap() {
  const w = mini.width, h = mini.height;
  mctx.clearRect(0, 0, w, h);
  mctx.imageSmoothingEnabled = true;
  mctx.drawImage(miniBase, 0, 0, w, h);
  // water level tint
  if (state.layers.water) {
    mctx.save();
    mctx.globalAlpha = 0.0;
    mctx.restore();
  }
  const W2X = (x) => ((x + terrain.size / 2) / terrain.size) * w;
  const W2Z = (z) => ((z + terrain.size / 2) / terrain.size) * h;
  // camera position + view direction
  const cx = W2X(camera.position.x), cz = W2Z(camera.position.z);
  mctx.fillStyle = '#fff';
  mctx.beginPath(); mctx.arc(cx, cz, 4, 0, 7); mctx.fill();
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  mctx.strokeStyle = '#fff'; mctx.lineWidth = 2;
  mctx.beginPath(); mctx.moveTo(cx, cz);
  mctx.lineTo(cx + dir.x * 34, cz + dir.z * 34); mctx.stroke();
  // region rect
  if (state.region) {
    const R = state.region;
    mctx.strokeStyle = '#35d07f'; mctx.lineWidth = 2;
    mctx.strokeRect(W2X(R.x0), W2Z(R.z0), W2X(R.x1) - W2X(R.x0), W2Z(R.z1) - W2Z(R.z0));
  }
}

/* ---- per-variant scatter controls (rows follow the active tab) ---- */
function renderVariantRows() {
  const box = $('variantRows');
  if (!box) return;
  const list = variants.filter((v) => v.cat === state.assetCat);
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<div style="color:var(--muted);font-size:11px">loading…</div>';
    return;
  }
  for (const v of list) {
    if (!(v.name in state.weights)) state.weights[v.name] = 1;
    if (!(v.name in state.vScale)) state.vScale[v.name] = 1;
    const row = document.createElement('div');
    row.className = 'vrow';
    const head = document.createElement('div');
    head.className = 'vhead';
    const nm = document.createElement('span');
    nm.className = 'vname';
    nm.textContent = v.name.replace(/^V_/, '').replace(/_/g, ' ');
    nm.title = 'click to select this asset for the Place tool';
    nm.addEventListener('click', () => {
      state.selectedAsset = v.name;
      setTool('place');
      box.querySelectorAll('.vname').forEach((x) => { x.style.color = ''; });
      nm.style.color = 'var(--accent)';
      flash('place mode: ' + nm.textContent + ' — click the terrain');
    });
    const cnt = document.createElement('span');
    cnt.className = 'vcount';
    cnt.dataset.c = v.name;
    cnt.textContent = v.items.length;
    cnt.title = 'instances currently placed';
    const rbtn = document.createElement('button');
    rbtn.className = 'vbtn';
    rbtn.innerHTML = '&#8635;';
    rbtn.title = 'randomize only this asset\'s placements';
    rbtn.addEventListener('click', () => randomizeVariant(v));
    head.append(nm, cnt, rbtn);
    const w = document.createElement('input');
    w.type = 'range'; w.min = 0; w.max = 1; w.step = 0.05;
    w.value = state.weights[v.name];
    w.title = 'density weight — share of the scatter pool (0 = excluded)';
    w.addEventListener('input', () => { state.weights[v.name] = parseFloat(w.value); });
    w.addEventListener('change', () => scatter());
    const s = document.createElement('input');
    s.type = 'range'; s.min = 0.3; s.max = 3; s.step = 0.05;
    s.value = state.vScale[v.name];
    s.title = 'size multiplier for this asset';
    s.style.marginTop = '2px';
    s.addEventListener('input', () => { state.vScale[v.name] = parseFloat(s.value); });
    s.addEventListener('change', () => scatter());
    row.append(head, w, s);
    box.appendChild(row);
  }
}
function updateVariantCounts() {
  document.querySelectorAll('.vcount[data-c]').forEach((el) => {
    const v = variants.find((x) => x.name === el.dataset.c);
    if (v) el.textContent = v.items.length;
  });
}

/* ============================== asset tiles ============================== */
function buildAssetTiles(thumbs) {
  renderTiles(state.assetCat, thumbs);
}
function renderTiles(cat, thumbs) {
  const box = $('assetTiles');
  box.innerHTML = '';
  for (const [c, name, v] of thumbs) {
    if (c !== cat) continue;
    const el = document.createElement('div');
    el.className = 'tile' + (state.selectedAsset === name ? ' on' : '');
    el.dataset.name = name;
    const cv = document.createElement('canvas');
    cv.width = 160; cv.height = 92;
    el.appendChild(cv);
    const lab = document.createElement('div');
    lab.textContent = name.replace(/^V_/, '').replace(/_/g, ' ');
    el.appendChild(lab);
    el.addEventListener('click', () => {
      if (v.pending && !v.parts.length) { ensureHqLoaded(); return; }
      state.selectedAsset = name;
      setTool('place');
      document.querySelectorAll('.tile').forEach((t) => t.classList.toggle('on', t.dataset.name === name));
    });
    box.appendChild(el);
    drawThumb(v, cv);
  }
}
function drawThumb(v, cv) {
  const ctx = cv.getContext('2d');
  const im = thumbCache.get(v.name);
  if (!im) { ctx.fillStyle = '#2a2f37'; ctx.fillRect(0, 0, cv.width, cv.height); return; }
  ctx.drawImage(im, 0, 0, cv.width, cv.height);
}

/* ---- Edit tool: Blender-style vertex/face select + vertical move ----
   Heightfield note: grid XY is fixed by the mesh, so "move" = height (Z),
   which is what sculpt-style terrain editing in Blender does too. */
let editDrag = null;
let selPts = null, selFaceLines = null;
const SEL_MAX = 4096;

function ensureSelHelpers() {
  if (selPts) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',
    new THREE.BufferAttribute(new Float32Array(SEL_MAX * 3), 3));
  g.setDrawRange(0, 0);
  selPts = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xffd400, size: 9, sizeAttenuation: false, depthTest: false }));
  selPts.frustumCulled = false;
  selPts.renderOrder = 6;
  scene.add(selPts);
  selFaceLines = new THREE.LineSegments(new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xffd400, depthTest: false }));
  selFaceLines.frustumCulled = false;
  selFaceLines.renderOrder = 6;
  scene.add(selFaceLines);
}

function updateSelMarkers() {
  ensureSelHelpers();
  const pos = selPts.geometry.attributes.position;
  const c = terrain.size / (N - 1), h = terrain.size / 2;
  let n = 0;
  for (const i of state.selVerts) {
    if (n >= SEL_MAX) break;
    const ix = i % N, iz = (i / N) | 0;
    pos.setXYZ(n, -h + ix * c, terrain.heights[i] + 0.5, -h + iz * c);
    n++;
  }
  selPts.geometry.setDrawRange(0, n);
  pos.needsUpdate = true;
  const segs = [];
  for (const key of state.selQuads) {
    const [ix, iz] = key.split(',').map(Number);
    const hh = (ii, jj) => terrain.heights[jj * N + ii] + 0.5;
    const x0 = -h + ix * c, x1 = -h + (ix + 1) * c;
    const z0 = -h + iz * c, z1 = -h + (iz + 1) * c;
    const a = [x0, hh(ix, iz), z0], b = [x1, hh(ix + 1, iz), z0];
    const d = [x1, hh(ix + 1, iz + 1), z1], e = [x0, hh(ix, iz + 1), z1];
    segs.push(...a, ...b, ...b, ...d, ...d, ...e, ...e, ...a);
  }
  selFaceLines.geometry.dispose();
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
  selFaceLines.geometry = lg;
}

function clearSelection(silent) {
  const had = state.selVerts.size || state.selQuads.size;
  state.selVerts.clear();
  state.selQuads.clear();
  updateSelMarkers();
  if (!silent && had) flash('selection cleared');
}

function handleEditDown(ev, hit) {
  if (!hit) { controls.enabled = true; return; }
  const [gx, gz] = worldToGrid(hit.x, hit.z);
  const fx = clamp(Math.floor(gx), 0, N - 2);
  const fz = clamp(Math.floor(gz), 0, N - 2);
  const corners = [[fx, fz], [fx + 1, fz], [fx, fz + 1], [fx + 1, fz + 1]];
  // pressing anywhere inside the cell of an existing selection = grab it
  const onSelection = corners.some(([a, b2]) => state.selVerts.has(b2 * N + a));
  if (!onSelection) {
    if (state.editMode === 'face') {
      if (!ev.shiftKey) clearSelection(true);
      state.selQuads.add(fx + ',' + fz);
      for (const [a, b2] of corners) state.selVerts.add(b2 * N + a);
      updateSelMarkers();
      flash('face selected — drag up/down to move it · Shift+click adds');
    } else {
      const ix = clamp(Math.round(gx), 0, N - 1);
      const iz = clamp(Math.round(gz), 0, N - 1);
      if (!ev.shiftKey) clearSelection(true);
      state.selVerts.add(iz * N + ix);
      updateSelMarkers();
      flash('vertex selected — drag up/down to move it · Shift+click adds');
    }
  }
  // every edit press may become a move gesture (screen-space, see pointermove)
  editDrag = {
    y0: ev.clientY,
    sel: [...state.selVerts].map((i) => ({ i, h: terrain.heights[i] })),
    pushed: false,
  };
  controls.enabled = false;   // this press must not start an orbit
}

function applyEditDrag(clientY) {
  if (!editDrag || !editDrag.sel.length) return;
  const dy = editDrag.y0 - clientY;              // drag up = positive
  if (Math.abs(dy) < 3) return;                  // still just a click
  if (!editDrag.pushed) { pushUndo(); editDrag.pushed = true; }
  // pixels -> world height, scaled by how far the camera is
  const dist = camera.position.distanceTo(controls.target);
  const dz = dy * dist * 0.0022;
  for (const { i, h } of editDrag.sel) terrain.heights[i] = h + dz;
  rebuildTerrain(false);
  updateSelMarkers();
}

/* ============================== pointer / tools ============================== */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let lastHit = null;
let strokeActive = false;
let regionDrag = null;
let arrowDrag = null;
let undoBeforeStroke = false;

function hitTerrain(ev) {
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObject(proxy, false);
  if (!hits.length) return null;
  const p = hits[0].point;
  return { x: p.x, z: p.z, h: sampleH(p.x, p.z) };
}

const ring = $('brushRing');
function updateRing(ev, hit) {
  const tools = ['sculpt', 'pull', 'flatten', 'scale', 'mountain', 'lake', 'smooth'];
  if (state.play || !tools.includes(state.tool) || !hit) { ring.style.display = 'none'; return; }
  // project hit + offset along camera-right to get px radius
  const a = new THREE.Vector3(hit.x, hit.h, hit.z);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const b = a.clone().addScaledVector(right, state.size);
  const pa = a.clone().project(camera), pb = b.clone().project(camera);
  const rect = canvas.getBoundingClientRect();
  const sx = (pa.x * 0.5 + 0.5) * rect.width + rect.left;
  const sy = (-pa.y * 0.5 + 0.5) * rect.height + rect.top;
  const px = Math.abs((pb.x - pa.x) * 0.5 * rect.width) || 8;
  ring.style.display = 'block';
  ring.style.left = sx + 'px';
  ring.style.top = sy + 'px';
  ring.style.width = ring.style.height = Math.max(10, px * 2) + 'px';
}

canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  if (state.play) return;
  const hit = hitTerrain(ev);

  if (state.tool === 'edit') {
    handleEditDown(ev, hit);
    ev.preventDefault();
    return;
  }

  // region arrow drag (screen-space proximity to gizmo head)
  if (state.region && regionArrow) {
    const head = regionArrow.position.clone();
    head.y += 17.5;
    const p = head.project(camera);
    const rect = canvas.getBoundingClientRect();
    const sx = (p.x * 0.5 + 0.5) * rect.width, sy = (-p.y * 0.5 + 0.5) * rect.height;
    if (Math.hypot(ev.clientX - rect.left - sx, ev.clientY - rect.top - sy) < 34) {
      arrowDrag = { y0: ev.clientY, raise0: regionParams.raise };
      pushUndo();
      controls.enabled = false;
      ev.preventDefault();
      return;
    }
  }

  if (state.tool === 'region') {
    if (!hit) { clearRegion(); return; }
    pushUndo();
    startRegion(hit.x, hit.z);
    regionDrag = true;
    controls.enabled = false;
    ev.preventDefault();
    return;
  }
  if (state.tool === 'place') {
    if (hit) placeAt(hit.x, hit.z);
    return;
  }
  // brush stroke
  if (hit) {
    strokeActive = true;
    undoBeforeStroke = true;
    pushUndo();
    controls.enabled = false;
    state.stroking = true;
    applyBrush(hit.x, hit.z, ev.altKey);
    lastHit = hit;
    ev.preventDefault();
  }
}, { capture: true });

window.addEventListener('pointermove', (ev) => {
  if (state.play) { ring.style.display = 'none'; return; }
  const hit = hitTerrain(ev);
  lastHit = hit;
  updateRing(ev, hit);
  ring.classList.toggle('neg', ev.altKey);

  if (arrowDrag && state.region) {
    const dy = arrowDrag.y0 - ev.clientY;
    regionParams.raise = clamp(arrowDrag.raise0 + dy * 0.12, -20, 40);
    syncRegionSliders();
    rebuildRegion();
    return;
  }
  if (regionDrag && regionRect && hit) {
    regionRect.x1 = hit.x; regionRect.z1 = hit.z;
    drawRegionPreview();
    return;
  }
  if (editDrag) { applyEditDrag(ev.clientY); return; }
  if (strokeActive && hit) {
    applyBrush(hit.x, hit.z, ev.altKey);
  }
});

function drawRegionPreview() {
  if (regionLines) { scene.remove(regionLines); regionLines.geometry.dispose(); regionLines = null; }
  const r = regionRect;
  const top = terrain.maxH + 2;
  const pts = [
    r.x0, top, r.z0, r.x1, top, r.z0,
    r.x1, top, r.z0, r.x1, top, r.z1,
    r.x1, top, r.z1, r.x0, top, r.z1,
    r.x0, top, r.z1, r.x0, top, r.z0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  regionLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x35d07f }));
  scene.add(regionLines);
}

window.addEventListener('pointerup', () => {
  if (editDrag) {
    editDrag = null;
    controls.enabled = true;
    rebuildTerrain(false);
    updateSelMarkers();
    return;
  }
  if (state.tool === 'edit') { controls.enabled = true; return; }
  if (arrowDrag) { arrowDrag = null; controls.enabled = true; return; }
  if (regionDrag && regionRect) {
    regionDrag = false;
    controls.enabled = true;
    commitRegion(regionRect.x1, regionRect.z1);
    return;
  }
  if (strokeActive) {
    strokeActive = false;
    state.stroking = false;
    controls.enabled = true;
    rebuildTerrain(false);
    afterEdit();
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', () => {}, { passive: true });

function afterEdit() { updateProxy(); drawMinimap(); }

/* ============================== UI wiring ============================== */
function setTool(t) {
  state.tool = t;
  document.querySelectorAll('#toolGrid button').forEach((b) =>
    b.classList.toggle('on', b.dataset.tool === t));
  const names = {
    sculpt: 'Sculpt', pull: 'Pull', flatten: 'Flatten', scale: 'Scale',
    mountain: 'Mountain', lake: 'Lake', smooth: 'Smooth', region: 'Region',
    edit: 'Edit', place: 'Place',
  };
  $('stTool').textContent = names[t] || t;
  const hints = {
    sculpt: 'drag to raise · Alt to lower',
    pull: 'drag for wide pillow bumps',
    flatten: 'drag to level toward brush height',
    scale: 'drag to amplify local relief · Alt to shrink',
    mountain: 'drag to build ridged peaks · Alt to erode',
    lake: 'drag to carve below the water line',
    smooth: 'drag to relax noisy terrain',
    region: 'drag a rectangle · sliders + green arrow transform it',
    edit: 'click = select · Shift+click = add · drag up/down = move · Esc clears',
    place: 'click terrain to place the selected asset',
  };
  $('stMsg').textContent = hints[t] || '';
  if (t !== 'region' && state.region) clearRegion();
  if (t !== 'edit') clearSelection(true);
}
document.querySelectorAll('#toolGrid button').forEach((b) =>
  b.addEventListener('click', () => setTool(b.dataset.tool)));

function bindSlider(id, valId, key, fmt = (v) => v) {
  const el = $(id), out = $(valId);
  el.addEventListener('input', () => {
    state[key] = parseFloat(el.value);
    out.textContent = fmt(state[key]);
    if (key === 'water') { water.position.y = state.water; rebuildTerrain(false); drawMinimap(); }
    if (key === 'base' || key === 'rough') { /* applied on Regenerate */ }
  });
  out.textContent = fmt(state[key]);
}
bindSlider('bSize', 'bSizeV', 'size', (v) => v.toFixed(0));
bindSlider('bHeight', 'bHeightV', 'height', (v) => v.toFixed(1));
bindSlider('bStr', 'bStrV', 'strength', (v) => v.toFixed(2));
bindSlider('bFall', 'bFallV', 'falloff', (v) => v.toFixed(2));
bindSlider('wLevel', 'wLevelV', 'water', (v) => v.toFixed(1));
bindSlider('pBase', 'pBaseV', 'base', (v) => v.toFixed(1));
bindSlider('pRough', 'pRoughV', 'rough', (v) => v.toFixed(2));
bindSlider('sDensity', 'sDensityV', 'density', (v) => v.toFixed(2));

$('tBlend').addEventListener('input', (e) => {
  uni.uTexBlend.value = parseFloat(e.target.value);
  $('tBlendV').textContent = parseFloat(e.target.value).toFixed(2);
});
$('tTile').addEventListener('input', (e) => {
  const m = parseFloat(e.target.value);
  uni.uTileScale.value = 1 / m;
  $('tTileV').textContent = m + 'm';
});
bindSlider('bHeight', 'bHeightV', 'height', (v) => v.toFixed(1));
$('bMode').addEventListener('change', (e) => { state.brushMode = e.target.value; });
$('pPlaceSeed').addEventListener('change', (e) => {
  state.placementSeed = parseInt(e.target.value, 10) || 0;
});
$('btnDice2').addEventListener('click', () => {
  state.placementSeed = (Math.random() * 99999) | 0;
  $('pPlaceSeed').value = state.placementSeed;
  flash('placement seed = ' + state.placementSeed + ' (press Randomize to apply)');
});
$('btnReshuffle').addEventListener('click', () => {
  state.placementSeed = (Math.random() * 99999) | 0;
  $('pPlaceSeed').value = state.placementSeed;
  scatter();
});
function applyWaterStyle(key) {
  const s = WATER_STYLES[key] || WATER_STYLES.tropical;
  wuni.uShallow.value.setHex(s.sh);
  wuni.uMid.value.setHex(s.mid);
  wuni.uDeep.value.setHex(s.deep);
  const sel = $('wStyle');
  if (sel && sel.value !== key) sel.value = key;
}
$('wStyle').addEventListener('change', (e) => applyWaterStyle(e.target.value));

/* Map Style: palette + rule params + scatter weights + water + texture
   swaps (desert dunes, volcanic lava-as-dirt patches) in one switch. */
function applyMapStyle(name) {
  const st = MAP_STYLES[name] || MAP_STYLES.stylized;
  ST = st; WM = st.wMul;
  for (const k in LCOL) LCOL[k].setHex(st.pal[k]);
  // style-specific texture swaps
  if (TTEX.dunes) uni.uTSand.value = (name === 'desert') ? TTEX.dunes
    : (TTEX.sand || uni.uTSand.value);
  if (TTEX.lava) uni.uTDirt.value = (name === 'volcanic') ? TTEX.lava
    : (TTEX.dirt || uni.uTDirt.value);
  applyWaterStyle(st.water);
  if (st.sky !== undefined) {
    scene.background.setHex(st.sky);
    scene.fog.color.setHex(st.sky);
  }
  state.flatShading = !!st.flat;
  const cf = $('chkFlat');
  if (cf) cf.checked = state.flatShading;
  if (terrain.mat) {
    terrain.mat.flatShading = state.flatShading;
    terrain.mat.needsUpdate = true;
  }
  // scatter weight rules per style
  for (const v of variants) state.weights[v.name] = styleWeight(v.name);
  rebuildTerrain(false);
  renderVariantRows();
  flash('map style: ' + name);
}
$('mapStyle').addEventListener('change', (e) => applyMapStyle(e.target.value));
// size slider shares UI with brush radius in state.size ✓ (single source)

$('shapeRound').addEventListener('click', () => {
  state.shape = 'round';
  $('shapeRound').style.borderColor = 'var(--accent)';
  $('shapeBox').style.borderColor = 'var(--border)';
});
$('shapeBox').addEventListener('click', () => {
  state.shape = 'box';
  $('shapeBox').style.borderColor = 'var(--accent)';
  $('shapeRound').style.borderColor = 'var(--border)';
});
function setEditMode(mode) {
  state.editMode = mode;
  $('emVertex').style.borderColor = mode === 'vertex' ? 'var(--accent)' : 'var(--border)';
  $('emVertex').style.background = mode === 'vertex' ? '#2b3341' : 'transparent';
  $('emFace').style.borderColor = mode === 'face' ? 'var(--accent)' : 'var(--border)';
  $('emFace').style.background = mode === 'face' ? '#2b3341' : 'transparent';
  clearSelection(true);
  if (state.tool === 'edit') flash('edit mode: ' + mode);
}
$('emVertex').addEventListener('click', () => setEditMode('vertex'));
$('emFace').addEventListener('click', () => setEditMode('face'));

$('chkFlat').addEventListener('change', (e) => {
  state.flatShading = e.target.checked;
  terrain.mesh.material.flatShading = state.flatShading;
  terrain.mesh.material.needsUpdate = true;
});
$('chkGrid').addEventListener('change', (e) => {
  state.showGrid = e.target.checked;
  grid.visible = state.showGrid;
  grid.position.y = terrain.minH - 1.5;
  grid.scale.setScalar(terrain.size / 1024 * 2.2);
});

$('btnRegen').addEventListener('click', () => {
  state.seed = parseInt($('pSeed').value, 10) || 0;
  state.worldSize = parseInt($('pSize').value, 10);
  pushUndo();
  if (state.worldSize !== terrain.size) {
    terrain.size = state.worldSize;
    // rebuild geometry for the new footprint
    if (terrain.mesh) { scene.remove(terrain.mesh); terrain.mesh.geometry.dispose(); terrain.mesh = null; terrain.geo = null; }
    if (proxy) { scene.remove(proxy); proxy.geometry.dispose(); }
    buildProxy();
    controls.maxDistance = state.worldSize * 3;
    clearRegion();
  }
  regenerate();
  flash(`regenerated · seed ${state.seed} · ${state.worldSize} m`);
});
$('btnDice').addEventListener('click', () => {
  $('pSeed').value = (Math.random() * 99999) | 0;
});

/* layers */
const LAYER_ORDER = [
  ['rock', 'Rock / Mountain'], ['snow', 'Snow'], ['grass', 'Grass'],
  ['dirt', 'Dirt'], ['sand', 'Sand'], ['water', 'Water'],
];
function buildLayers() {
  const box = $('layerList');
  box.innerHTML = '';
  for (const [key, label] of LAYER_ORDER) {
    const row = document.createElement('div');
    row.className = 'layer' + (state.layers[key] ? '' : ' off');
    const sw = document.createElement('div');
    sw.className = 'sw';
    sw.style.background = key === 'water'
      ? '#1f74b8'
      : '#' + LAYER_HEX[key].toString(16).padStart(6, '0');
    const nm = document.createElement('div');
    nm.className = 'nm'; nm.textContent = label;
    const eye = document.createElement('div');
    eye.className = 'eye'; eye.textContent = state.layers[key] ? '◉' : '○';
    row.append(sw, nm, eye);
    row.addEventListener('click', () => {
      state.layers[key] = !state.layers[key];
      row.classList.toggle('off', !state.layers[key]);
      eye.textContent = state.layers[key] ? '◉' : '○';
      rebuildTerrain(false);
    });
    box.appendChild(row);
  }
}

/* region sliders */
const rbind = (id, valId, key, fmt = (v) => v) => {
  $(id).addEventListener('input', (e) => {
    regionParams[key] = parseFloat(e.target.value);
    $(valId).textContent = fmt(regionParams[key]);
    if (!state.region) return;
    rebuildRegion();
  });
};
rbind('rRaise', 'rRaiseV', 'raise', (v) => v.toFixed(1));
rbind('rMx', 'rMxV', 'mx', (v) => v.toFixed(0));
rbind('rMz', 'rMzV', 'mz', (v) => v.toFixed(0));
rbind('rSx', 'rSxV', 'sx', (v) => v.toFixed(2));
rbind('rSz', 'rSzV', 'sz', (v) => v.toFixed(2));
$('btnRegionClear').addEventListener('click', clearRegion);

/* scatter controls */
$('btnScatter').addEventListener('click', scatter);
$('btnClear').addEventListener('click', () => clearPlaced());

/* asset tabs */
document.querySelectorAll('#assetTabs button').forEach((b) =>
  b.addEventListener('click', () => {
    state.assetCat = b.dataset.cat;
    document.querySelectorAll('#assetTabs button').forEach((x) =>
      x.classList.toggle('on', x === b));
    if (b.dataset.cat === 'hq') ensureHqLoaded();
    const thumbs = variants.map((v) => [v.cat, v.name, v]);
    renderTiles(state.assetCat, thumbs);
    renderVariantRows();
  }));

/* play/edit mode */
$('btnPlay').addEventListener('click', () => {
  state.play = true;
  document.body.classList.add('play');
  $('btnPlay').classList.add('on'); $('btnEdit').classList.remove('on');
  ring.style.display = 'none';
});
$('btnEdit').addEventListener('click', () => {
  state.play = false;
  document.body.classList.remove('play');
  $('btnEdit').classList.add('on'); $('btnPlay').classList.remove('on');
});

/* keyboard */
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (e.key === 'Escape') {
    if (state.tool === 'edit') { clearSelection(); }
    else { clearRegion(); setTool('sculpt'); }
  }
  const map = { '1': 'sculpt', '2': 'pull', '3': 'flatten', '4': 'scale', '5': 'mountain', '6': 'lake', '7': 'smooth', '8': 'region', '9': 'place' };
  if (map[e.key]) setTool(map[e.key]);
});

let flashTimer = 0;
function flash(msg) {
  $('stMsg').textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { $('stMsg').textContent = ''; }, 3200);
}

/* ============================== boot & loop ============================== */
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

buildLayers();
buildProxy();
regenerate();
loadTerrainTextures();
loadAssets();
rebuildInstances();
resize();

let lastMini = 0, lastT = 0;
renderer.setAnimationLoop((t) => {
  window.__frames = (window.__frames || 0) + 1;
  const dt = lastT ? Math.min(t - lastT, 200) : 16;
  lastT = t;
  wuni.uTime.value = t * 0.001;
  if (water.material.map) {
    water.material.map.offset.x += dt * 0.0000045;
    water.material.map.offset.y += dt * 0.0000022;
  }
  controls.update();
  // keep sun shadow box around view target
  sun.target.position.copy(controls.target);
  sc.left = -terrain.size * 0.7; sc.right = terrain.size * 0.7;
  sc.top = terrain.size * 0.7; sc.bottom = -terrain.size * 0.7;
  sc.updateProjectionMatrix();
  renderer.render(scene, camera);
  if (t - lastMini > 220) { drawMinimap(); lastMini = t; }
});

window.__editor = { state, terrain, applyBrush, regenerate, scatter, undo, flash,
  hitTerrain,                       // diagnostic: same raycast the handlers use
  texStatus: () => ({
    blend: uni.uTexBlend.value, tileScale: uni.uTileScale.value,
    sand: !!uni.uTSand.value, grass: !!uni.uTGrass.value,
    rock: !!uni.uTRock.value, snow: !!uni.uTSnow.value,
    dirt: !!uni.uTDirt.value, waterMap: !!water.material.map,
    waterW: Math.round(water.geometry.parameters?.width || 0),
    sky: '#' + scene.background.getHexString(),
    wgtMax: Math.max(...terrain.wgt.subarray(0, 4000)),
  }),
  glctx: () => renderer.getContext(),
  renderOnce: () => renderer.render(scene, camera),
  rebuild: () => rebuildTerrain(false),
  setView: (px, py, pz, tx, ty, tz) => {
    camera.position.set(px, py, pz);
    controls.target.set(tx, ty, tz);
    controls.update();
  },
  rtProbe: () => {   // deterministic: rendered pixels vs CPU colors at the spike
    const W2 = 320, H2 = 200;
    const rt = new THREE.WebGLRenderTarget(W2, H2);
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    const buf = new Uint8Array(W2 * H2 * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W2, H2, buf);
    renderer.setRenderTarget(null);
    rt.dispose();
    const sample = (wx, wy, wz) => {
      const v = new THREE.Vector3(wx, wy, wz).project(camera);
      const px = Math.round((v.x * 0.5 + 0.5) * (W2 - 1));
      const py = Math.round((v.y * 0.5 + 0.5) * (H2 - 1));
      const o = (py * W2 + px) * 4;
      return [buf[o], buf[o + 1], buf[o + 2]];
    };
    const N = terrain.N, c = terrain.size / (N - 1);
    const colAt = (wx, wz) => {
      const gx = Math.round((wx + terrain.size / 2) / c);
      const gz = Math.round((wz + terrain.size / 2) / c);
      const i = clamp(gz, 0, N - 1) * N + clamp(gx, 0, N - 1);
      return {
        h: Math.round(terrain.heights[i]),
        linRGB: [0, 1, 2].map((k) => +terrain.colors[i * 3 + k].toFixed(2)),
        wgt: [0, 1, 2, 3].map((k) => +terrain.wgt[i * 4 + k].toFixed(2)),
      };
    };
    return {
      blend: uni.uTexBlend.value,
      tip: { render: sample(20, 165, -40), cpu: colAt(20, -40) },
      mid: { render: sample(20, 90, -40), cpuH: colAt(20, -40).h },
      base: { render: sample(20, 3, -40), cpu: colAt(8, -30) },
    };
  },
  instanceStats: () => {
    const out = { total: 0, perCat: {}, samples: [] };
    for (const v of variants) {
      out.total += v.items.length;
      out.perCat[v.cat] = (out.perCat[v.cat] || 0) + v.items.length;
      if (v.items.length && out.samples.length < 4) {
        const it = v.items[0];
        out.samples.push({ name: v.name, pos: [it.x, +it.y.toFixed(1), it.z],
          scale: +it.scale.toFixed(2) });
        // also report the source model's raw size (bbox)
        if (!v._bb) {
          const b = new THREE.Box3().setFromObject(
            (() => { const g = new THREE.Group();
              for (const p of v.parts) g.add(new THREE.Mesh(p.geo, p.mat));
              return g; })());
          v._bb = [+(b.max.x - b.min.x).toFixed(2), +(b.max.y - b.min.y).toFixed(2),
                   +(b.max.z - b.min.z).toFixed(2)];
        }
        out.samples[out.samples.length - 1].modelSize = v._bb;
      }
    }
    let meshes = 0, drawn = 0;
    scene.traverse((o) => { if (o.isInstancedMesh) { meshes++; drawn += o.count; } });
    out.instancedMeshes = meshes; out.instancedCount = drawn;
    return out;
  },
  get strokeActive() { return strokeActive; },
  get regionDrag() { return regionDrag; },
  get controlsOn() { return controls.enabled; } };
console.log('[terrain-editor] ready');
