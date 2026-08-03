# Builds the SKI Together character and gear, and exports assets/models/character.glb
#
# Run it from Blender (the MCP bridge does `exec(open(this).read())`). Every part's
# origin sits on its own joint, because the game drives the whole body from code —
# poses, stride and ragdoll — with no animation clips anywhere.

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


# Material names are the contract with the game: Jacket / Trousers / Helmet /
# GearPaint / GearTrim / Scarf are repainted at the colour booth. The rest are fixed.
JACKET   = mat("Jacket",      (0.62, 0.10, 0.09), 0.70)
PANEL    = mat("JacketDark",  (0.13, 0.15, 0.19), 0.64)
TROUSER  = mat("Trousers",    (0.055, 0.070, 0.095), 0.76)
SKIN     = mat("Skin",        (0.62, 0.44, 0.35), 0.62)
HELMET   = mat("Helmet",      (0.070, 0.085, 0.105), 0.30)
GOGGLE   = mat("Goggles",     (0.030, 0.055, 0.090), 0.08, 0.55)
GOGSTRAP = mat("GoggleStrap", (0.10, 0.11, 0.13), 0.82)
GLOVE    = mat("Gloves",      (0.075, 0.085, 0.100), 0.78)
BOOTSH   = mat("BootShell",   (0.085, 0.095, 0.115), 0.36)
BOOTCUF  = mat("BootCuff",    (0.16, 0.18, 0.22), 0.44)
BUCKLE   = mat("Buckle",      (0.74, 0.76, 0.80), 0.22, 1.0)
SCARF    = mat("Scarf",       (0.85, 0.70, 0.18), 0.84)
ZIP      = mat("Zip",         (0.55, 0.57, 0.60), 0.35, 0.9)
GEARA    = mat("GearPaint",   (0.90, 0.92, 0.95), 0.28)
GEARB    = mat("GearTrim",    (0.18, 0.44, 0.85), 0.32)
EDGE     = mat("SteelEdge",   (0.70, 0.72, 0.76), 0.20, 1.0)
BASE     = mat("SkiBase",     (0.045, 0.048, 0.055), 0.26)

MATS = [JACKET, TROUSER, SKIN, HELMET, GOGGLE, GLOVE, BOOTSH, BUCKLE, SCARF,
        PANEL, GOGSTRAP, BOOTCUF, ZIP]
J, T, S, H, GG, GL, BS, BU, SC, PN, GS, BC, ZP = range(13)


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


def ball(bm, centre, r, mi=0, scale=(1, 1, 1), subd=2):
    before = set(bm.faces)
    ret = bmesh.ops.create_icosphere(bm, subdivisions=subd, radius=r)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(centre)) @ Matrix.Diagonal(Vector(scale).to_4d()),
                        verts=ret['verts'])
    tag(bm, before, mi)


def ring(bm, centre, radius, depth, mi=0, seg=28, axis='X'):
    before = set(bm.faces)
    ret = bmesh.ops.create_cone(bm, cap_ends=False, cap_tris=False, segments=seg,
                                radius1=radius, radius2=radius, depth=depth)
    rot = Matrix.Rotation(math.pi / 2, 4, axis)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(centre)) @ rot, verts=ret['verts'])
    tag(bm, before, mi)


def part(name, build, smooth=True):
    ob = obj(name, MATS)
    bm = bmesh.new()
    build(bm)
    bm.normal_update()
    bm.to_mesh(ob.data)
    bm.free()
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob


made = []

# ---------------------------------------------------------------- torso


def torso(bm):
    """A real ski jacket: shaped chest and waist, raised collar over a neck
    gaiter, contrast shoulder yokes, a zip, a hem band and a lift-pass pocket."""
    ball(bm, (0, 0, 0.32), 0.205, mi=J, scale=(1.34, 0.88, 1.42), subd=3)
    ball(bm, (0, 0, 0.12), 0.185, mi=J, scale=(1.24, 0.92, 1.10), subd=3)
    ball(bm, (0, 0, 0.00), 0.175, mi=J, scale=(1.22, 0.94, 0.72), subd=3)
    for sx in (-1, 1):
        ball(bm, (sx * 0.175, 0, 0.395), 0.105, mi=PN, scale=(1.05, 1.15, 0.82), subd=2)
    ball(bm, (0, -0.03, 0.435), 0.135, mi=PN, scale=(1.42, 1.02, 0.44), subd=2)
    tube(bm, (0, 0, 0.435), (0, 0, 0.545), 0.088, 0.082, seg=16, mi=SC)
    tube(bm, (0, 0, 0.430), (0, 0, 0.470), 0.103, 0.101, seg=16, mi=PN)
    box(bm, (0, 0.170, 0.24), (0.020, 0.030, 0.40), mi=ZP)
    tube(bm, (0, 0, -0.058), (0, 0, -0.012), 0.197, 0.199, seg=18, mi=PN)
    box(bm, (0.100, 0.163, 0.31), (0.100, 0.020, 0.085), mi=PN)
    box(bm, (0.100, 0.177, 0.293), (0.055, 0.008, 0.038), mi=SC)
    for sx in (-1, 1):
        box(bm, (sx * 0.224, 0, 0.20), (0.028, 0.155, 0.28), mi=PN)


