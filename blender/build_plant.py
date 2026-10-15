# Builds the plant model the website shows: web/public/models/plant.glb.
#
#   blender --background --factory-startup --python blender/build_plant.py
#
# The layout matches web/src/sim/site.ts and the scene's live overlays (status bands, beacons, plumes,
# ACC fans, data center lights, battery racks, power flow), so everything here is static geometry.
# Coordinates below are in the website's frame (metres, y up, -z north) and are converted to Blender's
# z-up frame on the way in. Textures are generated here, so the build needs no downloaded assets.
#
# Styled after a West Texas combined-cycle plant built for a co-located AI data center, like the one
# Chevron is developing in the Permian Basin with GE Vernova 7HA-class turbines. It is not a replica:
# the real site's drawings are not public.

import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "public", "models", "plant.glb")
TEX_DIR = os.path.join(bpy.app.tempdir or os.path.join(ROOT, ".blender-tmp"), "pg360-textures")
os.makedirs(TEX_DIR, exist_ok=True)
os.makedirs(os.path.dirname(OUT), exist_ok=True)

rng = np.random.default_rng(7)
random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)

# Website frame (x, y up, z south) -> Blender frame (x, y north, z up).
TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
UNIT_X = lambda i: -84 + i * 24
PAD = dict(x0=-190, x1=190, z0=-118, z1=96)
BUS_Z = -86
SWITCHYARD = (152, -45)

# ---------------------------------------------------------------- textures

def vnoise(size, cells):
    g = rng.random((cells, cells))
    x = np.arange(size) * cells / size
    i0 = np.floor(x).astype(int)
    f = x - i0
    i1 = (i0 + 1) % cells
    f = f * f * (3 - 2 * f)
    a, b = g[np.ix_(i0, i0)], g[np.ix_(i0, i1)]
    c, d = g[np.ix_(i1, i0)], g[np.ix_(i1, i1)]
    top = a + (b - a) * f[None, :]
    bot = c + (d - c) * f[None, :]
    return top + (bot - top) * f[:, None]


def fbm(size, base=4, octaves=5, gain=0.5):
    out = np.zeros((size, size))
    amp, tot, cells = 1.0, 0.0, base
    for _ in range(octaves):
        if cells > size:
            break
        out += vnoise(size, cells) * amp
        tot += amp
        amp *= gain
        cells *= 2
    return out / tot


