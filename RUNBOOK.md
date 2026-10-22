# Terrain Editor — Run-book (self-test)

## Round 4: props, PS2 style, vertex/face editing

1. **Props tab** (bottom asset bar): 96 converted CC0 pieces — jungle
   huts, jetty, crates, tropical trees/plants, cathedral/pillar/arch
   ruins, temple kit pieces (3TD packs + Modular Temple, all CC0).
2. **Map Style → "PS2 / Crash (sunset)"**: vivid saturated palette, warm
   pink sky, flat faceted shading, palm/jungle/ruin props boosted, snow
   off, tropical water — matches the Crash Twinsanity reference look
   (proof: `preview-ps2.png`).
3. **Edit tool** (left tools, diamond icon): click = select a terrain
   vertex; **Shift+click** = add more; then **drag up/down anywhere**
   to move the selection (screen-space — works over flat ground too;
   plain click never nudges, Ctrl+Z undoes, Esc clears). Toggle
   **Vertex / Face** under Brush Settings to grab whole quads instead.
   (Heightfield rule: XY is grid-locked, movement is height — same as
   Blender terrain/sculpt editing.)
4. **Scatter** now fills a 4th pool (props, 10% share) so huts/ruins
   litter jungle maps like trees do.
5. **GAP-ASSETS.md** (project root): every asset still missing — exact
   specs + image/Hunyuan prompts (tiki totem, dome hut, fence, statue,
   snow pine, burnt tree, ...). Generated GLBs drop into
   `web/assets/lp/` + one line in `lp/manifest.json`; tools/
   `convert_dae.py` + `convert_packs.py` do packs.

**What this is:** a browser-based terrain editor (draw/scale terrain with
brushes, procedural regenerate, CC0 low-poly asset scatter, textured
layers). Server-side code lives in `web/`; open it through a local server
(browsers block GLB loading on `file://`).

## Start (preconditions)

1. **Double-click `Start Terrain Editor.bat`** in this folder.
   - It opens `http://localhost:8901` in your default browser and, if
     Python is on PATH, also starts the server for you.
   - If the page is blank instead of showing the editor: the server isn't
     running. From the VM: `cd <this-folder>/web && python3 -m http.server 8901`.
     (The VM instance of this server may already be running — try reload first.)
2. Wait for the status line bottom-center to read
   `low-poly assets ready — 93 variants (HQ loads on its tab)` — takes
   ~3–10 s. Everything before that is still loading, not broken.

**Demo content (safe to delete):** the island you see is procedural demo
output (seed **12345**, 512 m, base 0.0, roughness 0.80), and the ~1,192
scattered trees/rocks/plants are demo scatter. **Clear placed assets** in
the right panel removes the scatter; **Regenerate** replaces the terrain.
Nothing is pre-saved — every reload starts from this same demo state.

## The editor in 6 steps

1. **Sculpt** (left panel, selected by default): hold LMB on the terrain
   and drag — ground rises under the brush; hold **Alt** while dragging —
   it lowers. White ring = brush footprint, red ring = lowering.
   Reference: one full drag at Size 30 / Strength 0.50 raised total terrain
   height sum by **+4,331** (measured); **Ctrl+Z** restored it to **Δ 0.0000**.
2. **Scale tool** (4th button): paint over bumpy ground — relief amplifies
   in place; **Alt** shrinks it back toward flat. This is "scale terrain
   while drawing".
3. **Region tool** (8th button): drag a rectangle on the terrain. The
   right panel's **Region** section appears with a green 3D arrow.
   - **Raise** slider (or drag the green arrow up/down): lifts the whole
     selected patch.
   - **Move X / Move Z**: slides the patch's height pattern sideways.
   - **Scale X / Scale Z**: stretches it in one direction only (anisotropic
     — the "scale to any direction" control).
   Reference: a test rect covered **1,680** cells and re-summed correctly
   after Scale X = 1.60. **Deselect region** clears it.
4. **Procedural** (right panel): change **Seed**, press **Regenerate** —
   new island, same demo-scatter rules. Terrain Size swaps 256/512/1024 m.
5. **Textures, materials & water** (right panel): **Brush Mode** dropdown
   (Raise/Lower via Alt, or raise-only / lower-only — measured: one click
   stroke = +333 height-sum at Height 3.0, +999 at Height 9.0, −999 with
   Lower-only). **Textures** slider crossfades flat colors ↔ tiled CC0
   textures (default 0.90); **Tile Size** default 8 m. **Water Level**
   moves the sea; **Water Style** picks the palette: Tropical (turquoise),
   Alpine (glacial teal), Ocean (navy). Water is depth-mapped: a baked
   depth texture drives turquoise shallows → azure → deep royal blue
   offshore, with animated ripples and a foam band at the shoreline.
   **Layers** toggles material bands (Rock, Snow, Grass, Dirt, Sand, Water).