made.append(part("ch_torso", torso))

# ---------------------------------------------------------------- head


def head(bm):
    ball(bm, (0, 0, 0.095), 0.098, mi=S, scale=(0.95, 1.02, 1.10), subd=3)
    ball(bm, (0, -0.005, 0.128), 0.122, mi=H, scale=(1.00, 1.06, 0.94), subd=3)
    box(bm, (0, 0.098, 0.132), (0.185, 0.075, 0.030), mi=H,
        rot=Matrix.Rotation(math.radians(-8), 4, 'X'))
    ball(bm, (0, -0.075, 0.098), 0.085, mi=H, scale=(1.18, 0.72, 0.86), subd=2)
    for sx in (-1, 1):
        ball(bm, (sx * 0.107, -0.005, 0.088), 0.045, mi=GS, scale=(0.55, 1.05, 1.15), subd=2)
    # goggles: a strap right round the helmet, a frame, and a tinted lens
    ring(bm, (0, -0.005, 0.118), 0.125, 0.048, mi=GS, seg=28, axis='X')
    box(bm, (0, 0.080, 0.118), (0.200, 0.062, 0.082), mi=GS)
    box(bm, (0, 0.104, 0.118), (0.178, 0.030, 0.062), mi=GG)
    for sx in (-1, 1):
        tube(bm, (sx * 0.098, 0.010, 0.062), (sx * 0.030, 0.028, 0.005), 0.008, 0.008, seg=6, mi=GS)


made.append(part("ch_head", head))

# ---------------------------------------------------------------- limbs


def upper_arm(bm):
    tube(bm, (0, 0, 0.02), (0, 0, -0.28), 0.070, 0.056, seg=14, mi=J)
    ball(bm, (0, 0, 0.01), 0.074, mi=PN, scale=(1.0, 1.0, 0.85), subd=2)
    box(bm, (0, 0, -0.16), (0.145, 0.145, 0.030), mi=PN)


made.append(part("ch_upperarm", upper_arm))


def forearm(bm):
    tube(bm, (0, 0, 0.0), (0, 0, -0.245), 0.056, 0.046, seg=14, mi=J)
    ball(bm, (0, 0, 0), 0.058, mi=J, subd=2)
    tube(bm, (0, 0, -0.243), (0, 0, -0.277), 0.052, 0.050, seg=12, mi=PN)
    ball(bm, (0, 0.008, -0.315), 0.056, mi=GL, scale=(0.95, 1.15, 1.05), subd=2)
    ball(bm, (0, -0.030, -0.300), 0.030, mi=GL, scale=(0.80, 0.90, 1.00), subd=1)


made.append(part("ch_forearm", forearm))


def thigh(bm):
    tube(bm, (0, 0, 0.02), (0, 0, -0.44), 0.098, 0.076, seg=14, mi=T)
    ball(bm, (0, 0, 0.015), 0.100, mi=T, scale=(1.0, 1.0, 0.85), subd=2)
    box(bm, (0.088, 0, -0.20), (0.020, 0.115, 0.30), mi=PN)


made.append(part("ch_thigh", thigh))


def shin(bm):
    tube(bm, (0, 0, 0.0), (0, 0, -0.40), 0.078, 0.062, seg=14, mi=T)
    ball(bm, (0, 0, 0), 0.080, mi=T, subd=2)
    box(bm, (0.070, 0, -0.18), (0.018, 0.095, 0.26), mi=PN)
    tube(bm, (0, 0, -0.398), (0, 0, -0.438), 0.070, 0.075, seg=12, mi=PN)


