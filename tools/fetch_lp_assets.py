#!/usr/bin/env python3
"""Fetch low-poly CC0 assets for the terrain editor.

Sources (all CC0):
  * Kenney Nature Kit (329 GLBs) via github.com/shorepine/kenney raw paths
  * "4 cartoony terrains textures" (grass/earth/sand/snow) - OpenGameArt
  * "Tiled Seamless Rock Texture" (512 PNG) - OpenGameArt / Mohamkey
  * "Seamless water tiles" (light/dark 1000px) - OpenGameArt / Hazmat Harry
"""
import json
import os
import re
import subprocess
import sys
import zipfile

WEB = "/home/kristo/terrain-editor/web"
LP = os.path.join(WEB, "assets", "lp")
TEX = os.path.join(WEB, "assets", "textures", "terrain")
TMP = "/home/kristo/.hermes/cache/scratch/lpfetch"
os.makedirs(LP, exist_ok=True)
os.makedirs(TEX, exist_ok=True)
os.makedirs(TMP, exist_ok=True)

UA = "Mozilla/5.0 (terrain-editor-asset-fetch; CC0 sources)"


def curl(url, out, min_size=2048):
    r = subprocess.run(["curl", "-sfL", "-A", UA, "-o", out, url],
                       capture_output=True, text=True)
    ok = r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) >= min_size
    return ok, (os.path.getsize(out) if os.path.exists(out) else 0)


# ---------------- 1. Kenney Nature Kit (GLB) ----------------
api = subprocess.run(
    ["curl", "-sfL", "-A", UA, "-H", "Accept: application/vnd.github+json",
     "https://api.github.com/repos/shorepine/kenney/contents/3d/nature"],
    capture_output=True, text=True).stdout
names = [d["name"] for d in json.loads(api) if d["name"].endswith(".glb")]
print(f"nature kit files: {len(names)}")

TREES = re.compile(r"^(tree|pine|birch|palm|spruce|willow)", re.I)
VEG = re.compile(r"^(grass|flower|plant|fern|mushroom|lily|cactus|clover|reed|sprout|sapling|bush|hedge)", re.I)
ROCKS = re.compile(r"^(boulder|rock|stone|log|stump|ground_.*Rocks)", re.I)

groups = {"trees": [], "vegetation": [], "rocks": []}
for n in sorted(names):
    if TREES.match(n):
        groups["trees"].append(n)
    elif VEG.match(n):
        groups["vegetation"].append(n)
    elif ROCKS.match(n):
        groups["rocks"].append(n)

print({k: len(v) for k, v in groups.items()})
for k, v in groups.items():
    print(k, "->", ", ".join(v))

got, fail = 0, []
for cat, lst in groups.items():
    for n in lst:
        out = os.path.join(LP, n)
        if os.path.exists(out) and os.path.getsize(out) > 500:
            got += 1
            continue
        url = f"https://raw.githubusercontent.com/shorepine/kenney/main/3d/nature/{n}"
        ok, sz = curl(url, out, 300)
        if ok:
            got += 1
        else:
            fail.append(n)
            if os.path.exists(out):
                os.remove(out)
print(f"GLB fetched: {got} failed: {fail}")

# ---------------- 2. terrain textures ----------------
TEXS = {
    "cartoon": ("https://opengameart.org/sites/default/files/4_cartoon_terrains_0.zip",
                os.path.join(TMP, "cartoon.zip"), 100_000),
    "rock": ("https://opengameart.org/sites/default/files/rock_tiled.png",
             os.path.join(TEX, "rock.png"), 50_000),
    "water_light": ("https://opengameart.org/sites/default/files/light_water.jpg",
                    os.path.join(TEX, "water_light.jpg"), 100_000),
    "water_dark": ("https://opengameart.org/sites/default/files/dark_water.jpg",
                   os.path.join(TEX, "water_dark.jpg"), 100_000),
}
res = {}
for key, (url, out, mn) in TEXS.items():
    ok, sz = curl(url, out, mn)
    res[key] = sz if ok else "FAIL"
print("textures:", res)

# unzip cartoon terrains
zpath = os.path.join(TMP, "cartoon.zip")
if os.path.exists(zpath):
    with zipfile.ZipFile(zpath) as z:
        print("zip contents:", z.namelist())
        z.extractall(os.path.join(TMP, "cartoon"))
    # copy jpgs with clean names
    renames = {
        "suelo_hierba_256": "grass.jpg", "suelo_hierba": "grass_hi.jpg",
        "suelo_tierra": "earth.jpg", "suelo_arena": "sand.jpg",
        "suelo_nieve": "snow.jpg",
    }
    for root, _, files in os.walk(os.path.join(TMP, "cartoon")):
        for f in files:
            stem = os.path.splitext(f)[0].lower()
            if f.lower().endswith((".jpg", ".jpeg", ".png")) and stem in renames:
                src = os.path.join(root, f)
                dst = os.path.join(TEX, renames[stem])
                if not os.path.exists(dst):
                    subprocess.run(["cp", src, dst])

print("terrain textures dir:")
for f in sorted(os.listdir(TEX)):
    print(f"  {f}: {os.path.getsize(os.path.join(TEX, f)) // 1024} KB")
print(f"lp models dir: {len(os.listdir(LP))} files, "
      f"{sum(os.path.getsize(os.path.join(LP, f)) for f in os.listdir(LP)) // 1024} KB")
print("FETCH_DONE")