6. **Assets** (bottom panel): tabs **Trees / Rocks / Vegetation** are the
   fast low-poly set (Kenney Nature Kit, CC0 — 93 tiles with thumbnails).
   Click a tile → Place tool active → click terrain to place (rejected
   under water). The **HQ (slow)** tab lazily loads the 11 heavy Poly
   Haven models (56 MB) — leave it alone if framerate matters.

7. **Per-asset scatter controls** (right panel → **Scatter**):
   - **Density** — overall amount; **Seed** + ⟳ = placement seed
     (default 4242); **Randomize placement** = new seed + full re-scatter
     (measured: 1,192 assets re-scatter in well under a second).
   - **One row per asset of the active tab** (Trees tab = 45 rows):
     name (click = Place tool), placed count, **weight slider** = that
     asset's share of the scatter pool, **size slider** = its scale
     multiplier, **⟳** = re-randomize ONLY that asset's positions
     (measured: tree_cone re-randomized 13→13 placements, count held).
   - Weights apply live: setting a weight to 0 excludes the asset on the
     next scatter (measured: tree_blocks weight 0 → count 0, total
     re-allocated to 1,192).

## Reference numbers (measured, not estimated)

| Check | Value |
|---|---|
| Default scatter @ density 0.50 | **1,192** instances (600 trees / 117 rocks / 475 plants) |
| Scatter @ density 0.05 | 40 · @ density 1.0 (earlier full build) | 2,913 |
| Asset tiles per tab | Trees 45 · Rocks 25 · Vegetation 23 · HQ 11 |
| Frame time WITH 1,192 instances, software-rendered test VM | **19.3–21.4 ms** (≈47–52 fps) |
| Asset payload | low-poly 1.54 MB total vs HQ 56 MB |
| Brush stroke (Size 30 / Str 0.5) | +4,331 height-sum, Ctrl+Z exact restore |
| Region test rect | 1,680 cells, Scale X 1.60 applied |
| Textures bound | grass/sand/rock/snow + water map, blend 0.90, tile 8 m |
| Console errors during full session | 0 |
| Scatter control rows (Trees tab) | 45 rows / 90 sliders / 45 randomize buttons |
| Weight 0 on one asset | count 0, total stays 1,192 |
| Per-asset ⟳ | 13 → 13 placements re-rolled |
| Brush Height scaling | H3 = +333, H9 = +999, Lower-only = −999 (same stroke) |
| Water | depth ramp turquoise→royal blue verified visually, 3 style presets |
| Water plane / sky | 522 m (tile-sized, 512×1.02), sky `#cfe8ff`, hemisphere fill 1.05 |
| 5-layer materials | sand/dirt/grass/rock/snow; one weight rule set for BOTH color modes |
| Snow on 169 m spike | snow weight share 0.92 at tip; A/B: rock-off → tip (46,52,59)≈unchanged, snow-off → (11,13,14) collapse = snow dominates the shader |
| New texture sources | toon rock (Feraly), grass 512 (athile), snow 1024 (GGBotNet), dirt 1024 (LuminousDragonGames), dunes (txturs), lava (StarNinjas) — all CC0, badges verified |
| Map Styles (5) | stylized/autumn/desert/winter/volcanic — numeric checks: winter snow@7m=0.53 (stylized 0), volcanic grass 0.09 + palette (0.10,0.05,0.04) + dirt/lava veins 0.12, desert sand@7m=0.55, autumn palette (0.62,0.34,0.11) |
| Snow line | ~5m blocky stochastic transition + dark contact band — close-up vision: "blocks snap white/grey, NOT a gradient, darker band under edge" |

If your measured numbers differ wildly (e.g. scatter = 0, tiles = 0 after
30 s), something is broken — check the browser console first.

## Controls

LMB = tool · RMB/MMB = orbit · wheel = zoom · **1–9** = tool shortcuts ·
**Ctrl+Z** = undo (strokes, region, regenerate, scatter) · **Esc** =
deselect region / back to Sculpt · Editor/Play toggle hides the UI.

## Asset credits (all CC0 — no attribution required, appreciated)

- **Kenney Nature Kit** (93 low-poly models) — kenney.nl, CC0
- **"4 cartoony terrains textures"** by Danimal — OpenGameArt, CC0
  (grass/earth/sand/snow)
- **"Tiled Seamless Rock Texture"** by Mohamkey — OpenGameArt, CC0
- **"Seamless water tiles"** by Hazmat Harry — OpenGameArt, CC0
- **Poly Haven** models (HQ tab, 11 variants) — polyhaven.com, CC0
- three.js r170 (MIT), vendored in `web/vendor/`
