"""Export each terrain variant object from landscape.blend as a standalone
GLB for the web terrain editor (single mesh + materials, 70k tris each).

Run AFTER restoring runtime/_stage/ (the blend references images there).
"""
import os
import shutil

import bpy

PROJECT = "/home/kristo/landscape-engine"
STAGE = os.path.join(PROJECT, "runtime", "_stage")
ASSETS = os.path.join(PROJECT, "assets", "models")
OUT = "/home/kristo/terrain-editor/web/assets/models"
os.makedirs(OUT, exist_ok=True)

# restore flat sidecar layout the blend's images point into
for slug in os.listdir(ASSETS):
    src = os.path.join(ASSETS, slug)
    dst = os.path.join(STAGE, slug)
    if not os.path.isdir(src):
        continue
    os.makedirs(dst, exist_ok=True)
    for f in os.listdir(src):
        if not os.path.exists(os.path.join(dst, f)):
            shutil.copy(os.path.join(src, f), os.path.join(dst, f))

bpy.context.view_layer.update()

done = []
for coll_name in ("TreeVariants", "UnderstoryVariants"):
    coll = bpy.data.collections[coll_name]
    # collections were created unlinked (datablock-only): bring them into the
    # scene hierarchy first or objects cannot be selected in the view layer
    if coll.name not in [c.name for c in bpy.context.scene.collection.children]:
        bpy.context.scene.collection.children.link(coll)
    bpy.context.view_layer.update()
    for obj in list(coll.objects):
        missing = [im.name for im in bpy.data.images
                   if im.source == "FILE" and not im.packed_file
                   and not os.path.exists(bpy.path.abspath(im.filepath))]
        if missing:
            print(f"MISSING IMAGES for {obj.name}: {missing[:3]}", flush=True)
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        path = os.path.join(OUT, f"{obj.name}.glb")
        # web budget: instanced scatter multiplies hard - keep every variant
        # <= 16k tris so thousands of instances stay real-time on any GPU
        tris = len(obj.data.polygons)
        if tris > 16000:
            m = obj.modifiers.new("webdec", "DECIMATE")
            m.ratio = 16000.0 / tris
            bpy.ops.object.modifier_apply(modifier=m.name)
        bpy.ops.export_scene.gltf(
            filepath=path, use_selection=True, export_format="GLB",
            export_apply=True, export_materials="EXPORT",
            export_image_format="AUTO",
        )
        size = os.path.getsize(path) // 1024
        print(f"EXPORTED {obj.name} -> {size} KB ({len(obj.data.polygons)} tris)",
              flush=True)
        done.append(obj.name)

print(f"EXPORT_DONE {len(done)} variants", flush=True)
