# Missing assets — models & materials (with generation prompts)

Status of sourcing for the terrain editor. **Found already** (CC0, fetched or
fetched-able) listed first; **MISSING** items have exact specs + prompts for
image generation first / Hunyuan3D image→model second.

**How to add any generated model:** export single-object **GLB ≤16k tris,
pivot at base (min.y = 0), real-world size (a hut ~4m, a totem ~3m, a bush
~1.5m), flat vertex colors or one embedded texture** → drop into
`web/assets/lp/` → add its filename to `web/assets/lp/manifest.json` under
`trees` / `rocks` / `vegetation` / `props` → reload. It gets a tile, weight
row and scatter participation automatically.

---

## A. Twinsanity / PS2 jungle set

### Found (CC0 — fetched)
- 3TD Tropical Environment Pack: jungle huts ×2, jetty ×2, crates ×2,
  coconuts, bamboo ×2, banana trees ×2, tropical plants ×5, beach grass,
  beach rocks/overhang (Ron Kapaun, CC0)
- 3TD Fantasy Ruins Pack: cathedral/foundation/pillar/arch/wall/temple
  ruins ×12 (CC0)
- Modular Temple kit ×14 pieces (Fertile Soil, CC0, OBJ)
- Kenney palms ×5, cactus ×2, grass/flowers/fungi (CC0)

### Found but not fetched (candidates)
- Wooden crates: OGA "free-wooden-crates" (verify badge on page)
- Fence: OGA "Low Poly Forest Pack" (fence pieces, verify badge)
- Low-poly tiki mask: only premium mirrors found (CGTrader/Pinterest) — NOT
  usable; generate instead (below)

### MISSING — generate (image prompt first, then Hunyuan3D)

1. **Tiki totem mask (standing)**
   - Spec: single object, ~3m tall, carved wood with painted red/teal
     accents, chunky PS2-era facets, pivot base, ≤8k tris.
   - Image prompt: `low-poly PS2-era game asset, single standing tiki
     totem mask pole, carved wooden face with painted red and teal
     accents, chunky facets, flat vertex colors, three-quarter view,
     plain light grey background, centered, full object visible, no
     shadows on background`
2. **Round hut with conical thatched roof** (the dome huts in the village
   reference)
   - Spec: ~4m diameter, straw roof + clay walls, round door, ≤10k tris.
   - Image prompt: `low-poly PS2-era game asset, round clay hut with
     conical thatched straw roof and round wooden door, cartoon
     proportions, flat vertex colors, three-quarter view, plain light
     grey background, centered, full object visible`
3. **Village wooden fence set** (3 pieces: straight / corner / broken)
   - Spec: 2m straight segment, chunky planks, ≤2k tris each.
   - Image prompt: `low-poly cartoon wooden fence segment, two vertical
     posts and three chunky planks, warm brown, PS2-era game asset, flat
     vertex colors, side view, plain light grey background`
4. **Ancient tribal statue / altar** (boss-platform vibe)
   - Spec: ~5m, mossy stone carved face on pedestal, ≤12k tris.
   - Image prompt: `low-poly ancient stone tribal statue on pedestal,
     mossy carved face, chunky PS2-era game style, flat vertex colors,
     three-quarter view, plain light grey background, full object`
5. **Giant exotic flower / carnivorous plant**
   - Spec: ~2m, purple-red petals, ≤4k tris.
   - Image prompt: `low-poly giant exotic flower with red and purple
     petals and wide green leaves, cartoon PS2-era game asset, flat
     vertex colors, three-quarter view, plain light grey background`
6. **Hanging vines cluster** (drapes from canopy edges)
   - Spec: 3–6m draped strands, alpha not needed (solid strands), ≤3k.
   - Image prompt: `low-poly cluster of hanging green vines draping
     downward, solid strands no alpha, cartoon game asset, flat vertex
     colors, front view, plain light grey background`
7. **Waterfall rock cluster** (rock lip + falling sheet anchor)
   - Spec: ~6m wide, rock with carved spill channel, ≤10k tris (water
     sheet itself is an engine plane, note for later).
   - Image prompt: `low-poly rocky waterfall lip cluster with carved
     spill channel, wet dark stone, PS2-era game asset, flat vertex
     colors, three-quarter view, plain light grey background`

---

## B. Earlier gaps (style packs — Hunyuan model offers still open)

All specs as in the RUNBOOK; all single-object GLB, pivot base, ≤16k:

8. **Snow-covered pine** — 6–9m, white clumped snow on dark green
   needles.
   - Prompt: `low-poly pine tree with chunky white snow clumps on dark
     green needles, brown trunk, PS2-era game asset, flat vertex colors,
     front view, plain light grey background, full tree visible`
9. **Burnt / dead tree (volcanic)** — 4–6m, black charred branches.
   - Prompt: `low-poly dead burnt tree, black charred trunk and bare
     twisted branches, ash particles not needed, PS2-era game asset,
     flat vertex colors, front view, plain light grey background`
10. **Autumn bush** — 1.5m, orange/amber canopy.
    - Prompt: `low-poly rounded bush with orange and amber autumn
      leaves, small brown stems, cartoon game asset, flat vertex colors,
      front view, plain light grey background`
11. **Dune grass tuft** — 0.5m, dry yellow-green blades.
    - Prompt: `low-poly tuft of dry dune grass, yellow-green blades
      fanning up, cartoon game asset, flat vertex colors, front view,
      plain light grey background`
12. **Agave / succulent** — 0.8m, blue-green spikes (desert).
    - Prompt: `low-poly agave succulent, thick blue-green pointed
      leaves in a rosette, cartoon game asset, flat vertex colors,
      front view, plain light grey background`
13. **Snow-capped boulder** — 1.5m, grey rock with white cap.
    - Prompt: `low-poly boulder with white snow cap on top, grey faceted
      rock below, PS2-era game asset, flat vertex colors, three-quarter
      view, plain light grey background`
14. **Driftwood / coral piece** — shore prop, 2m.
    - Prompt: `low-poly bleached driftwood branch piece with a few coral
      bumps, cartoon game asset, flat vertex colors, three-quarter view,
      plain light grey background`

---

## C. Missing materials / engine pieces

- **Jungle floor texture** (dark mossy green forest ground, seamless,
  512+) — have forest_ground (brownish); a proper mossy-green tile would
  sharpen the jungle style. Prompt: `seamless tileable 512x512 hand-
  painted stylized jungle floor texture, mossy dark green with small
  leaves and dirt patches, flat lighting, top-down, no shadows`.
- **Thatched straw texture** (for hut roofs if re-textured) — prompt:
  `seamless tileable 512x512 hand-painted straw thatch texture, warm
  golden yellow layered reeds, flat lighting, top-down, no shadows`.
- **Gradient sunset sky** — engine currently sets a FLAT sky color per
  style; a two-stop gradient (pink→peach for PS2 style) is an engine
  TODO, not an asset.
- **Fireflies / butterflies** — engine particle feature (twinkling
  sprites), not a model; also TODO.

---

## D. Priority if generating

1. Tiki totem + round hut (they define the Twinsanity read instantly)
2. Snow pine + burnt tree (finish winter/volcanic styles)
3. Fence set + tribal statue (village scenes)
4. Rest as time allows.

All generated images double as references for placing the final asset in
the editor (weight/scale defaults in the style's rules table).
