# Terrain Editor (browser, Three.js)

Draw-and-scale smooth terrain in real time — a sculpt/paint terrain engine
in the spirit of the reference editor UI: brush tools, procedural
regenerate, layered materials, an asset browser of real CC0 tree/rock
plants, scatter, minimap, and a region gizmo that raises / moves /
anisotropically **scales** any rectangle of terrain in any direction.

## Run

```
cd /home/kristo/terrain-editor/web
python3 -m http.server 8901 --bind 0.0.0.0
```

Open `http://localhost:8901/` (from Windows: the WSL localhost port is
forwarded; or `http://localhost:8901` directly in any browser that can
reach the VM). A server is required — `fetch()` of the GLB assets is
blocked on `file://`.

URL flags:
- `?lite` — no antialias, 1× pixel ratio, 1024 shadow map, no instance
  shadows, scatter÷3. For software-rendered/weak GPUs (verified: keeps
  the tab alive and screenshottable where the full path starves).
- `?nothumbs` — skip asset thumbnails (debug/diagnosis aid).

## Tools

| Tool | Action |
|---|---|
| Sculpt | drag raises, Alt+drag lowers |
| Pull | wide pillow bumps |
| Flatten | levels toward the height under the brush center |
| **Scale** | amplifies local relief while painting (Alt shrinks it back) |
| Mountain | ridged-noise peaks (Alt erodes) |
| Lake | carves below the water line so the water plane fills in |
| Smooth | relaxes noisy areas |
| **Region** | drag a rectangle → panel sliders + green 3D arrow **Raise**, **Move X/Z**, **Scale X/Z** (anisotropic — stretch a plateau in any direction) |
| Place | click-to-place the selected asset |

Brush: Size / Strength / Falloff / Round-Box shape. Keys 1–9 pick tools,
Ctrl+Z undoes strokes and region ops, Esc drops selection and returns to
Sculpt. RMB/MMB orbit, wheel zoom.

## Right panel

- Terrain Properties: water level, low-poly flat shading, ground grid
- Procedural: seed (⟳ random), terrain size 256/512/1024 m, base height,
  roughness, Regenerate (seeded fBm + ridged mix, island edge falloff)
- Layers: Rock/Mountain, Snow, Grass, Dirt, Sand, Water visibility
- Vegetation Scatter: density slider, Scatter (clump-masked, slope- and
  water-aware), Clear

## Assets

- **Low-poly default set** (`web/assets/lp/`, 93 models, 1.54 MB): Kenney
  Nature Kit (CC0) via github.com/shorepine/kenney raw paths — trees /
  rocks+logs / plants+flowers+fungi. Baked to real-world scale at load
  (Kenney authors ~1 m trees; we normalize trees to 9 m, plants ~0.65 m,
  rocks ~1 m, pivot pinned to y=0).
- **HQ set** (`web/assets/models/`, 11 variants, 56 MB): the Poly Haven
  CC0 models from the landscape-engine project, decimated ≤16k tris
  (jacaranda 58k) by `tools/export_variants.py`. Lazily loaded on first
  HQ-tab click — eager loading OOM-crashed software-rendered browsers.
- **Terrain textures v2** (`web/assets/textures/terrain/`, all CC0, license
  badges verified on source pages — see `MANIFEST.md`): toon rock (Feraly,
  brightened ×1.85 then ×0.85 for contrast vs snow), 512 grass (athile),
  1024 snow (GGBotNet, normalized to near-white ~242), 1024 dirt
  (LuminousDragonGames) — wired as a real 5th shader layer with its own
  weight, so brown ground patches survive the texture blend. Weight rules
  are ONE set shared by flat-color and textured modes: sand ring → dirt
  band/patches → grass (flat, low-mid, thins with altitude) → rock (slope
  >0.33 OR above rock line, suppressed under snow) → snow (height-based,
  weight ×2 dominance, capped snow line so one giant spike can't push snow
  out of reach). Beyond the tile the water plane stops (tile-sized) and the
  background is light-blue sky — floating-island look.
  grass/earth/sand/snow = OGA "4 cartoony terrains textures" (Danimal);
  rock = "Tiled Seamless Rock Texture" (Mohamkey); water_light/dark =
  "Seamless water tiles" (Hazmat Harry). Fetched by
  `tools/fetch_lp_assets.py`.