def hexc(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def lerpc(t, c0, c1):
    t = np.clip(t, 0, 1)[..., None]
    return hexc(c0)[None, None, :] * (1 - t) + hexc(c1)[None, None, :] * t


def save_img(name, rgb, data=False):
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    px = np.ones((h, w, 4), dtype=np.float32)
    px[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = os.path.join(TEX_DIR, name + ".png")
    img.file_format = "PNG"
    img.save()
    if data:
        img.colorspace_settings.name = "Non-Color"
    return img


def stretch(n):
    # Contrast stretch so every noise texture uses its full range.
    return (n - n.min()) / max(1e-6, n.max() - n.min())


def height_normal(h, strength):
    # Tangent-space normal map from a tiling height field.
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    ln = np.sqrt(dx * dx + dy * dy + 1)
    return np.stack([0.5 - 0.5 * dx / ln, 0.5 - 0.5 * dy / ln, 0.5 + 0.5 / ln], -1)


def streaks(s, cols=48, strength=1.0):
    # Rain streaks: runs of grime down a wall, varying across u and fading in and out along v.
    across = stretch(vnoise(s, cols))[0]
    across = np.clip((across - 0.55) / 0.45, 0, 1) ** 1.5
    along = 0.55 + 0.45 * stretch(fbm(s, 2, 4))
    return np.clip(across[None, :] * along * strength, 0, 1)


def caliche_tex():
    # Permian caliche and sand: pale tan, low contrast so the repeat doesn't show from the air,
    # with small pebbles and a gentle bump for grazing light.
    s = 1024
    n = stretch(fbm(s, 2, 8, gain=0.6))
    g = rng.random((s, s))
    rgb = lerpc(0.3 + 0.45 * n, "a98a63", "d6bf9a")
    rgb *= (0.93 + 0.07 * g)[..., None]
    pebble = g > 0.985
    rgb[pebble] *= 0.78
    color = save_img("caliche", rgb)
    # The bump only needs to be coarse: it is tiled and seen from a distance, and noisy normal maps compress badly.
    h = stretch(fbm(512, 8, 4))
    return color, save_img("caliche_n", height_normal(h, 3.0), data=True)


def speckle_tex(name, c0, c1, size=512, dark=0.75, bump=0.0):
    n = stretch(fbm(size, 4, 6))
    g = rng.random((size, size))
    rgb = lerpc(0.6 * n + 0.4 * g, c0, c1)
    rgb *= np.where(g > 0.94, dark, 1.0)[..., None]
    color = save_img(name, rgb)
    if not bump:
        return color, None
    return color, save_img(name + "_n", height_normal((0.5 * n + 0.5 * g)[::2, ::2], bump), data=True)


def concrete_tex():
    # Poured slabs: mottled grey, oil and water stains, saw-cut joints.
    s = 512
    n = stretch(fbm(s, 2, 7))
    rgb = lerpc(n, "a6a39c", "cfccc5")
    stain = np.clip((stretch(fbm(s, 3, 5)) - 0.62) / 0.38, 0, 1)
    rgb *= (1 - 0.22 * stain)[..., None]
    rgb *= (0.95 + 0.05 * rng.random((s, s)))[..., None]
    joint = (np.arange(s) % (s // 2)) < 2
    rgb[joint, :] *= 0.8
    rgb[:, joint] *= 0.8
    return save_img("concrete", rgb)


def metal_tex(name, base, grime=0.1, rust=0.0):
    # Painted or galvanised steel: low-frequency blotches, a little streaking, optional rust spots.
    s = 256
    n = stretch(fbm(s, 3, 5))
    shade = (1 - grime) + grime * n
    shade *= 1 - 0.5 * grime * streaks(s, 24)
    rgb = hexc(base)[None, None, :] * shade[..., None]
    if rust:
        spot = np.clip((stretch(fbm(s, 8, 4)) - (1 - rust)) / rust, 0, 1)[..., None]
        rgb = rgb * (1 - spot) + hexc("7a4a2c")[None, None, :] * spot
    return save_img(name, rgb)


def ribbed_tex(name, base, period=32, depth=0.07, seams=0, grime=0.12):
    # Corrugated cladding: ribs across u, rain streaks and patchy weathering, optional horizontal panel seams.
    s = 512
    x = np.arange(s)
    rib = 0.5 + 0.5 * np.cos(2 * np.pi * x / period)
    dirt = stretch(vnoise(s, 8)) * 0.5 + stretch(vnoise(s, 32)) * 0.5
    shade = (1 - depth) + depth * rib[None, :]
    shade = shade * (0.93 + 0.07 * dirt)
    shade = shade * (1 - grime * streaks(s))
    if seams:
        y = np.arange(s)
        shade = shade * np.where((y % (s // seams)) < 3, 0.82, 1.0)[:, None]
    rgb = hexc(base)[None, None, :] * shade[..., None]
    color = save_img(name, rgb)
    slope = -np.sin(2 * np.pi * x / period) * (2 * np.pi / period) * 6
    nx = np.broadcast_to(slope[None, :], (s, s))
    nz = np.ones((s, s))
    ln = np.sqrt(nx * nx + nz * nz)
    nrm = np.stack([0.5 + 0.5 * nx / ln, np.full((s, s), 0.5), 0.5 + 0.5 * nz / ln], -1)
    normal = save_img(name + "_n", nrm, data=True)
    return color, normal


def fin_tex():
    # Finned tube bundle seen from outside: dense dark fins with brighter tube lines.
    s = 256
    x = np.arange(s)
    fin = np.where(x % 8 < 2, 0.62, 1.0)
    y = np.arange(s)
    tube = np.where(y % 32 < 3, 1.25, 1.0)
    rgb = hexc("5f6662")[None, None, :] * (fin[None, :] * tube[:, None])[..., None]
    return save_img("fins", rgb)


def panel_tex():
    # Insulated metal panels on the data center: wide flat panels with fine joints.
    s = 512
    shade = np.ones((s, s))
    shade[:, (np.arange(s) % 128) < 2] = 0.84
    shade[(np.arange(s) % 64) < 2, :] = 0.9
    shade *= 0.97 + 0.03 * stretch(vnoise(s, 16))
    rgb = hexc("e8eaeb")[None, None, :] * shade[..., None]
    return save_img("dc_panel", rgb)


# ---------------------------------------------------------------- materials

def lin(c):
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in hexc(c)]


MAT, TILE = {}, {}


def material(name, color="#ffffff", rough=0.7, metal=0.0, tex=None, normal=None, strength=0.6, tile=4.0):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*lin(color), 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if tex is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = tex
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    if normal is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = normal
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = strength
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    MAT[name] = m
    TILE[name] = tile
    return m


clad_c, clad_n = ribbed_tex("clad", "e4e5e4")
hrsg_c, hrsg_n = ribbed_tex("clad_hrsg", "b9bfc3", period=24, grime=0.18)
encl_c, encl_n = ribbed_tex("enclosure", "dcdedc", period=64, depth=0.04, seams=4)
beige_c, beige_n = ribbed_tex("clad_beige", "d4cbb8", period=40, depth=0.05, grime=0.15)
cal_c, cal_n = caliche_tex()
grav_c, grav_n = speckle_tex("gravel", "9d978c", "c8c1b5", bump=3.0)
asph_c, _ = speckle_tex("asphalt", "4a4c4e", "646567", dark=0.6)
track_c, _ = speckle_tex("track", "c2a983", "dcc9a6", dark=0.85)
material("caliche", tex=cal_c, normal=cal_n, strength=0.5, rough=0.97, tile=110)
material("track", tex=track_c, rough=0.97, tile=14)
material("gravel", tex=grav_c, normal=grav_n, strength=0.6, rough=0.95, tile=7)
material("asphalt", tex=asph_c, rough=0.9, tile=9)
material("concrete", tex=concrete_tex(), rough=0.85, tile=6)
material("clad", tex=clad_c, normal=clad_n, rough=0.5, metal=0.15, tile=8)
material("clad_hrsg", tex=hrsg_c, normal=hrsg_n, rough=0.55, metal=0.15, tile=6)
material("enclosure", tex=encl_c, normal=encl_n, strength=0.3, rough=0.5, metal=0.1, tile=8)
material("clad_beige", tex=beige_c, normal=beige_n, rough=0.6, tile=8)
material("dc_panel", tex=panel_tex(), rough=0.45, metal=0.1, tile=12)
material("fins", tex=fin_tex(), rough=0.75, metal=0.35, tile=3)
material("steel", tex=metal_tex("steel", "8b9196", grime=0.14), rough=0.5, metal=0.55, tile=5)
material("steel_dark", tex=metal_tex("steel_dark", "4b5156", grime=0.18, rust=0.12), rough=0.6, metal=0.35, tile=5)
material("galv", tex=metal_tex("galv", "a7acb0", grime=0.16), rough=0.42, metal=0.75, tile=4)
material("stack", tex=metal_tex("stack", "8e959b", grime=0.22), rough=0.5, metal=0.5, tile=9)
material("lamp", "#fff4d8", rough=0.3)
material("hydrant", "#b3261e", rough=0.45)
material("truck_white", "#eceae4", rough=0.35, metal=0.35)
material("gas_yellow", "#d6a21e", rough=0.45, metal=0.1)
material("safety", "#e3b21b", rough=0.5)
material("pipe_white", "#d6d9db", rough=0.32, metal=0.6)
material("xfmr", "#6c757b", rough=0.55, metal=0.3)
material("porcelain", "#6a4433", rough=0.25)
material("glass", "#26323c", rough=0.08, metal=0.5)
material("black", "#242628", rough=0.6)
material("tank", "#e6e5de", rough=0.5, metal=0.15)
material("paint_white", "#efeee8", rough=0.6)
material("paint_yellow", "#d9b23a", rough=0.6)
material("shrub", "#5d6038", rough=1.0)
material("shrub_dry", "#7d7350", rough=1.0)
material("caliche_pad", "#d3c19f", rough=1.0)
material("pumpjack", "#3d4b53", rough=0.55, metal=0.3)
material("horsehead", "#9b2b1f", rough=0.5, metal=0.2)
for name, col in [("car_white", "#e9e9e6"), ("car_silver", "#a9adb1"), ("car_black", "#222426"), ("car_red", "#7d1f1c"), ("car_blue", "#3b4f66")]:
    material(name, col, rough=0.3, metal=0.5)
CARS = ["car_white", "car_white", "car_silver", "car_black", "car_red", "car_blue", "car_silver"]

# ---------------------------------------------------------------- geometry
# Every primitive is built in the website's frame, then appended to one vertex/face list per
# (group, material). Each group becomes one node in the glTF; the website maps node names to assets.

GEO = {}
XF = [Matrix.Identity(4)]


def emit(bm, group, mat, M=Matrix.Identity(4)):
    bmesh.ops.transform(bm, matrix=TO_BLENDER @ XF[-1] @ M, verts=bm.verts)
    d = GEO.setdefault((group, mat), {"v": [], "f": [], "s": []})
    base = len(d["v"])
    bm.verts.index_update()
    d["v"].extend(tuple(v.co) for v in bm.verts)
    for f in bm.faces:
        d["f"].append(tuple(base + v.index for v in f.verts))
        d["s"].append(f.smooth)
    bm.free()


def box(group, mat, p, s, rot=(0, 0, 0), bevel=0.05):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(s), verts=bm.verts)
    b = min(bevel, 0.4 * min(s))
    if b > 0.004:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=b, offset_type="OFFSET", profile_type="SUPERELLIPSE",
                        segments=1, profile=0.5, affect="EDGES", clamp_overlap=True)
    emit(bm, group, mat, Matrix.Translation(Vector(p)) @ Euler(rot, "XYZ").to_matrix().to_4x4())


def cyl(group, mat, a, b, r, r2=None, seg=16, caps=True):
    a, b = Vector(a), Vector(b)
    axis = b - a
    length = axis.length
    if length < 1e-4:
        return
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r,
                          radius2=r if r2 is None else r2, depth=length)
    cap_edges = set()
    for f in bm.faces:
        if len(f.verts) == 4 and seg >= 8:
            f.smooth = True
        elif len(f.verts) != 4:
            cap_edges.update(f.edges)
    if cap_edges:
        bmesh.ops.split_edges(bm, edges=list(cap_edges))
    rot = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix().to_4x4()
    emit(bm, group, mat, Matrix.Translation((a + b) / 2) @ rot)


def ball(group, mat, p, r, seg=14, squash=1.0):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(4, seg // 2), radius=r)
    for f in bm.faces:
        f.smooth = True
    emit(bm, group, mat, Matrix.Translation(Vector(p)) @ Matrix.Diagonal((1, squash, 1, 1)))


def rock(group, mat, p, r, squash=0.55):
    # Low irregular blob for desert scrub (subdivisions=1 is the bare 20-face icosahedron).
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
    for v in bm.verts:
        v.co *= 0.75 + 0.5 * random.random()
    for f in bm.faces:
        f.smooth = True
    emit(bm, group, mat, Matrix.Translation(Vector(p)) @ Matrix.Diagonal((1, squash, 1, 1)))


def loft(group, mat, z0, c0, wh0, z1, c1, wh1):
    # A duct that changes section along z: rectangle wh0 centred on c0 (x, y) at z0 to wh1 at z1.
    bm = bmesh.new()
    rings = []
    for z, (cx, cy), (w, h) in ((z0, c0, wh0), (z1, c1, wh1)):
        rings.append([bm.verts.new((cx + sx * w / 2, cy + sy * h / 2, z)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    a, b = rings
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    emit(bm, group, mat)


def quad(group, mat, x0, z0, x1, z1, y):
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in ((x0, y, z1), (x1, y, z1), (x1, y, z0), (x0, y, z0))]
    bm.faces.new(vs)
    emit(bm, group, mat)


def pipe(group, mat, pts, r, seg=14):
    for a, b in zip(pts, pts[1:]):
        cyl(group, mat, a, b, r, seg=seg)
    for p in pts[1:-1]:
        ball(group, mat, p, r * 1.04, seg=seg)


def rail_loop(group, pts, y, h=1.1, post=2.0, mat="safety"):
    # Handrail: top and mid rail with posts, along a closed or open polyline at deck height y.
    for a, b in zip(pts, pts[1:]):
        a3, b3 = Vector((a[0], y, a[1])), Vector((b[0], y, b[1]))
        cyl(group, mat, a3 + Vector((0, h, 0)), b3 + Vector((0, h, 0)), 0.035, seg=5)
        cyl(group, mat, a3 + Vector((0, h / 2, 0)), b3 + Vector((0, h / 2, 0)), 0.03, seg=5)
        n = max(1, int((b3 - a3).length / post))
        for k in range(n + 1):
            q = a3.lerp(b3, k / n)
            cyl(group, mat, q, q + Vector((0, h, 0)), 0.03, seg=5, caps=False)


def ring_rail(group, cx, cz, r, y, n=18):
    pts = [(cx + r * math.cos(2 * math.pi * k / n), cz + r * math.sin(2 * math.pi * k / n)) for k in range(n + 1)]
    rail_loop(group, pts, y, post=1.0)


def stair_tower(group, x, z, top, w=3.2, d=4.2, step=4.0):
    for dx in (-w / 2, w / 2):
        for dz in (-d / 2, d / 2):
            box(group, "galv", (x + dx, top / 2, z + dz), (0.22, top, 0.22), bevel=0.02)
    y, flip = step, 1
    while y <= top + 0.01:
        box(group, "galv", (x, y, z), (w, 0.12, d), bevel=0.02)
        side = x - flip * (w / 2 - 0.4)
        cyl(group, "galv", (side, y - step, z - flip * (d / 2 - 0.3)), (side, y, z + flip * (d / 2 - 0.3)), 0.08, seg=5)
        y += step
        flip = -flip
    rail_loop(group, [(x - w / 2, z - d / 2), (x + w / 2, z - d / 2), (x + w / 2, z + d / 2), (x - w / 2, z + d / 2), (x - w / 2, z - d / 2)], top)


# ---------------------------------------------------------------- terrain

FLAT_RECTS = [
    (PAD["x0"] - 60, PAD["z0"] - 60, PAD["x1"] + 60, PAD["z1"] + 60),
    (-1400, 40, PAD["x0"], 80),                  # access road from the west
    (PAD["x1"], -70, 1400, -20),                 # transmission line corridor east
]
WELLS = [(-430, 280, 0.6), (390, 310, 2.2), (-560, -330, 1.1), (470, -300, 4.0), (-260, 460, 2.8), (640, 120, 0.3)]
FLAT_CIRCLES = [(x, z, 40) for x, z, _ in WELLS]
_PHASES = rng.random((6, 2)) * 2 * np.pi


def terrain_h(x, z):
    x, z = np.asarray(x, float), np.asarray(z, float)
    h = np.zeros_like(x)
    for k, (fx, fz, amp) in enumerate([(1 / 310, 1 / 270, 2.2), (1 / 170, 1 / 210, 1.3), (1 / 90, 1 / 120, 0.6),
                                        (1 / 520, 1 / 610, 3.0), (1 / 55, 1 / 70, 0.25), (1 / 37, 1 / 41, 0.15)]):
        h += amp * np.sin(x * fx * 2 * np.pi + _PHASES[k, 0]) * np.cos(z * fz * 2 * np.pi + _PHASES[k, 1])
    dist = np.full_like(x, 1e9)
    for x0, z0, x1, z1 in FLAT_RECTS:
        dx = np.maximum(np.maximum(x0 - x, 0), x - x1)
        dz = np.maximum(np.maximum(z0 - z, 0), z - z1)
        dist = np.minimum(dist, np.hypot(dx, dz))
    for cx, cz, r in FLAT_CIRCLES:
        dist = np.minimum(dist, np.maximum(np.hypot(x - cx, z - cz) - r, 0))
    t = np.clip(dist / 120, 0, 1)
    return h * t * t * (3 - 2 * t)


def terrain():
    size, n = 2800, 140
    xs = np.linspace(-size / 2, size / 2, n + 1)
    X, Z = np.meshgrid(xs, xs)
    H = terrain_h(X, Z) - 0.03
    bm = bmesh.new()
    vs = [[bm.verts.new((X[j, i], H[j, i], Z[j, i])) for i in range(n + 1)] for j in range(n + 1)]
    for j in range(n):
        for i in range(n):
            f = bm.faces.new((vs[j + 1][i], vs[j + 1][i + 1], vs[j][i + 1], vs[j][i]))
            f.smooth = True
    emit(bm, "desert", "caliche")


def on_track(x, z, margin=4.0):
    for path in TRACKS:
        for (ax, az), (bx, bz) in zip(path, path[1:]):
            d = Vector((bx - ax, bz - az))
            t = max(0.0, min(1.0, Vector((x - ax, z - az)).dot(d) / max(d.length_squared, 1e-6)))
            if math.hypot(x - (ax + d.x * t), z - (az + d.y * t)) < margin:
                return True
    return False


def scrub():
    # Mesquite and creosote scattered outside the fence, denser near the plant where the camera looks.
    # A bush is one or two 20-triangle lobes, so it reads as a clump rather than a ball.
    placed = 0
    while placed < 1300:
        spread = 1300 if random.random() < 0.55 else 520
        x, z = random.uniform(-spread, spread), random.uniform(-spread, spread)
        if PAD["x0"] - 30 < x < PAD["x1"] + 30 and PAD["z0"] - 30 < z < PAD["z1"] + 30:
            continue
        if 50 < z < 70 and x < PAD["x0"]:
            continue
        if on_track(x, z):
            continue
        r = random.uniform(0.45, 1.6)
        mat = random.choice(["shrub", "shrub", "shrub_dry"])
        for k in range(random.choice((1, 1, 2))):
            ox, oz = (random.uniform(-0.7, 0.7) * r * k for _ in range(2))
            rr = r * random.uniform(0.6, 1.0)
            y = float(terrain_h(x + ox, z + oz)) + rr * 0.22
            rock("desert", mat, (x + ox, y, z + oz), rr, squash=random.uniform(0.45, 0.7))
        placed += 1


# Lease roads: graded caliche tracks from the county road and the power line corridor out to the well pads.
TRACKS = [
    [(-430, 64), (-436, 150), (-428, 230), (-430, 262)],
    [(-260, 64), (-268, 200), (-255, 330), (-260, 442)],
    [(-560, 56), (-552, -120), (-566, -250), (-560, -312)],
    [(202, -52), (420, -52), (700, -50), (1380, -52)],
    [(470, -60), (476, -180), (468, -282)],
    [(390, -40), (384, 90), (396, 220), (390, 292)],
    [(640, -40), (646, 40), (640, 102)],
]


def tracks():
    for path in TRACKS:
        pts = []
        for (ax, az), (bx, bz) in zip(path, path[1:]):
            n = max(1, int(math.hypot(bx - ax, bz - az) / 8))
            pts += [(ax + (bx - ax) * k / n, az + (bz - az) * k / n) for k in range(n)]
        pts.append(path[-1])
        bm = bmesh.new()
        prev = None
        for k, (x, z) in enumerate(pts):
            a, b = pts[max(0, k - 1)], pts[min(len(pts) - 1, k + 1)]
            d = Vector((b[0] - a[0], b[1] - a[1])).normalized()
            w = 2.6 + 0.4 * math.sin(k * 0.7)
            ring = []
            for s in (-1, 1):
                px, pz = x - d.y * w * s, z + d.x * w * s
                ring.append(bm.verts.new((px, float(terrain_h(px, pz)) + 0.12, pz)))
            if prev:
                bm.faces.new((prev[0], ring[0], ring[1], prev[1]))
            prev = ring
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for f in bm.faces:
            if f.normal.y < 0:
                f.normal_flip()
        emit(bm, "desert", "track")


def pumpjack(x, z, ry):
    y0 = float(terrain_h(x, z))
    g = "desert"
    box(g, "caliche_pad", (x, y0 + 0.04, z), (34, 0.08, 30), bevel=0)
    XF.append(Matrix.Translation((x, y0, z)) @ Matrix.Rotation(ry, 4, "Y"))
    box(g, "concrete", (0, 0.2, 0), (2.6, 0.4, 10))
    box(g, "pumpjack", (0, 0.55, 0), (2.0, 0.3, 9.4))
    for sx in (-0.95, 0.95):
        cyl(g, "pumpjack", (sx, 0.6, 0.7), (0, 5.4, 0), 0.12, seg=6)
    cyl(g, "pumpjack", (0, 0.6, -1.9), (0, 5.4, 0), 0.12, seg=6)
    box(g, "pumpjack", (0, 5.85, 0.4), (0.45, 0.6, 8.4), rot=(0.06, 0, 0))
    box(g, "horsehead", (0, 5.3, 4.65), (0.55, 2.4, 0.9), rot=(-0.12, 0, 0))
    box(g, "pumpjack", (0, 1.4, -3.2), (1.3, 1.5, 1.6))
    for sx in (-0.95, 0.95):
        cyl(g, "pumpjack", (sx, 1.7, -3.5), (sx * 1.25, 1.7, -3.5), 1.15, seg=18)
        cyl(g, "pumpjack", (sx * 1.05, 1.9, -3.7), (sx * 0.3, 5.6, -3.8), 0.07, seg=5)
    box(g, "steel_dark", (0, 1.0, -4.8), (1.0, 1.0, 1.2))
    cyl(g, "galv", (0, 4.2, 5.1), (0, 0.6, 5.1), 0.03, seg=5)
    cyl(g, "steel", (0, 0.4, 5.1), (0, 1.2, 5.1), 0.18, seg=10)
    XF.pop()
    for k in range(2):
        tx = x + 9 + k * 4
        cyl(g, "tank", (tx, y0, z - 9), (tx, y0 + 5.5, z - 9), 1.6, seg=20)


# ---------------------------------------------------------------- site

def site():
    g = "site"
    x0, x1, z0, z1 = PAD["x0"], PAD["x1"], PAD["z0"], PAD["z1"]
    quad(g, "asphalt", x0 - 11, z0 - 11, x1 + 11, z1 + 11, 0.05)
    quad(g, "gravel", x0, z0, x1, z1, 0.1)
    quad(g, "asphalt", x0, 34, x1, 42, 0.14)                 # service road between units and data center
    # The county road lives with the desert so the site's own bounds stay small for Draco's quantization.
    quad("desert", "asphalt", -1400, 56, x0 - 11, 64, 0.06)
    quad(g, "asphalt", x0 - 11, 56, -135, 64, 0.14)
    quad(g, "asphalt", -126, 42, -114, 56, 0.14)
    for x in range(-1390, int(x0) - 15, 12):
        quad("desert", "paint_yellow", x, 59.85, x + 5, 60.15, 0.08)
    quad(g, "asphalt", -142, 84, -98, 95, 0.14)               # parking at the control building
    for x in range(-140, -99, 3):
        quad(g, "paint_white", x - 0.06, 84.5, x + 0.06, 89.5, 0.16)
    for k in range(9):
        x = -138 + k * 4.4 + random.uniform(-0.2, 0.2)
        if random.random() < 0.25:
            continue
        c = random.choice(CARS)
        box(g, c, (x, 0.85, 87), (1.85, 0.9, 4.5), bevel=0.25)
        box(g, c, (x, 1.6, 87.3), (1.6, 0.7, 2.4), bevel=0.2)
        box(g, "glass", (x, 1.6, 86.05), (1.5, 0.55, 0.05), bevel=0)
    # perimeter fence, gate where the road comes in
    fx0, fx1, fz0, fz1 = x0 - 12, x1 + 12, z0 - 12, z1 + 12
    runs = [((fx0, fz0), (fx1, fz0)), ((fx1, fz0), (fx1, fz1)), ((fx1, fz1), (fx0, fz1)), ((fx0, fz1), (fx0, 66)), ((fx0, 54), (fx0, fz0))]
    for (ax, az), (bx, bz) in runs:
        a, b = Vector((ax, 0, az)), Vector((bx, 0, bz))
        n = max(1, int((b - a).length / 6))
        for k in range(n + 1):
            q = a.lerp(b, k / n)
            cyl(g, "galv", q, q + Vector((0, 2.4, 0)), 0.05, seg=6)
        for y in (0.3, 1.2, 2.3):
            cyl(g, "galv", a + Vector((0, y, 0)), b + Vector((0, y, 0)), 0.025, seg=4, caps=False)
    for z in (54, 66):
        cyl(g, "safety", (fx0, 0, z), (fx0, 1.2, z), 0.12, seg=8)
    # area lighting masts around the pad
    for mx, mz in ((x0 + 4, z0 + 4), (x1 - 4, z0 + 4), (x0 + 4, z1 - 4), (x1 - 4, z1 - 4), (-30, z0 + 4), (60, z0 + 4),
                   (-180, 30), (180, 30), (-90, 44), (10, 44), (110, 44), (176, -90)):
        cyl(g, "concrete", (mx, 0, mz), (mx, 0.6, mz), 0.6, seg=12)
        cyl(g, "galv", (mx, 0.6, mz), (mx, 22, mz), 0.28, r2=0.14, seg=10)
        box(g, "galv", (mx, 21.6, mz), (3.2, 0.18, 0.18), bevel=0)
        for dx in (-1.3, 1.3):
            box(g, "steel_dark", (mx + dx, 21.3, mz), (0.7, 0.3, 0.5), bevel=0.04)
            box(g, "lamp", (mx + dx, 21.14, mz), (0.6, 0.04, 0.4), bevel=0)
    # fire hydrants along the service road
    for hx in range(-170, 181, 40):
        cyl(g, "hydrant", (hx, 0.14, 33.2), (hx, 0.95, 33.2), 0.16, seg=10)
        ball(g, "hydrant", (hx, 0.95, 33.2), 0.17, seg=8)
        cyl(g, "hydrant", (hx - 0.28, 0.65, 33.2), (hx + 0.28, 0.65, 33.2), 0.07, seg=6)
    # site work trucks: crew pickups and a service truck by the units
    for tx, tz, ry, kind in ((-70, 38, 0.0, "pickup"), (-38, 39, 0.0, "pickup"), (25, 37.5, math.pi, "service"),
                             (64, 38.5, 0.0, "pickup"), (-122, 46, math.pi / 2, "pickup"), (186, 0, math.pi / 2, "service")):
        work_truck(g, tx, tz, ry, kind)


def work_truck(g, x, z, ry, kind):
    # Built along +x, then turned; a white crew pickup or a utility-bed service truck.
    XF.append(Matrix.Translation((x, 0.14, z)) @ Matrix.Rotation(ry, 4, "Y"))
    length = 5.8 if kind == "pickup" else 7.2
    box(g, "truck_white", (0, 0.95, 0), (length, 0.75, 2.0), bevel=0.2)
    box(g, "truck_white", (length / 2 - 2.1, 1.75, 0), (2.4, 0.9, 1.9), bevel=0.2)
    box(g, "glass", (length / 2 - 0.88, 1.8, 0), (0.05, 0.62, 1.7), bevel=0)
    for s in (-1, 1):
        box(g, "glass", (length / 2 - 2.1, 1.85, s * 0.96), (1.9, 0.5, 0.04), bevel=0)
    if kind == "service":
        box(g, "truck_white", (-1.1, 1.55, 0), (3.6, 1.1, 2.2), bevel=0.06)
        box(g, "steel_dark", (-1.1, 2.15, 0), (3.6, 0.08, 2.2), bevel=0)
    for wx in (length / 2 - 1.1, -length / 2 + 1.2):
        for s in (-1, 1):
            cyl(g, "black", (wx, 0.42, s * 0.9), (wx, 0.42, s * 1.12), 0.42, seg=12)
    XF.pop()


# ---------------------------------------------------------------- generating units

def gas_turbine_unit(i):
    X = UNIT_X(i)
    g = f"GT-{i + 1:02d}"
    box(g, "concrete", (X + 1, 0.15, -45), (18, 0.3, 66))
    # generator and its terminal enclosure
    box(g, "steel_dark", (X, 0.6, -71.5), (7, 0.6, 10))
    box(g, "enclosure", (X, 3.0, -71.5), (6.4, 4.8, 9.0), bevel=0.15)
    box(g, "enclosure", (X, 5.8, -71.5), (5.2, 0.8, 7.6), bevel=0.15)
    box(g, "steel_dark", (X + 3.7, 2.2, -70.5), (1.0, 3.0, 3.0))
    box(g, "steel_dark", (X + 5.4, 3.4, -72.5), (2.4, 0.9, 0.9))
    # accessory and load compartment under the inlet
    box(g, "enclosure", (X, 2.6, -61.5), (5.0, 4.6, 11), bevel=0.1)
    # inlet filter house on legs, weather hoods facing north
    for dx in (-4.4, 4.4):
        for dz in (-63.4, -56.6):
            box(g, "steel", (X + dx, 4.25, dz), (0.45, 8.5, 0.45), bevel=0.02)
        cyl(g, "steel", (X + dx, 0.3, -63.4), (X + dx, 8.4, -56.6), 0.08, seg=5)
    box(g, "clad", (X, 13, -60), (10, 9, 8), bevel=0.1)
    box(g, "black", (X, 13, -64.03), (9.4, 8.4, 0.1), bevel=0)
    for r in range(5):
        box(g, "steel", (X, 9.5 + r * 1.68, -64.55), (9.6, 0.1, 1.15), rot=(0.75, 0, 0), bevel=0)
    rail_loop(g, [(X - 5, -64), (X + 5, -64), (X + 5, -56), (X - 5, -56), (X - 5, -64)], 17.5)
    box(g, "clad", (X, 6.0, -55.6), (4.2, 5.0, 3.2))
    # gas turbine acoustic enclosure (status band sits on its roof in the website)
    box(g, "enclosure", (X, 4, -48), (8, 8, 14), bevel=0.12)
    for side in (-1, 1):
        for dz in (-51, -44.5):
            box(g, "steel_dark", (X + side * 4.02, 1.3, dz), (0.06, 2.3, 1.1), bevel=0)
        box(g, "steel", (X + side * 4.25, 6.0, -48), (0.5, 1.2, 6), bevel=0.04)
    for dx, dz in ((-2, -52.5), (2, -43.5)):
        cyl(g, "steel", (X + dx, 8.0, dz), (X + dx, 9.0, dz), 0.85, seg=18)
        cyl(g, "black", (X + dx, 9.0, dz), (X + dx, 9.05, dz), 0.7, seg=18)
    # exhaust diffuser widening into the HRSG
    loft(g, "clad_hrsg", -41, (X, 4.4), (6.4, 5.8), -35, (X, 9.5), (10.6, 17))
    # heat recovery steam generator with buckstays, roof drums and a stair tower
    box(g, "clad_hrsg", (X, 10, -23), (11, 20, 24), bevel=0.08)
    for k in range(11):
        z = -34.6 + k * 2.32
        for side in (-1, 1):
            box(g, "steel_dark", (X + side * 5.62, 10, z), (0.28, 20, 0.34), bevel=0.02)
    for y in (5, 10, 15):
        for side in (-1, 1):
            box(g, "steel_dark", (X + side * 5.66, y, -23), (0.24, 0.34, 24), bevel=0.02)
    box(g, "steel_dark", (X, 20.3, -23), (11.4, 0.6, 24.4))
    for z, r in ((-29.5, 0.95), (-22.5, 0.8), (-15.5, 1.2)):
        for sx in (-3, 3):
            box(g, "steel", (X + sx, 21.0, z), (0.4, 1.0, r * 1.5))
        cyl(g, "pipe_white", (X - 4.4, 21.7 + r * 0.3, z), (X + 4.4, 21.7 + r * 0.3, z), r, seg=20)
        for sx in (-4.4, 4.4):
            ball(g, "pipe_white", (X + sx, 21.7 + r * 0.3, z), r, seg=16)
        cyl(g, "pipe_white", (X + 1.5, 20.6, z + r + 0.4), (X + 1.5, 22.4 + r * 0.3, z + r + 0.4), 0.22, seg=8)
    rail_loop(g, [(X - 5.6, -35), (X + 5.6, -35), (X + 5.6, -11), (X - 5.6, -11), (X - 5.6, -35)], 20.6)
    stair_tower(g, X + 7.4, -29, 20.0)
    # breeching duct and stack with its emissions monitoring platform
    box(g, "clad_hrsg", (X, 13, -10.8), (5.2, 9, 2.4))
    cyl(g, "concrete", (X, 0, -9), (X, 0.6, -9), 3.3, seg=28)
    cyl(g, "stack", (X, 0.6, -9), (X, 35.4, -9), 2.5, r2=2.25, seg=32)
    cyl(g, "steel_dark", (X, 35.4, -9), (X, 36.2, -9), 2.33, seg=32)
    for y in (12, 24):
        cyl(g, "galv", (X, y, -9), (X, y + 0.22, -9), 3.5 - y * 0.008, seg=28)
        ring_rail(g, X, -9, 3.45 - y * 0.008, y + 0.22)
    for dz in (-0.3, 0.3):
        cyl(g, "galv", (X + 2.8, 0.6, -9 + dz), (X + 2.55, 35, -9 + dz), 0.035, seg=5)
    # generator step-up transformer behind a firewall
    TX, TZ = X + 8, -74
    box(g, "concrete", (TX, 0.25, TZ), (6, 0.5, 6.4))
    box(g, "xfmr", (TX, 2.6, TZ), (4, 3.8, 3.2), bevel=0.06)
    for k in range(7):
        for side in (-1, 1):
            box(g, "xfmr", (TX - 1.8 + k * 0.6, 2.7, TZ + side * 2.25), (0.1, 3.2, 1.2), bevel=0)
    cyl(g, "xfmr", (TX - 1.6, 5.4, TZ + 1.0), (TX + 1.6, 5.4, TZ + 1.0), 0.45, seg=14)
    for dx in (-1.2, 0, 1.2):
        cyl(g, "porcelain", (TX + dx, 4.5, TZ - 0.6), (TX + dx, 6.8, TZ - 0.6), 0.17, r2=0.1, seg=10)
        cyl(g, "galv", (TX + dx, 6.8, TZ - 0.6), (TX + dx, 7.1, TZ - 0.6), 0.12, seg=8)
    if i < 7:
        box(g, "concrete", (X + 12, 4, -73), (0.5, 8, 9.5), bevel=0.04)
    # fuel gas branch off the header
    pipe(g, "gas_yellow", [(X + 4.6, 1, -38), (X + 4.6, 2.6, -38), (X + 4.6, 2.6, -42), (X + 4.05, 2.6, -42)], 0.18, seg=10)
    box(g, "steel", (X + 4.6, 2.6, -39.6), (0.6, 0.6, 0.5))
    # main steam over to the pipe rack
    pipe(g, "pipe_white", [(X + 3.2, 20.6, -13), (X + 3.2, 23.2, -13), (X + 3.2, 23.2, 2), (X + 3.2, 10.0, 2)], 0.42, seg=14)


def pipe_rack():
    g = "site"
    for x in range(-128, 97, 12):
        for z in (0.2, 3.8):
            box(g, "steel", (x, 4.8, z), (0.4, 9.6, 0.4), bevel=0.02)
        for y in (6.6, 9.4):
            box(g, "steel", (x, y, 2), (0.35, 0.4, 4.4), bevel=0.02)
    for y in (6.6, 9.4):
        for z in (0.2, 3.8):
            box(g, "steel", (-16, y + 0.28, z), (224, 0.16, 0.25), bevel=0)
    for z, r, m in ((1.0, 0.55, "pipe_white"), (2.2, 0.38, "pipe_white"), (3.2, 0.3, "steel")):
        cyl(g, m, (-120, 10.0, z), (96, 10.0, z), r, seg=14)
    for z, r in ((1.2, 0.25), (2.6, 0.2)):
        cyl(g, "steel", (-120, 7.1, z), (96, 7.1, z), r, seg=10)
    pipe(g, "pipe_white", [(-120, 10.0, 1.0), (-122, 10.0, 1.0), (-122, 10.0, -24)], 0.55)


# ---------------------------------------------------------------- steam cycle

def steam_hall():
    g = "steamhall"
    box(g, "concrete", (-126, 0.2, -44), (24, 0.4, 42))
    box(g, "clad", (-126, 11, -44), (22, 22, 40), bevel=0.15)
    box(g, "steel_dark", (-126, 22.4, -44), (22.4, 0.8, 40.4))
    box(g, "steel_dark", (-126, 23.4, -44), (3, 1.2, 36))
    for x in (-137.02, -114.98):
        box(g, "glass", (x, 18.5, -44), (0.06, 2.2, 36), bevel=0)
    box(g, "glass", (-126, 18.5, -23.98), (18, 2.2, 0.06), bevel=0)
    box(g, "steel", (-126, 4.5, -23.96), (6, 9, 0.1), bevel=0)
    box(g, "steel_dark", (-119, 1.2, -23.96), (1.1, 2.3, 0.1), bevel=0)
    box(g, "concrete", (-112, 0.25, -30), (6, 0.5, 6))
    box(g, "xfmr", (-112, 2.4, -30), (3.6, 3.4, 3.0), bevel=0.06)
    for dz in (-1, 0, 1):
        cyl(g, "porcelain", (-112, 4.1, -30 + dz), (-112, 6.0, -30 + dz), 0.15, r2=0.09, seg=10)


ACC = dict(streets=[-172, -161, -150], width=10, z0=-84, z1=-26, deck=18, apex=29, fans=6)


def air_cooled_condenser():
    g = "acc"
    streets, width, z0, z1, deck, apex = ACC["streets"], ACC["width"], ACC["z0"], ACC["z1"], ACC["deck"], ACC["apex"]
    length, zc, half = z1 - z0, (z0 + z1) / 2, width / 2
    xmin, xmax = streets[0] - half - 0.5, streets[-1] + half + 0.5
    col_x = [xmin, *[x - half - 0.5 for x in streets[1:]], xmax]
    col_z = [z0 + length * k / 4 for k in range(5)]
    for x in col_x:
        for z in col_z:
            box(g, "concrete", (x, 0.4, z), (1.6, 0.8, 1.6))
            box(g, "steel", (x, deck / 2, z), (0.9, deck, 0.9), bevel=0.03)
        box(g, "steel", (x, deck - 0.3, zc), (0.8, 0.8, length + 1), bevel=0.03)
    for z in col_z:
        box(g, "steel", ((xmin + xmax) / 2, deck - 0.3, z), (xmax - xmin, 0.8, 0.8), bevel=0.03)
    for k in range(4):
        for x in (xmin, xmax):
            cyl(g, "steel", (x, 0.5, col_z[k]), (x, deck - 1, col_z[k + 1]), 0.18, seg=6)
            cyl(g, "steel", (x, deck - 1, col_z[k]), (x, 0.5, col_z[k + 1]), 0.18, seg=6)
    for k in range(len(col_x) - 1):
        for z in (z0, z1):
            cyl(g, "steel", (col_x[k], 0.5, z), (col_x[k + 1], deck - 1, z), 0.18, seg=6)
            cyl(g, "steel", (col_x[k], deck - 1, z), (col_x[k + 1], 0.5, z), 0.18, seg=6)
    # fan deck walkway between the shrouds (the fans themselves turn in the website)
    box(g, "galv", ((xmin + xmax) / 2, deck + 0.25, zc), (xmax - xmin, 0.12, length), bevel=0)
    tilt = math.atan2(apex - deck, half)
    slant = math.hypot(apex - deck, half)
    for x in streets:
        for side in (-1, 1):
            box(g, "fins", (x + side * half / 2, (deck + apex) / 2, zc), (0.5, slant, length), rot=(0, 0, side * (math.pi / 2 - tilt)), bevel=0)
    top = apex + 0.6
    pipe(g, "pipe_white", [(-137, 14, -58), (-140, 14, -58), (-140, 14, -90), (-140, top, -90), (streets[0], top, -90)], 2.4, seg=24)
    for x in streets:
        ball(g, "pipe_white", (x, top, -90), 2.1, seg=20)
        cyl(g, "pipe_white", (x, top, -90), (x, top, z0 - 6), 1.6, seg=20)
        cyl(g, "pipe_white", (x, top, z0 - 6), (x, top, z1), 1.3, seg=20)
        for side in (-1, 1):
            cyl(g, "steel", (x + side * (half - 0.4), deck + 0.6, z0), (x + side * (half - 0.4), deck + 0.6, z1), 0.35, seg=10)
    wall_h = apex + 1 - deck
    wy = deck + wall_h / 2
    for p, s in (((xmin, wy, zc), (0.4, wall_h, length + 0.8)), ((xmax, wy, zc), (0.4, wall_h, length + 0.8)),
                 (((xmin + xmax) / 2, wy, z1), (xmax - xmin, wall_h, 0.4)), (((xmin + xmax) / 2, wy, z0), (xmax - xmin, wall_h, 0.4))):
        box(g, "clad", p, s, bevel=0.02)
    stair_tower(g, xmax + 3, z1 - 4, deck)
    # condensate tank and pumps under the deck
    cyl(g, "tank", (-161, 1, -50), (-150, 1, -50), 1.6, seg=20)
    for k in range(3):
        box(g, "steel", (-160 + k * 4, 0.7, -45), (1.2, 1.4, 2.0))


# ---------------------------------------------------------------- balance of plant

def gas_metering():
    g = "gas"
    for x in range(-108, 109, 12):
        box(g, "concrete", (x, 0.2, -38), (1.0, 0.4, 2.4))
    cyl(g, "gas_yellow", (-110, 1, -38), (110, 1, -38), 0.9, seg=18)
    box(g, "concrete", (118, 0.2, -34), (18, 0.4, 13))
    for x in (112, 115):
        cyl(g, "steel", (x, 0.4, -38.5), (x, 4.6, -38.5), 0.8, seg=18)
        ball(g, "steel", (x, 4.6, -38.5), 0.8, seg=16)
        ball(g, "steel", (x, 0.9, -38.5), 0.8, seg=16)
    pipe(g, "gas_yellow", [(110, 1, -38), (110, 1.4, -36.5), (126, 1.4, -36.5)], 0.38, seg=12)
    for z in (-33.5, -30.5):
        cyl(g, "gas_yellow", (111, 1.4, z), (125, 1.4, z), 0.3, seg=12)
        for x in (113, 117, 121):
            cyl(g, "gas_yellow", (x - 0.12, 1.4, z), (x + 0.12, 1.4, z), 0.48, seg=12)
        box(g, "steel_dark", (119, 1.4, z), (1.4, 0.9, 0.9))
        for x in (111, 125):
            box(g, "steel", (x, 0.8, z), (0.4, 0.8, 0.4))
    for x in (111, 125):
        cyl(g, "gas_yellow", (x, 1.4, -36.5), (x, 1.4, -30.5), 0.38, seg=12)
    pipe(g, "gas_yellow", [(125, 1.4, -36.5), (128, 1.4, -36.5), (128, -0.5, -36.5)], 0.38, seg=12)
    box(g, "clad_beige", (122, 1.9, -28.6), (4.4, 3.2, 3.0), bevel=0.05)
    box(g, "steel_dark", (121, 1.4, -27.08), (0.9, 2.1, 0.06), bevel=0)
    cyl(g, "steel", (126.5, 0.4, -40), (126.5, 7.5, -40), 0.14, seg=8)
    for x in (109.5, 126.5):
        for z in (-40.2, -27.8):
            cyl(g, "safety", (x, 0, z), (x, 1.1, z), 0.14, seg=8)


def lattice_tower(g, x, z, h=30, y0=0.0):
    legs = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    base, topw = 2.6, 0.7
    at = lambda sx, sz, y: Vector((x + sx * (base + (topw - base) * y / h), y0 + y, z + sz * (base + (topw - base) * y / h)))
    for sx, sz in legs:
        cyl(g, "galv", at(sx, sz, 0), at(sx, sz, h), 0.22, seg=6)
    levels = [0.5, 7, 13, 18.5, 23, h - 1]
    for a, b in zip(levels, levels[1:]):
        for k in range(4):
            s0, s1 = legs[k], legs[(k + 1) % 4]
            cyl(g, "galv", at(*s0, a), at(*s1, b), 0.07, seg=4)
            cyl(g, "galv", at(*s1, a), at(*s0, b), 0.07, seg=4)
            cyl(g, "galv", at(*s0, b), at(*s1, b), 0.08, seg=4)
    arms = [(20, 6.5), (26, 8.5)]
    for y, w in arms:
        box(g, "galv", (x, y0 + y, z), (0.5, 0.5, 2 * w), bevel=0.02)
        for dz in (-w + 0.4, w - 0.4):
            cyl(g, "porcelain", (x, y0 + y - 0.2, z + dz), (x, y0 + y - 2.0, z + dz), 0.12, seg=8)
    box(g, "galv", (x, y0 + h + 0.3, z), (0.4, 0.4, 6), bevel=0.02)
    return [(y0 + y - 2.0, z + dz) for y, w in arms for dz in (-w + 0.4, w - 0.4)]


def sag_line(g, a, b, sag, n=8):
    pts = [a.lerp(b, k / n) - Vector((0, sag * 4 * (k / n) * (1 - k / n), 0)) for k in range(n + 1)]
    for p, q in zip(pts, pts[1:]):
        cyl(g, "steel_dark", p, q, 0.045, seg=4, caps=False)


def switchyard():
    g = "switchyard"
    x, z = SWITCHYARD
    quad(g, "gravel", x - 26, z - 34, x + 26, z + 34, 0.16)
    for dx in (-14, 0, 14):
        for dz in (-22, -2, 18):
            gx, gz = x + dx, z + dz
            for sx in (-4, 4):
                box(g, "concrete", (gx + sx, 0.3, gz), (1.2, 0.6, 1.2))
                box(g, "galv", (gx + sx, 6, gz), (0.5, 12, 0.5), bevel=0.02)
                for y in (3, 6, 9):
                    cyl(g, "galv", (gx + sx, y - 3, gz - 0.2), (gx + sx, y, gz + 0.2), 0.04, seg=4)
            box(g, "galv", (gx, 12, gz), (9, 0.6, 0.6), bevel=0.02)
            for k in (-3, 0, 3):
                cyl(g, "porcelain", (gx + k, 11.7, gz), (gx + k, 10.4, gz), 0.12, seg=8)
                if dz < 18:
                    sag_line(g, Vector((gx + k, 10.4, gz)), Vector((gx + k, 10.4, gz + 20)), 0.6, n=4)
            # breaker: tank on a frame with bushings
            box(g, "concrete", (gx, 0.2, gz + 5), (4, 0.4, 2))
            for sx in (-1.4, 1.4):
                box(g, "galv", (gx + sx, 1.0, gz + 5), (0.2, 1.6, 1.4), bevel=0)
            cyl(g, "steel", (gx - 1.8, 2.2, gz + 5), (gx + 1.8, 2.2, gz + 5), 0.55, seg=16)
            for k in (-1.2, 0, 1.2):
                cyl(g, "porcelain", (gx + k, 2.6, gz + 5), (gx + k, 4.3, gz + 5), 0.13, r2=0.08, seg=8)
            # disconnect switch on insulator posts
            box(g, "galv", (gx, 2.2, gz - 4), (6.5, 0.3, 0.4), bevel=0)
            for sx in (-2.8, 2.8):
                box(g, "galv", (gx + sx, 1.1, gz - 4), (0.3, 2.2, 0.3), bevel=0)
            for k in (-2.4, 0, 2.4):
                cyl(g, "porcelain", (gx + k, 2.35, gz - 4), (gx + k, 4.0, gz - 4), 0.11, seg=8)
    box(g, "clad_beige", (x - 20, 2, z + 28), (7, 4, 5), bevel=0.05)
    fence = [(x - 26, z - 34), (x + 26, z - 34), (x + 26, z + 34), (x - 26, z + 34), (x - 26, z - 34)]
    for (ax, az), (bx, bz) in zip(fence, fence[1:]):
        a, b = Vector((ax, 0, az)), Vector((bx, 0, bz))
        n = max(1, int((b - a).length / 4))
        for k in range(n + 1):
            q = a.lerp(b, k / n)
            cyl(g, "galv", q, q + Vector((0, 2.4, 0)), 0.05, seg=6)
        for y in (0.4, 1.3, 2.3):
            cyl(g, "galv", a + Vector((0, y, 0)), b + Vector((0, y, 0)), 0.025, seg=4, caps=False)
    # transmission line leaving east across the desert
    xs = [x + 40, 262, 340, 418, 496, 574, 652, 730]
    prev = None
    for k, tx in enumerate(xs):
        group = g if k == 0 else "powerlines"
        ends = lattice_tower(group, tx, z, y0=float(terrain_h(tx, z)))
        if prev:
            for (ya, za), (yb, zb) in zip(prev[1], ends):
                sag_line("powerlines", Vector((prev[0], ya, za)), Vector((tx, yb, zb)), 4.0)
        prev = (tx, ends)


def poles_along(points, spacing=24.0):
    g = "powerlines"
    for a, b in zip(points, points[1:]):
        a, b = Vector((a[0], 0, a[1])), Vector((b[0], 0, b[1]))
        n = max(1, round((b - a).length / spacing))
        d = (b - a).normalized()
        across = Vector((-d.z, 0, d.x))
        for k in range(n + 1):
            q = a.lerp(b, k / n)
            for s in (-1.4, 1.4):
                cyl(g, "steel", q + across * s, q + across * s + Vector((0, 10.4, 0)), 0.22, r2=0.16, seg=8)
            box(g, "steel", (q.x, 9.8, q.z), (0.3, 0.3, 0.3), bevel=0)
            cyl(g, "steel", q + across * -2.4 + Vector((0, 9.8, 0)), q + across * 2.4 + Vector((0, 9.8, 0)), 0.14, seg=6)
            for s in (-1.8, 0, 1.8):
                p = q + across * s + Vector((0, 9.8, 0))
                cyl(g, "porcelain", p, p - Vector((0, 0.9, 0)), 0.09, seg=6)


def utilities():
    g = "utilities"
    for cx in (100, 116):
        cz = 18
        cyl(g, "concrete", (cx, 0, cz), (cx, 0.4, cz), 7.0, seg=40)
        cyl(g, "tank", (cx, 0.4, cz), (cx, 14, cz), 6.5, seg=48)
        cyl(g, "tank", (cx, 14, cz), (cx, 15.6, cz), 6.55, r2=0.9, seg=48)
        ring_rail(g, cx, cz, 6.3, 14.0, n=24)
        for k in range(14):
            a = 0.2 + k * 0.11
            box(g, "galv", (cx + 6.8 * math.cos(a), k + 0.5, cz + 6.8 * math.sin(a)), (0.9, 0.08, 0.35), rot=(0, -a, 0), bevel=0)
        cyl(g, "galv", (cx + 6.95 * math.cos(0.2), 0.4, cz + 6.95 * math.sin(0.2)), (cx + 6.95 * math.cos(1.73), 14.5, cz + 6.95 * math.sin(1.73)), 0.04, seg=4)
    for p, s in (((108, 0.6, 8.6), (36, 1.2, 0.4)), ((108, 0.6, 27.4), (36, 1.2, 0.4)), ((90.2, 0.6, 18), (0.4, 1.2, 19)), ((125.8, 0.6, 18), (0.4, 1.2, 19))):
        box(g, "concrete", p, s, bevel=0.03)
    box(g, "clad_beige", (82, 2.5, 20), (8, 5, 10), bevel=0.05)
    # lube oil fin-fan coolers
    for k in range(5):
        x = 30 + k * 9
        for dx in (-3.4, 3.4):
            for dz in (-3, 3):
                box(g, "steel", (x + dx, 1.1, -104 + dz), (0.3, 2.2, 0.3), bevel=0)
        box(g, "steel", (x, 2.8, -104), (8, 1.2, 7), bevel=0.05)
        for dz in (-1.7, 1.7):
            cyl(g, "black", (x, 3.4, -104 + dz), (x, 3.9, -104 + dz), 1.5, seg=20)
            cyl(g, "galv", (x, 3.85, -104 + dz), (x, 3.95, -104 + dz), 0.3, seg=10)
    cyl(g, "steel", (28, 1.6, -100), (68, 1.6, -100), 0.25, seg=10)


def data_center():
    g = "datacenter"
    box(g, "concrete", (0, 0.2, 64), (156, 0.4, 38))
    box(g, "dc_panel", (0, 8, 62), (150, 16, 32), bevel=0.15)
    for p, s in (((0, 16.5, 46.2), (150, 1, 0.4)), ((0, 16.5, 77.8), (150, 1, 0.4)), ((-74.8, 16.5, 62), (0.4, 1, 32)), ((74.8, 16.5, 62), (0.4, 1, 32))):
        box(g, "steel_dark", p, s, bevel=0.02)
    for x in range(-50, 41, 30):
        box(g, "clad", (x, 17, 66), (10, 2, 8))
    for z in (51, 56, 74):
        for k in range(21):
            x = -70 + k * 7
            if z == 74 and k % 3 == 1:
                continue
            box(g, "galv", (x, 16.9, z), (5.6, 1.8, 2.6), bevel=0.05)
            for dx in (-1.4, 1.4):
                cyl(g, "black", (x + dx, 17.8, z), (x + dx, 18.0, z), 0.95, seg=16)
    # vertical fins between the lit rack windows on the north face
    for k in range(16):
        box(g, "steel_dark", (-67.6 + k * 9.6, 8, 45.75), (0.6, 16, 0.5), bevel=0.02)
    for k in range(6):
        box(g, "steel_dark", (-40 + k * 16, 2.2, 78.05), (3.6, 4.2, 0.1), bevel=0)
    # standby generator row
    box(g, "concrete", (0, 0.2, 87), (150, 0.4, 7))
    for k in range(12):
        x = -66 + k * 12
        box(g, "clad", (x, 1.95, 87), (10.5, 3.1, 2.8), bevel=0.08)
        cyl(g, "steel_dark", (x + 3.5, 3.5, 87), (x + 3.5, 5.6, 87), 0.3, seg=10)


def battery_yard():
    g = "battery"
    box(g, "concrete", (-150, 0.15, 26), (36, 0.3, 20))
    for k in range(3):
        box(g, "clad", (-167 + k * 5.5, 1.5, 38.5), (4, 2.4, 2.2), bevel=0.05)
    box(g, "xfmr", (-149, 1.6, 38.5), (2.8, 2.6, 2.2), bevel=0.05)
    fence = [(-170, 14), (-130, 14), (-130, 31), (-130, 36), (-170, 36), (-170, 14)]
    for (ax, az), (bx, bz) in zip(fence, fence[1:]):
        a, b = Vector((ax, 0, az)), Vector((bx, 0, bz))
        n = max(1, int((b - a).length / 4))
        for k in range(n + 1):
            q = a.lerp(b, k / n)
            cyl(g, "galv", q, q + Vector((0, 2.2, 0)), 0.05, seg=6)
        cyl(g, "galv", a + Vector((0, 2.1, 0)), b + Vector((0, 2.1, 0)), 0.025, seg=4, caps=False)


def control_building():
    g = "control"
    box(g, "concrete", (-120, 0.2, 72), (32, 0.4, 18))
    box(g, "clad_beige", (-120, 4, 72), (30, 8, 16), bevel=0.12)
    box(g, "steel_dark", (-120, 8.25, 72), (30.4, 0.5, 16.4))
    for z in (63.97, 80.03):
        box(g, "glass", (-120, 4.6, z), (26, 1.8, 0.06), bevel=0)
    box(g, "glass", (-120, 1.4, 80.04), (2.4, 2.6, 0.06), bevel=0)
    box(g, "steel", (-120, 3.2, 82), (6, 0.25, 4))
    for dx in (-2.8, 2.8):
        cyl(g, "steel", (-120 + dx, 0.4, 83.8), (-120 + dx, 3.1, 83.8), 0.1, seg=8)
    for dx in (-8, 0, 8):
        box(g, "galv", (-120 + dx, 9.1, 70), (3, 1.2, 2.4), bevel=0.05)
    cyl(g, "galv", (-131, 8.5, 66), (-131, 20, 66), 0.12, seg=6)


# ---------------------------------------------------------------- build and export

terrain()
tracks()
scrub()
for x, z, ry in WELLS:
    pumpjack(x, z, ry)
site()
for i in range(8):
    gas_turbine_unit(i)
pipe_rack()
steam_hall()
air_cooled_condenser()
gas_metering()
switchyard()
poles_along([(UNIT_X(0) + 8, BUS_Z), (138, BUS_Z), (138, -79)])
poles_along([(132, -11), (132, 60), (76, 60)], spacing=26)
poles_along([(-150, 40), (-150, 60), (-76, 60)], spacing=26)
utilities()
data_center()
battery_yard()
control_building()

scene_col = bpy.context.scene.collection
groups = {}
for (group, mname), d in GEO.items():
    if group not in groups:
        empty = bpy.data.objects.new(group, None)
        scene_col.objects.link(empty)
        groups[group] = empty
    me = bpy.data.meshes.new(f"{group}_{mname}")
    me.from_pydata(d["v"], [], d["f"])
    me.validate()
    me.update()
    me.polygons.foreach_set("use_smooth", d["s"][:len(me.polygons)])
    co = np.array(d["v"], dtype=np.float64)
    nl = len(me.loops)
    lv = np.zeros(nl, dtype=np.int64)
    me.loops.foreach_get("vertex_index", lv)
    pn = np.zeros(len(me.polygons) * 3)
    me.polygons.foreach_get("normal", pn)
    tot = np.zeros(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get("loop_total", tot)
    n = pn.reshape(-1, 3)[np.repeat(np.arange(len(me.polygons)), tot)]
    p = co[lv]
    ax = np.abs(n).argmax(1)
    u = np.where(ax == 0, p[:, 1], p[:, 0])
    v = np.where(ax == 2, p[:, 1], p[:, 2])
    uv = me.uv_layers.new(name="UVMap")
    uv.data.foreach_set("uv", (np.stack([u, v], 1) / TILE[mname]).astype(np.float32).ravel())
    if mname == "caliche":
        # Broad light and dark patches across the desert (the website multiplies them into the texture),
        # so the 110 m tile never reads as a repeat from the air. Blender frame here: x east, y north.
        wx, wz = co[:, 0], -co[:, 1]
        patch = (np.sin(wx / 173 + 1.3) * np.cos(wz / 211 + 0.4) + 0.6 * np.sin(wx / 71 - wz / 97 + 2.1)
                 + 0.35 * np.sin(wx / 37 + 0.7) * np.sin(wz / 43 + 1.9))
        shade = 0.93 + 0.07 * np.tanh(patch)
        warm = np.stack([shade * 1.02, shade, shade * 0.95, np.ones_like(shade)], 1)
        ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        ca.data.foreach_set("color", warm.astype(np.float32).ravel())
        me.color_attributes.active_color = ca
    me.materials.append(MAT[mname])
    ob = bpy.data.objects.new(me.name, me)
    scene_col.objects.link(ob)
    ob.parent = groups[group]

tris = sum(sum(len(f) - 2 for f in d["f"]) for d in GEO.values())
print(f"[plant] {len(groups)} groups, {len(GEO)} meshes, {tris:,} triangles")

kw = dict(filepath=OUT, export_format="GLB", export_yup=True, export_apply=False, export_texcoords=True,
          export_normals=True, export_materials="EXPORT", export_cameras=False, export_lights=False,
          export_vertex_color="ACTIVE",
          export_image_format="JPEG", export_jpeg_quality=82,
          # Draco cuts the file to a fraction; the website serves the decoder from web/public/draco/.
          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
          export_draco_position_quantization=16, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12)
try:
    bpy.ops.export_scene.gltf(**kw)
except TypeError:
    kw.pop("export_jpeg_quality")
    bpy.ops.export_scene.gltf(**kw)
print(f"[plant] wrote {OUT} ({os.path.getsize(OUT) / 1e6:.1f} MB)")
