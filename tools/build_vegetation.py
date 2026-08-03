# Builds the forest and the rocks, and exports assets/models/vegetation.glb
#
# This file exists because vegetation.glb was the last asset in the project with
# no source: it was made in a throwaway session and never written down. Rendering
# it (tools/render_models.py) showed two faults that had been shipping since:
#
#   * every spruce had a bare trunk spiking out of the top of its canopy, because
#     the topmost skirts get skipped once they are too small to draw and nothing
#     replaced them
#   * so much of each tree was snow material that 5200 of them read as white
#     cones, and the rocks read as white blobs
#
# Both are fixed here. Snow now sits only on faces flat enough to hold it.

import bpy, bmesh, math, random, os
from mathutils import Matrix, Vector

OUT = "/Users/jurek/Downloads/Claude/Projects/SKI Together/assets/models"

for _o in [o for o in bpy.data.objects if o.type == 'MESH']:
    bpy.data.objects.remove(_o, do_unlink=True)


def mat(name, colour, rough=0.8, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


# Three needle tones, because a conifer lit from one side is not one colour, and
# with 5200 of them on screen the variation is most of what stops the forest
# looking like a texture.
NEEDLE_DARK = mat("Needle", (0.048, 0.088, 0.058), 0.93)
NEEDLE_MID = mat("NeedleMid", (0.075, 0.135, 0.082), 0.90)
NEEDLE_LIT = mat("NeedleLit", (0.115, 0.190, 0.110), 0.88)
SNOW = mat("SnowLoad", (0.880, 0.910, 0.955), 0.72)
BARK = mat("Bark", (0.105, 0.075, 0.058), 0.95)
ROCK = mat("Rock", (0.115, 0.112, 0.108), 0.90)
ROCK_LT = mat("RockLight", (0.205, 0.198, 0.188), 0.86)

TREE_MATS = [NEEDLE_DARK, SNOW, BARK, NEEDLE_LIT, NEEDLE_MID]
ND, SN, BK, NL, NM = range(5)


def obj(name, mats):
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    for m in mats:
        ob.data.materials.append(m)
    return ob


def spruce(name, height=11.0, seed=1, snow=0.55, width=0.22, lean=0.02):
    """Norway spruce as a stack of drooping skirts.

    The canopy is closed at the top by a leader cone. Without it the trunk — which
    has to run the full height to hold the skirts — pokes out of the tip like an
    aerial, on every tree in the world.
    """
    rng = random.Random(seed)
    ob = obj(name, TREE_MATS)
    bm = bmesh.new()

    trunk_r = height * 0.019
    # Stops well inside the canopy; the leader below carries the silhouette.
    ret = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=7,
                                radius1=trunk_r * 1.8, radius2=trunk_r * 0.5,
                                depth=height * 0.74)
    for v in ret['verts']:
        v.co.z += height * 0.37
    bark = set(bm.faces)

    layers = max(9, int(height * 1.7))
    base_h = height * 0.09
    top_drawn = base_h
    for i in range(layers):
        t = i / (layers - 1)
        z = base_h + (height - base_h) * (t ** 1.02) * 0.99
        shape = ((1.0 - t) ** 1.22) * (0.46 + 0.54 * min(1.0, t * 6.5))
        r = height * width * shape * (0.88 + rng.random() * 0.24)
        if r < height * 0.008:
            continue
        top_drawn = max(top_drawn, z)
        seg = 11 if r > height * 0.09 else (9 if r > height * 0.04 else 7)
        drop = r * (0.40 + rng.random() * 0.16)
        cone = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=True, segments=seg,
                                     radius1=r, radius2=r * 0.05, depth=drop)
        ang = rng.random() * math.tau
        jx = (rng.random() - 0.5) * r * 0.08
        jy = (rng.random() - 0.5) * r * 0.08
        for v in cone['verts']:
            v.co.z += drop * 0.5 + z
            x, y = v.co.x, v.co.y
            v.co.x = x * math.cos(ang) - y * math.sin(ang) + jx
            v.co.y = x * math.sin(ang) + y * math.cos(ang) + jy
            d = math.hypot(v.co.x - jx, v.co.y - jy)
            v.co.z -= (d / max(r, 1e-4)) ** 2 * drop * 0.34
            v.co.x += lean * z

    # The leader: a narrow cone from the last skirt to the very tip, so the tree
    # ends in foliage.
    leader_base = height * width * 0.055
    lead = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=True, segments=7,
                                 radius1=max(leader_base, trunk_r * 1.6), radius2=0.0,
                                 depth=height - top_drawn + height * 0.02)
    for v in lead['verts']:
        v.co.z += top_drawn + (height - top_drawn) * 0.5
        v.co.x += lean * height * 0.9

    bm.normal_update()
    for f in bm.faces:
        if f in bark:
            f.material_index = BK
            continue
        up = f.normal.z
        # Snow settles on what is flat enough to hold it, and nowhere else. The
        # old threshold of 0.26 put snow on faces that were nearly vertical, which
        # is how the forest turned white.
        if up > 0.45 and rng.random() < snow:
            f.material_index = SN
        elif up > 0.12:
            f.material_index = NL
        elif up > -0.15:
            f.material_index = NM
        else:
            f.material_index = ND

    bm.to_mesh(ob.data)
    bm.free()
    return ob


