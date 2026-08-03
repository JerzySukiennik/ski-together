# Builds SKI Together's lift hardware and resort props, and exports
# assets/models/lifts.glb
#
# The station is the important one. A chairlift terminal is a HORIZONTAL bullwheel
# that turns the haul rope through 180 degrees, with a flat boarding deck under it
# at snow level, because skiers glide on — they do not climb stairs in ski boots.

import bpy, bmesh, math, os
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


STEEL   = mat("Steel", (0.42, 0.44, 0.47), 0.38, 1.0)
GALV    = mat("Galvanised", (0.60, 0.62, 0.65), 0.55, 1.0)
PAINT_Y = mat("PaintYellow", (0.86, 0.58, 0.06), 0.42)
PAINT_R = mat("PaintRed", (0.66, 0.10, 0.08), 0.45)
PAINT_B = mat("PaintBlue", (0.06, 0.19, 0.55), 0.45)
PAINT_K = mat("PaintBlack", (0.030, 0.036, 0.045), 0.50)
PAINT_W = mat("PaintWhite", (0.86, 0.88, 0.91), 0.45)
RUBBER  = mat("Rubber", (0.030, 0.032, 0.035), 0.90)
WOOD    = mat("Wood", (0.190, 0.115, 0.062), 0.82)
WOODL   = mat("WoodLight", (0.330, 0.215, 0.128), 0.78)
GLASSY  = mat("Glazing", (0.055, 0.085, 0.115), 0.12, 0.15)
FABRIC  = mat("Fabric", (0.70, 0.30, 0.05), 0.92)
CHROME  = mat("Chrome", (0.78, 0.80, 0.83), 0.16, 1.0)
SNOW    = mat("SnowLoad", (0.880, 0.910, 0.955), 0.72)
CONCRETE = mat("Concrete", (0.42, 0.42, 0.41), 0.88)
LAMP    = mat("Lamp", (1.0, 0.86, 0.55), 0.35)


def obj(name, mats):
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    for m in mats:
        ob.data.materials.append(m)
    return ob


def tag(bm, before, mi):
    for f in bm.faces:
        if f not in before:
            f.material_index = mi


def tube(bm, p0, p1, r0, r1=None, seg=12, mi=0):
    r1 = r0 if r1 is None else r1
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    if d.length < 1e-6:
        return
    before = set(bm.faces)
    ret = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                                radius1=r0, radius2=r1, depth=d.length)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bmesh.ops.transform(bm, matrix=Matrix.Translation(p0 + d * 0.5) @ q.to_matrix().to_4x4(),
                        verts=ret['verts'])
    tag(bm, before, mi)


def box(bm, centre, size, mi=0, rot=None):
    before = set(bm.faces)
    ret = bmesh.ops.create_cube(bm, size=1.0)
    m = Matrix.Translation(Vector(centre)) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal(Vector(size).to_4d())
    bmesh.ops.transform(bm, matrix=m, verts=ret['verts'])
    tag(bm, before, mi)


def disc(bm, centre, radius, thickness, mi=0, seg=32, axis=None):
    """Flat disc lying in the XY plane unless an axis rotation is given."""
    before = set(bm.faces)
    ret = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                                radius1=radius, radius2=radius, depth=thickness)
    m = Matrix.Translation(Vector(centre))
    if axis:
        m = m @ Matrix.Rotation(math.pi / 2, 4, axis)
    bmesh.ops.transform(bm, matrix=m, verts=ret['verts'])
    tag(bm, before, mi)


def build(name, mats, fn, smooth=False):
    ob = obj(name, mats)
    bm = bmesh.new()
    fn(bm)
    bm.normal_update()
    bm.to_mesh(ob.data)
    bm.free()
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob


made = []
CABLE_H = 7.0   # must equal CLEARANCE in src/world/resort.js, or the wheel
#                 sits below the rope it is supposed to be turning

# ---------------------------------------------------------------- pylons