**Performance root-causes fixed here:** thumbnail atlas (N viewport draws +
one readback instead of 93 GPU syncs — the old loop starved the page);
a second WebGLRenderer for thumbs crashed software rasterizers (never use
one); default scatter = low-poly pool (1,192 × ~200 tris ≈ 19–21 ms/frame
in the software-rendered test VM, measured with gl.finish).

Everything else (three.js r170, `vendor/three/`) is vendored locally —
no CDN dependency.

## Edit tool (Blender-style point/face editing)

**Edit** (left tools): click selects a terrain **vertex** (or a **face**
quad via the Vertex/Face toggle under Brush Settings), Shift+click adds to
the selection (yellow markers + quad outline), and **dragging from the
selection moves it up/down** — release drops, Ctrl+Z undoes, Esc clears.
Note: the heightfield keeps grid XY fixed, so movement is height (Z) — the
same constraint Blender's terrain/sculpt workflows have.

## Packs & Props tab

- New **Props** tab: converted CC0 packs (3TD Tropical: jungle huts,
  jetty, crates, coconut, bamboo/banana/tropical plants; 3TD Ruins:
  cathedral/pillar/arch/temple ruin pieces ×12; Modular Temple kit
  pieces) — auto-discovered from `web/assets/lp/manifest.json` by
  `tools/convert_packs.py` (OBJ/Blender) + `tools/convert_dae.py`
  (pycollada path — Blender 5.2 dropped COLLADA import).
- Scatter now has a 4th pool (props, 10% share) so huts/ruins can litter
  a jungle map like the trees do.
- **PS2 / Crash (sunset)** map style: vivid saturated palette, warm pink
  sky, flat shading, palms/jungle/ruin props boosted, snow mostly off —
  matching the reference beach screenshot.
- Everything still missing (tiki totem, dome hut, fence, statue, snow
  pine, ...) is specced with image/model-generation prompts in
  **GAP-ASSETS.md**.

## Map Styles & snow line

- **Map Style** dropdown (Terrain Properties): Stylized / Autumn / Desert /
  Winter / Volcanic. Each preset = layer palette + rule params (sand line
  height, grass ceiling, snow-line offset) + layer multipliers + per-asset
  scatter weight rules (ordered substring matches) + water style +
  texture swaps (desert -> hand-painted dunes; volcanic -> lava in the
  dirt slot as sparse veins). ONE weight rule set feeds both flat-color
  and textured modes, so styles cannot disagree between modes.
- **Snow/rock transition**: stochastic per-~1m-block binary snap across a
  ~5m height band (noise-ordered thresholds) + a darker contact band under
  the line - chunky stylized edge, not mush (close-up verified: blocks
  snap white/grey, contact band visible).
- Extra CC0 textures: sand_dunes (txturs), lava (StarNinjas); full
  provenance in `web/assets/textures/terrain/MANIFEST.md`.

## Architecture

- `web/index.html` — editor chrome (3-pane, dark) + importmap
- `web/js/app.js` — heightfield model (256² Float32 grid), brush system,
  region transform (inverse-map resampling), instancing, minimap, UI
- `web/js/noise.js` — seeded simplex fBm/ridged
- Vertex colors recompute from height + slope + layer toggles; edits are
  CPU height writes + position/normal sync (fast at 66k verts)

## Verified

- boots with no console errors; terrain h range ≈ -20..25 at seed 12345
- brush stroke raises terrain via real PointerEvents (Δheight +4331 across
  a stroke); Ctrl+Z restores exactly (Δ 0.0000)
- region select + Scale X slider resamples (1,680 cells), panel shows,
  deselect clears; procedural Regenerate with a new seed changes heights
- 11 asset thumbnails painted through one offscreen render target; 3 tabs
  switch instantly; scatter reports counts at multiple densities
  (0.05→40, 0.5→397 lite / 1192 full, 1.0→2913 pre-fix); final screenshot
  visually confirmed: terrain zones, water, scattered trees, full panel UI
- root-caused along the way: a second WebGL context (thumbnail renderer)
  crashes software-rasterized browsers — thumbnails now reuse the main
  renderer; 70k-tri variants × thousands of instances starves any
  renderer — web GLBs re-exported at ≤16k tris
- known limits: no save/load yet, scatter is global (no density brush),
  the headless test browser throttles rAF (frame counters stall) though
  forced captures render correctly — GPU browsers are unaffected