made.append(part("ch_shin", shin))

# ---------------------------------------------------------------- boots


def ski_boot(bm):
    box(bm, (0, 0.030, -0.058), (0.118, 0.315, 0.105), mi=BS)
    box(bm, (0, 0.115, -0.088), (0.108, 0.155, 0.048), mi=BS)
    box(bm, (0, -0.115, -0.086), (0.108, 0.095, 0.050), mi=BS)
    ball(bm, (0, -0.015, 0.045), 0.088, mi=BS, scale=(1.12, 1.02, 1.22), subd=2)
    box(bm, (0, -0.050, 0.125), (0.150, 0.170, 0.150), mi=BC,
        rot=Matrix.Rotation(math.radians(-14), 4, 'X'))
    for k in range(4):
        z = -0.005 + k * 0.058
        box(bm, (0, 0.030, z), (0.160, 0.060, 0.014), mi=BU)
        box(bm, (0.082, 0.030, z), (0.030, 0.036, 0.026), mi=BU)
    box(bm, (0, -0.055, 0.200), (0.145, 0.055, 0.020), mi=SC)


made.append(part("ch_bootski", ski_boot, smooth=False))


def board_boot(bm):
    box(bm, (0, 0.025, -0.055), (0.120, 0.300, 0.100), mi=BS)
    ball(bm, (0, 0.0, 0.060), 0.092, mi=T, scale=(1.05, 1.02, 1.40), subd=2)
    box(bm, (0, -0.010, 0.145), (0.130, 0.140, 0.090), mi=BC)
    for k in range(3):
        box(bm, (0, 0.062, 0.010 + k * 0.052), (0.118, 0.100, 0.012), mi=BU)
    box(bm, (0, 0.088, 0.075), (0.030, 0.030, 0.120), mi=GS)


made.append(part("ch_bootboard", board_boot, smooth=False))

# ---------------------------------------------------------------- gear


def ski(name, length=1.72, waist=0.082):
    ob = obj(name, [GEARA, GEARB, EDGE, BASE, BUCKLE, TROUSER])
    bm = bmesh.new()
    n = 30
    rows = []
    for k in range(n + 1):
        t = k / n
        y = -length * 0.42 + t * length
        u = (t - 0.5) * 2.0
        w = waist * (1.0 + 0.42 * u * u) * (1.0 - 0.55 * max(0.0, abs(u) - 0.93) / 0.07)
        rocker = 0.0
        if t > 0.86:
            rocker = ((t - 0.86) / 0.14) ** 2 * 0.085
        if t < 0.07:
            rocker = ((0.07 - t) / 0.07) ** 2 * 0.030
        rows.append([bm.verts.new((-w, y, rocker)), bm.verts.new((w, y, rocker)),
                     bm.verts.new((w, y, rocker + 0.016)), bm.verts.new((-w, y, rocker + 0.016))])
    for k in range(n):
        a, b = rows[k], rows[k + 1]
        for i in range(4):
            bm.faces.new((a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i]))
    bm.faces.new(tuple(rows[0]))
    bm.faces.new(tuple(reversed(rows[-1])))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < -0.6:
            f.material_index = 3
        elif abs(f.normal.x) > 0.6:
            f.material_index = 2
        else:
            f.material_index = 0
    box(bm, (0, 0.05, 0.0175), (waist * 0.55, length * 0.70, 0.004), mi=1)
    box(bm, (0, 0.02, 0.030), (waist * 2.1, 0.30, 0.034), mi=1)
    box(bm, (0, -0.13, 0.042), (waist * 1.9, 0.10, 0.05), mi=4)
    box(bm, (0, 0.15, 0.040), (waist * 1.9, 0.09, 0.045), mi=4)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


made.append(ski("gear_ski"))