def lift_pylon(bm):
    tube(bm, (0, 0, 0.05), (0, 0, 0.95), 0.64, 0.52, seg=14, mi=4)     # concrete footing
    tube(bm, (0, 0, 0.6), (0, 0, 11.0), 0.42, 0.26, seg=14, mi=0)
    tube(bm, (-2.6, 0, 10.62), (2.6, 0, 10.62), 0.17, 0.17, seg=10, mi=1)
    for side in (-1, 1):
        x = side * 2.38
        tube(bm, (x, -0.55, 10.42), (x, 0.55, 10.42), 0.095, 0.095, seg=10, mi=1)
        for k in range(4):
            px = x + (k - 1.5) * 0.44
            tube(bm, (px, -0.17, 10.26), (px, 0.17, 10.26), 0.20, 0.20, seg=12, mi=3)
        box(bm, (x, 0, 10.40), (2.1, 0.11, 0.15), mi=1)
        box(bm, (x, 0, 10.05), (0.34, 0.34, 0.30), mi=2)   # yellow marker block
    for k in range(11):
        z = 1.3 + k * 0.9
        if z > 10.0:
            break
        tube(bm, (0.42, -0.24, z), (0.42, 0.24, z), 0.035, 0.035, seg=6, mi=1)
    tube(bm, (0.42, -0.24, 1.3), (0.42, -0.24, 10.0), 0.028, 0.028, seg=6, mi=1)
    tube(bm, (0.42, 0.24, 1.3), (0.42, 0.24, 10.0), 0.028, 0.028, seg=6, mi=1)


made.append(build("lift_pylon", [GALV, STEEL, PAINT_Y, RUBBER, CONCRETE], lift_pylon))


def drag_pylon(bm):
    tube(bm, (0, 0, 0.05), (0, 0, 0.6), 0.42, 0.34, seg=12, mi=4)
    tube(bm, (0, 0, 0.35), (0, 0, 5.6), 0.20, 0.14, seg=12, mi=0)
    tube(bm, (-0.7, 0, 5.35), (0.7, 0, 5.35), 0.08, 0.08, seg=8, mi=1)
    for sx in (-1, 1):
        tube(bm, (sx * 0.55, -0.14, 5.2), (sx * 0.55, 0.14, 5.2), 0.16, 0.16, seg=10, mi=3)


made.append(build("drag_pylon", [GALV, STEEL, PAINT_Y, RUBBER, CONCRETE], drag_pylon))

# ---------------------------------------------------------------- chair


def chair5(bm):
    """Five across. The passengers face -Y in Blender, which the game turns to
    face the direction of travel."""
    W = 3.1
    tube(bm, (0, 0, 3.58), (0, 0, 2.10), 0.078, 0.078, seg=10, mi=0)
    box(bm, (0, 0, 3.62), (0.30, 0.44, 0.34), mi=3)          # grip housing
    tube(bm, (0, -0.30, 3.60), (0, 0.30, 3.60), 0.115, 0.115, seg=12, mi=3)
    tube(bm, (0, 0, 2.10), (-W / 2 + 0.14, 0, 1.64), 0.062, 0.062, seg=8, mi=0)
    tube(bm, (0, 0, 2.10), (W / 2 - 0.14, 0, 1.64), 0.062, 0.062, seg=8, mi=0)
    tube(bm, (-W / 2, 0, 1.64), (W / 2, 0, 1.64), 0.072, 0.072, seg=8, mi=0)
    # seat pan (front is -Y) and backrest (+Y)
    box(bm, (0, -0.17, 1.04), (W, 0.62, 0.10), mi=1)
    box(bm, (0, 0.24, 1.44), (W, 0.10, 0.76), mi=1)
    box(bm, (0, 0.24, 1.84), (W, 0.13, 0.06), mi=0)          # headrail
    for k in range(6):
        x = -W / 2 + k * (W / 5)
        box(bm, (x, -0.05, 1.22), (0.038, 0.82, 0.46), mi=0)
    for side in (-1, 1):
        x = side * (W / 2)
        tube(bm, (x, 0.28, 1.64), (x, -0.42, 1.32), 0.046, 0.046, seg=8, mi=0)
        tube(bm, (x, -0.42, 1.32), (x, -0.47, 1.00), 0.046, 0.046, seg=8, mi=0)
    # safety bar down, with the ski rest
    tube(bm, (-W / 2 + 0.05, 0.30, 1.62), (-W / 2 + 0.05, -0.58, 1.26), 0.046, 0.046, seg=8, mi=4)
    tube(bm, (W / 2 - 0.05, 0.30, 1.62), (W / 2 - 0.05, -0.58, 1.26), 0.046, 0.046, seg=8, mi=4)
    tube(bm, (-W / 2 + 0.05, -0.58, 1.26), (W / 2 - 0.05, -0.58, 1.26), 0.042, 0.042, seg=8, mi=4)
    box(bm, (0, -0.62, 1.06), (W - 0.18, 0.24, 0.05), mi=4)
    for k in range(5):
        x = -W / 2 + (k + 0.5) * (W / 5)
        box(bm, (x, -0.62, 1.10), (0.30, 0.20, 0.03), mi=2)  # rubber ski pads