def rock(name, size=1.6, seed=1, bumpiness=0.30, snow=0.55):
    rng = random.Random(seed)
    ob = obj(name, [ROCK, ROCK_LT, SNOW])
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=size)
    for v in bm.verts:
        n = v.co.normalized()
        v.co = n * size * (1.0 + (rng.random() - 0.5) * bumpiness * 2.0)
        v.co.z *= 0.60 + rng.random() * 0.22
        v.co.x *= 0.85 + rng.random() * 0.35
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, size * 0.30))
    bm.normal_update()
    for f in bm.faces:
        # Only the flattest tops, and not all of them: a rock with snow on every
        # upward face is a snowball.
        if f.normal.z > 0.62 and rng.random() < snow:
            f.material_index = 2
        elif f.normal.z > 0.08:
            f.material_index = 1
        else:
            f.material_index = 0
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def stump(name, seed=3):
    rng = random.Random(seed)
    ob = obj(name, [BARK, SNOW, ROCK])
    bm = bmesh.new()
    r = 0.30 + rng.random() * 0.12
    ret = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=9,
                                radius1=r * 1.35, radius2=r, depth=0.85)
    for v in ret['verts']:
        v.co.z += 0.42
    # A ragged sawn top rather than a flat disc.
    bm.normal_update()
    for v in bm.verts:
        if v.co.z > 0.8:
            v.co.z += (rng.random() - 0.5) * 0.09
    bm.normal_update()
    for f in bm.faces:
        f.material_index = 1 if f.normal.z > 0.6 else 0
    bm.to_mesh(ob.data)
    bm.free()
    return ob


made = [
    spruce("tree_spruce_a", height=12.0, seed=11, snow=0.58, width=0.225, lean=0.015),
    spruce("tree_spruce_b", height=8.6, seed=27, snow=0.46, width=0.245, lean=-0.02),
    spruce("tree_spruce_c", height=16.0, seed=41, snow=0.64, width=0.205, lean=0.008),
    spruce("tree_spruce_d", height=5.2, seed=63, snow=0.38, width=0.275, lean=0.03),
    rock("rock_a", size=1.9, seed=5, bumpiness=0.34, snow=0.55),
    rock("rock_b", size=3.4, seed=9, bumpiness=0.26, snow=0.62),
    rock("rock_c", size=0.9, seed=13, bumpiness=0.40, snow=0.40),
    stump("stump_a", seed=3),
]

_x = 0
for _ob in made:
    _ob.location = (_x, 0, 0)
    _x += max(_ob.dimensions.x, 1.5) * 1.25 + 2

bpy.ops.object.select_all(action='DESELECT')
for _o in made:
    _o.select_set(True)
bpy.context.view_layer.objects.active = made[0]
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "vegetation.glb"),
                          export_format='GLB', use_selection=True,
                          export_apply=True, export_yup=True)
print("EXPORTED vegetation.glb %d B  %d faces" % (
    os.path.getsize(os.path.join(OUT, "vegetation.glb")),
    sum(len(o.data.polygons) for o in made)))
for _o in made:
    print("  %-16s %5.1f x %5.1f x %5.1f m  %4d faces" % (_o.name, *_o.dimensions, len(_o.data.polygons)))
