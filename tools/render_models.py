# Renders every top-level object of a .glb to its own PNG, three-quarter view.
#
# Exists because a bounding box cannot tell a gable from its mirror image, and a
# model nobody has looked at is a model nobody has checked. Run it before
# trusting any hand-made asset:
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background \
#       --python tools/render_models.py -- assets/models/buildings.glb /tmp/out

import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, OUT = argv[0], argv[1]
os.makedirs(OUT, exist_ok=True)

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.import_scene.gltf(filepath=GLB)
roots = [o for o in bpy.context.scene.objects if o.parent is None and o.name != "Sun"]

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in \
    [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
scene.render.resolution_x = 900
scene.render.resolution_y = 700
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("W")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.45, 0.55, 0.70, 1)

sun_data = bpy.data.lights.new("Sun", type="SUN")
sun_data.energy = 4.0
sun = bpy.data.objects.new("Sun", sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(52), 0, math.radians(38))

cam_data = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def bounds(ob):
    pts = []
    for child in [ob] + list(ob.children_recursive):
        if child.type != "MESH":
            continue
        for corner in child.bound_box:
            pts.append(child.matrix_world @ Vector(corner))
    if not pts:
        return None
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def visible_only(target):
    for o in scene.objects:
        if o.type != "MESH":
            continue
        top = o
        while top.parent is not None:
            top = top.parent
        o.hide_render = top is not target


for root in roots:
    b = bounds(root)
    if b is None:
        continue
    lo, hi = b
    centre = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.5)
    visible_only(root)

    # Three-quarter view from slightly above eye level, far enough out that the
    # whole thing fits with room to spare.
    d = radius * 2.9
    cam.location = centre + Vector((d * 0.72, -d * 0.72, d * 0.46))
    direction = centre - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    scene.render.filepath = os.path.join(OUT, f"{root.name}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", root.name)