made.append(build("chair_five", [STEEL, PAINT_B, RUBBER, GALV, PAINT_Y], chair5))


def tbar(bm):
    tube(bm, (0, 0, 3.50), (0, 0, 1.05), 0.032, 0.032, seg=8, mi=0)
    tube(bm, (0, 0, 3.58), (0, 0, 3.36), 0.10, 0.10, seg=10, mi=1)
    tube(bm, (-0.44, 0, 1.02), (0.44, 0, 1.02), 0.056, 0.056, seg=10, mi=1)
    tube(bm, (0, 0, 1.14), (0, 0, 0.98), 0.05, 0.05, seg=8, mi=2)
    for sx in (-1, 1):
        tube(bm, (sx * 0.44, 0, 1.02), (sx * 0.30, 0, 0.86), 0.030, 0.024, seg=8, mi=1)


made.append(build("tbar", [STEEL, RUBBER, PAINT_Y], tbar))

# ---------------------------------------------------------------- station


def station(bm):
    """A terminal you can ski into.

    Rendered on its own (tools/render_models.py) the previous version read as a
    pile of loose parts: a canopy floating on nothing, a machine house too small
    to see, and a corral straggling off into space. The fix is not more detail —
    it is closing the thing up. Columns run to the deck, the house is clad, and
    the corral is short and attached.
    """
    L, W = 15.0, 8.0

    # deck, barely above the snow so skis slide straight on
    box(bm, (0, 0, 0.09), (W, L, 0.18), mi=4)
    box(bm, (0, 0, 0.20), (W - 0.5, L - 0.5, 0.06), mi=5)
    for k in range(6):
        t = k / 5
        box(bm, (0, -L / 2 - 1.6 + t * 1.6, 0.03 + t * 0.15), (W - 0.6, 0.34, 0.06), mi=5)

    # Four columns, full height, standing ON the deck — the canopy used to hang in
    # the air above legs that stopped short.
    for sx in (-1, 1):
        for sy in (-1, 1):
            tube(bm, (sx * (W / 2 - 0.7), sy * (L / 2 - 1.2), 0.18),
                 (sx * (W / 2 - 0.7), sy * (L / 2 - 1.2), CABLE_H + 1.7), 0.22, 0.18, seg=10, mi=1)
            # knee braces, so the frame reads as a frame
            tube(bm, (sx * (W / 2 - 0.7), sy * (L / 2 - 1.2), CABLE_H + 0.1),
                 (sx * (W / 2 - 1.9), sy * (L / 2 - 1.2), CABLE_H + 1.6), 0.10, 0.10, seg=8, mi=1)
    for sx in (-1, 1):
        box(bm, (sx * (W / 2 - 0.7), 0, CABLE_H + 1.62), (0.26, L - 2.0, 0.28), mi=1)
    box(bm, (0, L / 2 - 1.2, CABLE_H + 1.62), (W - 1.0, 0.26, 0.28), mi=1)
    box(bm, (0, -L / 2 + 1.2, CABLE_H + 1.62), (W - 1.0, 0.26, 0.28), mi=1)

    # the bullwheel: HORIZONTAL, at cable height, at the far end
    cy = L / 2 - 2.6
    disc(bm, (0, cy, CABLE_H), 2.45, 0.30, mi=3, seg=36)
    disc(bm, (0, cy, CABLE_H), 2.60, 0.10, mi=1, seg=36)
    tube(bm, (0, cy, CABLE_H - 1.6), (0, cy, CABLE_H + 1.5), 0.24, 0.24, seg=14, mi=1)
    for k in range(8):
        a = k * math.tau / 8
        tube(bm, (0, cy, CABLE_H), (math.cos(a) * 2.2, cy + math.sin(a) * 2.2, CABLE_H),
             0.075, 0.075, seg=6, mi=1)

    # Machine house: clad on all four sides and big enough to see, sitting over the
    # wheel where the drive actually lives.
    box(bm, (0, cy, CABLE_H + 2.15), (5.6, 5.0, 1.5), mi=0)
    box(bm, (0, cy, CABLE_H + 2.98), (6.1, 5.5, 0.24), mi=6)
    box(bm, (0, cy, CABLE_H + 3.14), (6.2, 5.6, 0.16), mi=7)
    for sx in (-1, 1):
        box(bm, (sx * 1.6, cy - 2.55, CABLE_H + 2.2), (1.6, 0.10, 0.7), mi=9)  # louvres

    # canopy over the loading point, carried by the same frame
    box(bm, (0, -L / 2 + 3.4, CABLE_H + 1.9), (W + 1.4, 7.2, 0.22), mi=6)
    box(bm, (0, -L / 2 + 3.4, CABLE_H + 2.07), (W + 1.5, 7.3, 0.14), mi=7)

    # operator hut, against the deck rather than beside it
    box(bm, (W / 2 - 0.9, -L / 2 + 2.4, 1.35), (2.2, 2.4, 2.3), mi=8)
    box(bm, (W / 2 - 0.9, -L / 2 + 1.25, 1.75), (1.7, 0.12, 1.1), mi=9)
    box(bm, (W / 2 - 0.9, -L / 2 + 2.4, 2.60), (2.5, 2.7, 0.18), mi=6)

    # A short, attached corral. The old one ran eleven metres off the back of the
    # deck and read as debris.
    for sx in (-1, 1):
        for k in range(3):
            y = -L / 2 - 0.6 - k * 1.9
            x = sx * (2.2 + k * 0.5)
            tube(bm, (x, y, 0.0), (x, y, 1.05), 0.05, 0.045, seg=8, mi=2)
            px = sx * (2.2 + (k - 1) * 0.5)
            py = -L / 2 - 0.6 - (k - 1) * 1.9
            if k:
                tube(bm, (px, py, 0.95), (x, y, 0.95), 0.03, 0.03, seg=6, mi=2)
            else:
                tube(bm, (sx * 2.2, -L / 2 + 0.3, 0.95), (x, y, 0.95), 0.03, 0.03, seg=6, mi=2)

    # the gate line the game boards you at
    box(bm, (0, -L / 2 + 0.4, 1.0), (W - 1.0, 0.14, 0.12), mi=2)
    for k in range(4):
        box(bm, (-2.7 + k * 1.8, -L / 2 + 0.4, 0.5), (0.10, 0.10, 1.0), mi=2)
    box(bm, (0, -L / 2 + 1.0, CABLE_H + 1.6), (1.4, 0.32, 0.20), mi=10)


