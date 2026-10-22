"""DAE -> GLB converter for the CC0 packs (Blender 5.2 dropped COLLADA).

pycollada parses scene+transforms+materials; trimesh assembles and exports
GLB (embeds diffuse textures). Same budget rules as convert_packs.py:
pivot min.y=0, max dim cap 30m. Writes dae_manifest.json (merged into
lp/manifest.json afterwards).
"""
import json
import os
import re
import sys

import collada
import numpy as np
import trimesh
from PIL import Image

SCRATCH = "/home/kristo/.hermes/cache/scratch/ps2packs"
OUT = "/home/kristo/terrain-editor/web/assets/lp"
FLUSH = lambda *a: print(*a, flush=True)  # noqa: E731


def categorize(path):
    p = path.lower()
    if "/ruins/" in p:
        return "props"
    if any(k in p for k in ("junglehut", "jetty", "crate", "coconut")):
        return "props"
    if any(k in p for k in ("banana", "palm")):
        return "trees"
    if any(k in p for k in ("/rocks/", "stone", "rock")):
        return "rocks"
    if any(k in p for k in ("kelp", "reef", "seaplant")):
        return None
    if any(k in p for k in ("plants", "bush", "bamboo", "fern", "elephantear",
                            "phila", "beachgrass", "birdnest", "groundcover")):
        return "vegetation"
    if "/trees/" in p:
        return "trees"
    return "props"


def prefix_for(path):
    return "ruins" if "/ruins/" in path.lower() else "trop"


_img_cache = {}


def diffuse_for(prim):
    """-> (PIL image or None, rgb tint tuple or None)"""
    try:
        mat = prim.material
        if mat is None:
            return None, None
        eff = mat.effect
        d = getattr(eff, "diffuse", None)
        if isinstance(d, tuple):
            return None, tuple(d)
        # texture Map: d.sampler.image.path (relative to the .dae)
        path = d.sampler.image.path
        if path.startswith("file://"):
            path = path[7:]
        return path, None
    except Exception:
        return None, None


def load_dae_meshes(path):
    m = collada.Collada(path)
    base = os.path.dirname(path)
    out = []
    bound_geoms = list(m.scene.objects("geometry")) if m.scene else []
    if not bound_geoms:
        class Fake:
            matrix = np.eye(4)
            def primitives(self):
                for g in m.geometries:
                    yield from g.primitives
        bound_geoms = [Fake()]
    for bg in bound_geoms:
        mat4 = np.array(getattr(bg, "matrix", np.eye(4)), dtype=float)
        try:
            prims = list(bg.primitives())
        except Exception:
            prims = list(bg)
        for prim in prims:
            verts = getattr(prim, "vertex", None)
            fidx = getattr(prim, "vertex_index", None)
            if verts is None or fidx is None or len(verts) == 0 or len(fidx) == 0:
                continue
            tv = verts.astype(float)
            hom = np.hstack([tv, np.ones((len(tv), 1))])
            tv = (mat4 @ hom.T).T[:, :3]
            faces = np.asarray(fidx).reshape(-1, 3)
            uv = None
            try:
                u = getattr(prim, "vertex_texcoord", None)
                if u is not None and len(u) == len(verts):
                    uv = np.asarray(u, dtype=float)[:, :2]
            except Exception:
                pass
            img_rel, tint = diffuse_for(prim)
            pil = None
            if img_rel:
                ip = img_rel if os.path.isabs(img_rel) else os.path.normpath(
                    os.path.join(base, img_rel))
                if ip in _img_cache:
                    pil = _img_cache[ip]
                else:
                    try:
                        pil = Image.open(ip).convert("RGB")
                    except Exception:
                        pil = None
                    _img_cache[ip] = pil
            out.append((tv, faces, uv, pil, tint))
    return out


def main():
    daes = []
    for root, _, files in os.walk(SCRATCH):
        for f in files:
            if f.lower().endswith(".dae"):
                daes.append(os.path.join(root, f))
    manifest = {"trees": [], "rocks": [], "vegetation": [], "props": []}
    ok = fail = 0
    for src in sorted(daes):
        cat = categorize(src)
        if not cat:
            continue
        base = re.sub(r"[^A-Za-z0-9]+", "_", os.path.splitext(os.path.basename(src))[0])
        name = f"{prefix_for(src)}_{base}"
        try:
            parts = load_dae_meshes(src)
            if not parts:
                FLUSH(f"EMPTY {name}")
                fail += 1
                continue
            meshes = []
            for tv, faces, uv, pil, tint in parts:
                kw = {}
                if pil is not None:
                    kw["visual"] = trimesh.visual.texture.TextureVisuals(
                        uv=uv, image=pil)
                elif tint is not None:
                    c = [int(255 * min(1, max(0, x))) for x in tint[:3]]
                    kw["visual"] = trimesh.visual.ColorVisuals(
                        vertex_colors=np.tile(c + [255], (len(tv), 1)))
                meshes.append(trimesh.Trimesh(vertices=tv, faces=faces, **kw))
            mesh = (trimesh.util.concatenate(meshes) if len(meshes) > 1
                    else meshes[0])
            # budget: pivot + size cap (decimate if a pack ships a heavy LOD)
            tri = len(mesh.faces)
            if tri > 12000:
                try:
                    mesh = mesh.simplify_quadric_decimation(face_count=12000)
                    tri = len(mesh.faces)
                except Exception:
                    pass
            ext = mesh.extents.max()
            if ext > 30:
                mesh.apply_scale(30.0 / ext)
            lo = mesh.bounds[0]
            mesh.apply_translation([-lo[0], -lo[1], -lo[2]])
            path = os.path.join(OUT, name + ".glb")
            data = trimesh.Scene([mesh]).export(file_type="glb")
            with open(path, "wb") as fh:
                fh.write(data)
            manifest[cat].append(name)
            ok += 1
            FLUSH(f"OK {name} ({len(mesh.faces)} tris, {len(data)//1024}KB)")
        except Exception as e:
            fail += 1
            FLUSH(f"FAIL {name}: {type(e).__name__}: {e}")
    with open(os.path.join(OUT, "dae_manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    FLUSH(f"DAE_DONE ok={ok} fail={fail} " +
          json.dumps({k: len(v) for k, v in manifest.items()}))


if __name__ == "__main__":
    sys.exit(main())