def board(name, length=1.56, waist=0.128):
    ob = obj(name, [GEARA, GEARB, EDGE, BASE, BUCKLE, TROUSER])
    bm = bmesh.new()
    n = 30
    rows = []
    for k in range(n + 1):
        t = k / n
        y = -length / 2 + t * length
        u = (t - 0.5) * 2.0
        w = waist * (1.0 + 0.30 * u * u)
        w *= 1.0 - 0.80 * max(0.0, abs(u) - 0.90) / 0.10
        rocker = (abs(u) ** 3) * 0.075
        rows.append([bm.verts.new((-w, y, rocker)), bm.verts.new((w, y, rocker)),
                     bm.verts.new((w, y, rocker + 0.013)), bm.verts.new((-w, y, rocker + 0.013))])
    for k in range(n):
        a, b = rows[k], rows[k + 1]
        for i in range(4):
            bm.faces.new((a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i]))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < -0.6:
            f.material_index = 3
        elif abs(f.normal.x) > 0.6:
            f.material_index = 2
        else:
            f.material_index = 0
    box(bm, (0, 0, 0.0145), (waist * 0.8, length * 0.66, 0.004), mi=1)
    for k, y in enumerate((-0.24, 0.24)):
        rot = Matrix.Rotation(math.radians(15 if k else -12), 4, 'Z')
        box(bm, (0, y, 0.028), (0.30, 0.13, 0.03), mi=1, rot=rot)
        box(bm, (0, y - 0.06, 0.075), (0.26, 0.05, 0.12), mi=5, rot=rot)
        box(bm, (0, y + 0.02, 0.062), (0.28, 0.05, 0.018), mi=4, rot=rot)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


made.append(board("gear_board"))


def pole(name):
    ob = obj(name, [BUCKLE, GLOVE, BOOTSH, SCARF])
    bm = bmesh.new()
    tube(bm, (0, 0, 1.20), (0, 0, 0.0), 0.008, 0.006, seg=8, mi=0)
    tube(bm, (0, 0, 1.27), (0, 0, 1.08), 0.018, 0.017, seg=10, mi=1)
    tube(bm, (0, 0, 1.285), (0, 0, 1.245), 0.020, 0.014, seg=10, mi=3)
    tube(bm, (0, 0, 0.160), (0, 0, 0.135), 0.050, 0.050, seg=14, mi=2)
    tube(bm, (0, 0, 0.030), (0, 0, 0.0), 0.007, 0.004, seg=8, mi=2)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


made.append(pole("gear_pole"))


def helmet_var(name, style):
    ob = obj(name, [HELMET, GOGGLE, BUCKLE, GOGSTRAP])
    bm = bmesh.new()
    ball(bm, (0, 0, 0), 0.122, mi=0, scale=(1.0, 1.06, 0.94), subd=3)
    box(bm, (0, 0.098, 0.005), (0.185, 0.075, 0.030), mi=0,
        rot=Matrix.Rotation(math.radians(-8), 4, 'X'))
    if style == 'vent':
        for k in range(3):
            box(bm, (0, -0.03 + k * 0.055, 0.108), (0.095, 0.024, 0.022), mi=1)
    if style == 'lined':
        for sx in (-1, 1):
            ball(bm, (sx * 0.108, -0.005, -0.038), 0.048, mi=3, scale=(0.55, 1.05, 1.12), subd=2)
    bm.normal_update()
    bm.to_mesh(ob.data)
    bm.free()
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


made.append(helmet_var("gear_helmet_rental", 'plain'))
made.append(helmet_var("gear_helmet_vent", 'vent'))
made.append(helmet_var("gear_helmet_lined", 'lined'))

# The game's forward is +Z. Blender exports +Y as -Z, and every part above was
# modelled with its front towards +Y — which put the zip, the pocket, the boot
# toes and the ski tips all facing backwards, and seated the rider in the chair
# back to front. One half turn about Z fixes the lot, at the source.
for _ob in made:
    _me = _ob.data
    _bm = bmesh.new()
    _bm.from_mesh(_me)
    bmesh.ops.rotate(_bm, verts=_bm.verts, cent=(0, 0, 0),
                     matrix=Matrix.Rotation(math.pi, 3, 'Z'))
    _bm.to_mesh(_me)
    _bm.free()

_x = 0
for _ob in made:
    _ob.location = (_x, 0, 0)
    _x += max(_ob.dimensions.x, 0.5) * 1.2 + 0.55

bpy.ops.object.select_all(action='DESELECT')
for _o in made:
    _o.select_set(True)
bpy.context.view_layer.objects.active = made[0]
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "character.glb"),
                          export_format='GLB', use_selection=True,
                          export_apply=True, export_yup=True)
print("EXPORTED character.glb  %d B  %d faces" % (
    os.path.getsize(os.path.join(OUT, "character.glb")),
    sum(len(o.data.polygons) for o in made)))
for _o in made:
    print("  %-20s %5.2f x %5.2f x %5.2f m  %4d faces" % (_o.name, *_o.dimensions, len(_o.data.polygons)))