made.append(build("lift_station",
                  [PAINT_W, STEEL, PAINT_Y, GALV, CONCRETE, WOODL, PAINT_K, SNOW, WOOD, GLASSY, LAMP],
                  station))

# ---------------------------------------------------------------- piste furniture


def slalom_pole(ci):
    def fn(bm):
        tube(bm, (0, 0, 0), (0.07, 0, 1.80), 0.030, 0.023, seg=8, mi=ci)
        tube(bm, (0, 0, 0.0), (0, 0, 0.13), 0.11, 0.11, seg=10, mi=3)
        for k in range(3):
            tube(bm, (0.02 * k, 0, 0.36 + k * 0.46), (0.024 * k, 0, 0.52 + k * 0.46), 0.032, 0.032, seg=8, mi=2)
    return fn


made.append(build("gate_pole_blue", [PAINT_B, PAINT_R, PAINT_W, RUBBER], slalom_pole(0)))
made.append(build("gate_pole_red", [PAINT_B, PAINT_R, PAINT_W, RUBBER], slalom_pole(1)))


def park_rail(bm):
    tube(bm, (0, -6.0, 0.75), (0, 6.0, 0.75), 0.055, 0.055, seg=14, mi=0)
    for k in range(5):
        y = -6.0 + k * 3.0
        tube(bm, (0, y, 0), (0, y, 0.75), 0.05, 0.05, seg=8, mi=1)
        tube(bm, (-0.48, y, 0.02), (0.48, y, 0.02), 0.05, 0.05, seg=8, mi=2)
        tube(bm, (0, y, 0.36), (0.34, y, 0.10), 0.03, 0.03, seg=6, mi=1)


