"""Convert CC0 pack models (DAE/OBJ) to web GLBs + write lp/manifest.json.

Run: blender -b --python convert_packs.py
Inputs: /home/kristo/.hermes/cache/scratch/ps2packs/{tropical,ruins,temple}
Output: web/assets/lp/<prefix>_<name>.glb  +  web/assets/lp/manifest.json
Budget: <=12k tris/model, max dimension cap 30m, pivot pinned at y=0.
"""
import json
import math
import os
import re

import bpy

SCRATCH = "/home/kristo/.hermes/cache/scratch/ps2packs"
OUT = "/home/kristo/terrain-editor/web/assets/lp"
os.makedirs(OUT, exist_ok=True)
FLUSH = lambda *a: print(*a, flush=True)  # noqa: E731

manifest = {"trees": [], "rocks": [], "vegetation": [], "props": []}

# ---- collect files --------------------------------------------------------
dae = []
for root, _, files in os.walk(SCRATCH):
    for f in files:
        if f.lower().endswith(".dae"):
            dae.append(os.path.join(root, f))

# temple: curated subset (modular kit - pieces, not 213 near-duplicates)
TEMPLE_KEEP = re.compile(
    r"^(Floor_Normal_Square|Floor_Ruined_Straight_1|"
    r"Floor_Ruined_Corner_Outer_1|Floor_Curved_Large|Floor_Bridge_Ramp|"
    r"Balcony_Base_Straight|Balcony_Railing_Straight|Balcony_Base_Tower|"
    r"Balcony_Railing_Tower|Pillar_Large_Base|Pillar_Large_Middle|"
    r"Pillar_Large_Top|Pillar_Large_Arch|Prop_Flag_1|Prop_Flag_Sun|"
    r"Prop_Rug_Middle|Prop_Vase|Prop_Rubble_1|"
    r"(Wall|Stairs|Roof|Window|Door)_.*)\.obj$",
    re.I)
temple = []
troot = os.path.join(SCRATCH, "temple")
for root, _, files in os.walk(troot):
    for f in files:
        if f.lower().endswith(".obj") and TEMPLE_KEEP.match(f):
            temple.append(os.path.join(root, f))
FLUSH(f"dae={len(dae)} temple-obj={len(temple)}")

# ---- categorize -----------------------------------------------------------
def categorize(path):
    p = path.lower()
    name = os.path.splitext(os.path.basename(path))[0]
    if "/ruins/" in p or "/temple" in p:
        return "props"
    if any(k in p for k in ("junglehut", "jetty", "crate", "coconut")):
        return "props"
    if any(k in p for k in ("banana", "palm")):
        return "trees"
    if any(k in p for k in ("/rocks/", "stone", "rock")):
        return "rocks"
    if any(k in p for k in ("kelp", "reef", "seaplant")):
        return None                      # ocean-floor pieces: skip
    if any(k in p for k in ("plants", "bush", "bamboo", "fern", "elephantear",
                            "phila", "beachgrass", "birdnest", "groundcover")):
        return "vegetation"
    if "/trees/" in p:
        return "trees"
    return "props"


def prefix_for(path):
    p = path.lower()
    if "/ruins/" in p: return "ruins"
    if "/temple" in p: return "temple"
    if "/tropical" in p: return "trop"
    return "pack"


# ---- convert --------------------------------------------------------------
def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def finalize_and_export(src, out_name):
    objs = [o for o in bpy.data.objects if o.type == "MESH"]
    if not objs:
        return False
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    # bake transforms
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    tris = len(obj.data.polygons)
    if tris > 12000:
        m = obj.modifiers.new("d", "DECIMATE")
        m.ratio = 12000.0 / tris
        bpy.ops.object.modifier_apply(modifier=m.name)
    # world-size sanity cap + pivot at ground
    dim = max(obj.dimensions)
    if dim > 30 and dim > 0:
        s = 30.0 / dim
        obj.scale = (s, s, s)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    zs = [v.co.z for v in obj.data.vertices]
    if zs:
        off = min(zs)
        if abs(off) > 0.001:
            for v in obj.data.vertices:
                v.co.z -= off
    path = os.path.join(OUT, out_name + ".glb")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True,
                              export_format="GLB", export_apply=True)
    FLUSH(f"OK {out_name} ({len(obj.data.polygons)} tris, "
          f"{os.path.getsize(path)//1024}KB)")
    return True


import sys as _sys
TEMPLE_ONLY = os.environ.get("TEMPLE_ONLY") == "1"
jobs = []
for f in ([] if TEMPLE_ONLY else sorted(dae)):
    cat = categorize(f)
    if not cat:
        FLUSH(f"skip {os.path.basename(f)}")
        continue
    base = re.sub(r"[^A-Za-z0-9]+", "_", os.path.splitext(os.path.basename(f))[0])
    name = f"{prefix_for(f)}_{base}"
    jobs.append((f, "dae", cat, name))
for f in sorted(temple):
    base = re.sub(r"[^A-Za-z0-9]+", "_", os.path.splitext(os.path.basename(f))[0])
    jobs.append((f, "obj", "props", f"temple_{base}"))

FLUSH(f"jobs={len(jobs)}")
ok = fail = 0
for i, (src, kind, cat, name) in enumerate(jobs):
    try:
        clear_scene()
        if kind == "dae":
            bpy.ops.wm.collada_import(filepath=src)
        else:
            bpy.ops.wm.obj_import(filepath=src)
        if finalize_and_export(src, name):
            manifest[cat].append(name)
            ok += 1
        else:
            FLUSH(f"EMPTY {name}")
            fail += 1
    except Exception as e:
        fail += 1
        FLUSH(f"FAIL {name}: {e}")

with open(os.path.join(OUT, "manifest.json"), "w") as fh:
    json.dump(manifest, fh, indent=1)
FLUSH(f"DONE ok={ok} fail={fail} manifest=" +
      json.dumps({k: len(v) for k, v in manifest.items()}))