made.append(build("park_rail", [CHROME, STEEL, PAINT_K], park_rail))


def park_box(bm):
    box(bm, (0, 0, 0.275), (1.7, 9.0, 0.55), mi=2)
    box(bm, (0, 0, 0.57), (1.75, 9.05, 0.05), mi=1)
    for sx in (-1, 1):
        box(bm, (sx * 0.85, 0, 0.275), (0.05, 9.0, 0.55), mi=0)
    for k in range(6):
        box(bm, (0, -3.75 + k * 1.5, 0.10), (1.75, 0.10, 0.20), mi=3)


made.append(build("park_box", [PAINT_W, CHROME, WOOD, PAINT_K], park_box))


def marker(bm):
    tube(bm, (0, 0, 0), (0, 0, 2.7), 0.048, 0.042, seg=10, mi=0)
    for k in range(3):
        z = 1.55 + k * 0.37
        tube(bm, (0, 0, z), (0, 0, z + 0.17), 0.050, 0.050, seg=10, mi=1)
    tube(bm, (0, 0, 2.68), (0, 0, 2.74), 0.052, 0.030, seg=10, mi=1)


made.append(build("piste_marker", [FABRIC, PAINT_K, RUBBER], marker))


def safety_net(bm):
    L, Hh = 10.0, 2.2
    for k in range(4):
        y = -L / 2 + k * (L / 3)
        tube(bm, (0, y, 0), (0, y, Hh), 0.055, 0.045, seg=8, mi=0)
        tube(bm, (0, y, Hh * 0.62), (0.55, y, 0.05), 0.030, 0.030, seg=6, mi=0)
    for k in range(6):
        z = 0.28 + k * (Hh - 0.4) / 5
        tube(bm, (0, -L / 2, z), (0, L / 2, z), 0.016, 0.016, seg=6, mi=1)
    steps = int(L / 0.55)
    for k in range(steps + 1):
        y = -L / 2 + k * (L / steps)
        tube(bm, (0, y, 0.24), (0, y, Hh - 0.1), 0.011, 0.011, seg=4, mi=1)


made.append(build("safety_net", [PAINT_K, FABRIC, RUBBER], safety_net))


def signpost(bm):
    tube(bm, (0, 0, 0), (0, 0, 2.95), 0.078, 0.070, seg=10, mi=0)
    tube(bm, (0, 0, 0), (0, 0, 0.24), 0.15, 0.15, seg=12, mi=4)
    for k, mi in enumerate((1, 2, 3)):
        z = 2.46 - k * 0.44
        box(bm, (0.58, 0, z), (1.20, 0.035, 0.36), mi=4)
        box(bm, (0.58, 0, z), (1.14, 0.055, 0.31), mi=mi)
        box(bm, (1.16, 0, z), (0.06, 0.06, 0.31), mi=4)
    box(bm, (0, 0, 2.90), (0.22, 0.22, 0.10), mi=4)


made.append(build("signpost", [WOOD, PAINT_B, PAINT_R, PAINT_K, GALV], signpost))

# ---------------------------------------------------------------- resort props


def bench(bm):
    for sx in (-1, 1):
        box(bm, (sx * 0.85, 0, 0.22), (0.10, 0.44, 0.44), mi=1)
        box(bm, (sx * 0.85, -0.18, 0.66), (0.10, 0.10, 0.46), mi=1)
    for k in range(4):
        box(bm, (0, -0.16 + k * 0.13, 0.46), (2.0, 0.11, 0.05), mi=0)
    for k in range(3):
        box(bm, (0, -0.22, 0.62 + k * 0.14), (2.0, 0.05, 0.11), mi=0)
    box(bm, (0, 0, 0.90), (2.0, 0.34, 0.06), mi=2)   # snow on the seat back


made.append(build("prop_bench", [WOODL, STEEL, SNOW], bench))


def piste_map(bm):
    for sx in (-1, 1):
        tube(bm, (sx * 1.1, 0, 0), (sx * 1.1, 0, 2.0), 0.075, 0.070, seg=10, mi=0)
    box(bm, (0, 0, 1.75), (2.6, 0.10, 1.35), mi=0)
    box(bm, (0, -0.06, 1.75), (2.4, 0.03, 1.2), mi=1)
    # the three runs drawn on the board
    for k, mi in enumerate((2, 3, 4)):
        box(bm, (-0.7 + k * 0.7, -0.09, 1.75), (0.10, 0.02, 1.0), mi=mi)
    box(bm, (0, 0, 2.52), (2.9, 0.5, 0.10), mi=5)
    box(bm, (0, 0, 2.60), (2.95, 0.55, 0.08), mi=6)


made.append(build("prop_pistemap", [WOOD, PAINT_W, PAINT_B, PAINT_R, PAINT_K, WOODL, SNOW], piste_map))


def fence(bm):
    for k in range(5):
        x = -4.0 + k * 2.0
        tube(bm, (x, 0, 0), (x, 0, 1.25), 0.065, 0.055, seg=8, mi=0)
    for k in range(2):
        box(bm, (0, 0, 0.55 + k * 0.45), (8.0, 0.06, 0.14), mi=0)
    box(bm, (0, 0, 1.05), (8.0, 0.14, 0.06), mi=1)


made.append(build("prop_fence", [WOODL, SNOW], fence))


def snow_cannon(bm):
    tube(bm, (0, 0, 0), (0, 0, 0.28), 0.55, 0.52, seg=14, mi=2)
    tube(bm, (0, 0, 0.2), (0, 0, 1.5), 0.16, 0.14, seg=12, mi=0)
    rot = Matrix.Rotation(math.radians(-28), 4, 'X')
    box(bm, (0, 0.15, 1.85), (0.72, 1.5, 0.72), mi=1, rot=rot)
    tube(bm, (0, 0.55, 2.05), (0, 0.95, 2.28), 0.34, 0.30, seg=16, mi=0)
    tube(bm, (0, 0.95, 2.28), (0, 1.02, 2.32), 0.36, 0.38, seg=16, mi=3)
    box(bm, (0, -0.55, 1.65), (0.5, 0.42, 0.5), mi=0)
    for sx in (-1, 1):
        tube(bm, (sx * 0.45, -0.1, 0.25), (sx * 0.45, -0.1, 0.05), 0.09, 0.11, seg=8, mi=0)


made.append(build("prop_cannon", [GALV, PAINT_Y, CONCRETE, RUBBER], snow_cannon))


def ticket_hut(bm):
    box(bm, (0, 0, 0.12), (3.4, 2.6, 0.24), mi=3)
    box(bm, (0, 0, 1.4), (3.0, 2.2, 2.3), mi=0)
    box(bm, (0, -1.12, 1.6), (1.8, 0.10, 0.9), mi=2)     # serving window
    box(bm, (0, -1.20, 1.10), (2.0, 0.28, 0.09), mi=1)   # counter shelf
    box(bm, (0, 0, 2.66), (3.9, 3.1, 0.16), mi=1)
    box(bm, (0, 0, 2.80), (3.95, 3.15, 0.12), mi=4)
    box(bm, (0, -1.9, 2.35), (3.4, 1.2, 0.10), mi=1)     # awning
    box(bm, (0, 0, 3.05), (0.5, 0.5, 0.4), mi=5)         # sign block


made.append(build("prop_ticket", [WOOD, WOODL, GLASSY, CONCRETE, SNOW, PAINT_R], ticket_hut))


def flag(bm):
    tube(bm, (0, 0, 0), (0, 0, 4.2), 0.055, 0.040, seg=10, mi=0)
    tube(bm, (0, 0, 0), (0, 0, 0.2), 0.16, 0.16, seg=10, mi=0)
    for k in range(9):
        t = k / 8
        wave = math.sin(t * 3.4) * 0.16 * t
        box(bm, (0.12 + t * 1.15, wave, 3.66 + math.sin(t * 2.2) * 0.05),
            (0.16, 0.03, 0.78 - t * 0.06), mi=1 + (k % 2))


made.append(build("prop_flag", [GALV, PAINT_R, PAINT_W], flag))


def crates(bm):
    box(bm, (0, 0, 0.30), (1.2, 0.9, 0.60), mi=0)
    box(bm, (0, 0, 0.62), (1.25, 0.95, 0.05), mi=1)
    box(bm, (0.25, 0.15, 0.92), (0.8, 0.7, 0.55), mi=0)
    box(bm, (0.25, 0.15, 1.21), (0.85, 0.75, 0.04), mi=2)
    for k in range(3):
        box(bm, (-0.75, -0.2 + k * 0.18, 0.75 + k * 0.02), (0.10, 0.10, 1.5), mi=3)   # spare poles


made.append(build("prop_crates", [WOODL, WOOD, SNOW, GALV], crates))


def bin_(bm):
    tube(bm, (0, 0, 0.05), (0, 0, 0.95), 0.32, 0.36, seg=14, mi=0)
    tube(bm, (0, 0, 0.95), (0, 0, 1.02), 0.40, 0.36, seg=14, mi=1)
    tube(bm, (0, 0, 0.0), (0, 0, 0.06), 0.36, 0.34, seg=14, mi=1)


made.append(build("prop_bin", [GALV, PAINT_K], bin_))

_x = 0
for _ob in made:
    _ob.location = (_x, 0, 0)
    _x += max(_ob.dimensions.x, 3.0) * 1.15 + 3

bpy.ops.object.select_all(action='DESELECT')
for _o in made:
    _o.select_set(True)
bpy.context.view_layer.objects.active = made[0]
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "lifts.glb"),
                          export_format='GLB', use_selection=True,
                          export_apply=True, export_yup=True)
print("EXPORTED lifts.glb %d B  %d faces" % (
    os.path.getsize(os.path.join(OUT, "lifts.glb")),
    sum(len(o.data.polygons) for o in made)))
for _o in made:
    print("  %-18s %5.1f x %5.1f x %5.1f m  %4d faces" % (_o.name, *_o.dimensions, len(_o.data.polygons)))
