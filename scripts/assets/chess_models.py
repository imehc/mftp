"""Build the original Staunton meshes and directional wood maps for MFTP.
Run: blender --background --factory-startup --python scripts/assets/chess_models.py
The live Blender document is never opened or modified.
"""
from pathlib import Path
import math
import sys
import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src/features/games/chess/assets"
QA = ROOT / ".impeccable/review/chess"
OUT.mkdir(parents=True, exist_ok=True)
QA.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

def wood_map(name, size, rough=False):
    y, x = np.mgrid[0:1:complex(size), 0:1:complex(size)]
    rng = np.random.default_rng(1742)
    warp = .3*np.sin(y*5+x*3) + .15*np.sin(y*13-x*4)
    grain = np.zeros_like(x)
    # Layered longitudinal fibres, with irregular spacing and slow curvature.
    for frequency in [33, 71, 139, 291, 613, 1279]:
        phase = rng.uniform(0, math.tau)
        grain += (.5+.5*np.sin(x*frequency+warp*(frequency/40)+phase))**12 / math.sqrt(frequency)
    broad = .5+.5*np.sin(x*14+warp*.8)
    pores = rng.random((size,size))
    v = .87 + .055*broad - .19*grain - .013*pores
    if rough: v = .82 + .1*grain + .035*pores
    pixels = np.ones((size,size,4),dtype=np.float32)
    for channel, tint in enumerate([1., .98, .94] if not rough else [1.,1.,1.]): pixels[:,:,channel] = v*tint
    image = bpy.data.images.new(name,width=size,height=size)
    image.pixels.foreach_set(pixels.ravel())
    image.filepath_raw = str(OUT / (name+".png"))
    image.file_format = "PNG"
    image.save()
    return image

grain = wood_map("wood-grain",1024)
rough = wood_map("wood-roughness",512,True)
if "--textures-only" in sys.argv:
    sys.exit(0)
wood = bpy.data.materials.new("Boxwood")
wood.use_nodes = True
bsdf = next(n for n in wood.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (.62,.39,.16,1)
bsdf.inputs["Roughness"].default_value = .32
tex = wood.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = grain
wood.node_tree.links.new(tex.outputs["Color"],bsdf.inputs["Base Color"])
dark = wood.copy()
dark.name = "Ebony"
dark.node_tree.links.clear()
next(n for n in dark.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value=(.045,.022,.012,1)
# Output connection was cleared together with the texture connection.
dark.node_tree.links.new(next(n for n in dark.node_tree.nodes if n.type=="BSDF_PRINCIPLED").outputs[0],next(n for n in dark.node_tree.nodes if n.type=="OUTPUT_MATERIAL").inputs[0])

def finish(obj):
    obj.data.materials.clear()
    obj.data.materials.append(wood)
    for poly in obj.data.polygons: poly.use_smooth=True
    return obj

def lathe(name, profile, segments=48):
    verts=[]; faces=[]
    for radius,z in profile:
        for j in range(segments):
            a=j*2*math.pi/segments
            verts.append((radius*math.cos(a),radius*math.sin(a),z))
    for i in range(len(profile)-1):
        for j in range(segments):
            k=i*segments+j; n=i*segments+(j+1)%segments
            faces.append((k,n,n+segments,k+segments))
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(verts,[],faces); mesh.update()
    uv=mesh.uv_layers.new(name="WoodUV")
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            vi=mesh.loops[li].vertex_index; ring=vi//segments; j=vi%segments
            u=j/segments
            if poly.index%segments==segments-1 and j==0: u=1
            uv.data[li].uv=(u,profile[ring][1]/1.4)
    obj=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(obj)
    return finish(obj)

BASE=[(0,.015),(.245,.015),(.295,.035),(.316,.064),(.32,.095),(.311,.125),(.287,.15),(.274,.165),(.276,.19),(.269,.205),(.224,.219),(.205,.242)]
def pedestal(scale=1):
    return [(r*scale,z*scale) for r,z in BASE]

def sphere(name,loc,scale,segments=24,rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=loc)
    obj=bpy.context.object; obj.name=name; obj.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(obj)

def block(name,loc,scale,bevel=.015):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    obj=bpy.context.object; obj.name=name; obj.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=obj.modifiers.new("Carved edges","BEVEL"); mod.width=bevel; mod.segments=3
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(obj)

def cut(obj,cutter):
    bpy.context.view_layer.objects.active=obj
    mod=obj.modifiers.new("Carving","BOOLEAN"); mod.operation="DIFFERENCE"; mod.object=cutter
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter,do_unlink=True)

def join(name,objs):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objs: obj.select_set(True)
    bpy.context.view_layer.objects.active=objs[0]
    bpy.ops.object.join()
    result=objs[0]; result.name=name
    # Bake transforms into the geometry, with the base at the origin.
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    return result

pawn=lathe("pawn",pedestal(.79)+[(.135,.22),(.11,.26),(.09,.31),(.083,.36),(.11,.4),(.155,.425),(.155,.45),(.116,.472),(.092,.487),(.125,.506),(.156,.54),(.17,.582),(.159,.63),(.126,.674),(.075,.706),(0,.721)])
rook=lathe("rook",pedestal()+[(.19,.27),(.177,.35),(.168,.46),(.172,.61),(.193,.65),(.242,.667),(.265,.696),(.268,.72),(.265,.737),(.274,.83),(.274,.94),(.178,.94),(.178,.79),(0,.79)])
for angle in [0,math.pi/3,2*math.pi/3]:
    cutter=block("slot",(0,0,.93),(.105,.75,.16),0)
    cutter.rotation_euler.z=angle
    cut(rook,cutter)

bishop=lathe("bishop",pedestal(.96)+[(.19,.26),(.155,.30),(.13,.38),(.108,.50),(.104,.63),(.125,.685),(.191,.70),(.197,.733),(.164,.759),(.108,.78),(.13,.805),(.188,.85),(.219,.92),(.208,.986),(.16,1.057),(.08,1.13),(0,1.175)])
for vertex in bishop.data.vertices:
    if vertex.co.z>.78: vertex.co.y*=1.18
slot=block("mitre-cut",(.015,0,1.075),(.105,.7,.36),0)
slot.rotation_euler.y=-.4
slot.rotation_euler.z=.45
cut(bishop,slot)

queen=lathe("queen",pedestal()+[(.192,.27),(.16,.32),(.136,.43),(.12,.59),(.121,.75),(.15,.79),(.213,.803),(.216,.832),(.181,.854),(.14,.875),(.15,.92),(.195,1.02),(.267,1.11),(.27,1.18),(.184,1.18),(.171,1.08),(.13,1.038),(0,1.038)])
for j in range(8):
    a=j*math.pi/4
    cutter=block("crown-cut",(.247*math.cos(a),.247*math.sin(a),1.165),(.18,.092,.16),0)
    cutter.rotation_euler.z=a
    cut(queen,cutter)
queen=join("queen",[queen,sphere("finial",(0,0,1.145),(.066,.066,.085))])

king=lathe("king",pedestal(1.05)+[(.205,.285),(.168,.33),(.139,.46),(.12,.64),(.126,.84),(.156,.883),(.224,.897),(.224,.93),(.189,.957),(.126,.978),(.133,1.008),(.174,1.064),(.17,1.10),(.125,1.14),(.062,1.157),(0,1.157)])
king=join("king",[king,block("cross-stem",(0,0,1.27),(.115,.115,.26),.012),block("cross-arms",(0,0,1.31),(.40,.105,.105),.012),block("cross-depth",(0,0,1.31),(.105,.40,.105),.012)])

knight_base=lathe("knight",pedestal(.96)+[(.188,.258),(.181,.282),(.208,.301),(.218,.327),(.203,.351),(0,.357)])
sections=[(.33,0,.19,.19),(.41,-.01,.206,.213),(.52,-.057,.199,.231),(.64,-.10,.179,.24),(.77,-.126,.147,.222),(.90,-.112,.127,.191),(1.025,-.06,.142,.155),(1.115,.017,.153,.137),(1.145,.102,.142,.157),(1.12,.20,.125,.172),(1.065,.293,.10,.144),(1.005,.323,.083,.088),(.983,.305,.065,.045)]
verts=[]; faces=[]; sides=20
for z,y,rx,ry in sections:
    for j in range(sides):
        a=j*2*math.pi/sides
        verts.append((rx*math.cos(a),y+ry*math.sin(a),z))
for i in range(len(sections)-1):
    for j in range(sides):
        a=i*sides+j; b=i*sides+(j+1)%sides
        faces.append((a,b,b+sides,a+sides))
faces.append(tuple(range(sides-1,-1,-1)))
faces.append(tuple((len(sections)-1)*sides+j for j in range(sides)))
mesh=bpy.data.meshes.new("carved-horse");mesh.from_pydata(verts,[],faces);mesh.update()
neck=bpy.data.objects.new("horse",mesh);bpy.context.collection.objects.link(neck)
finish(neck)
bpy.context.view_layer.objects.active=neck
mod=neck.modifiers.new("Sculpt surface","SUBSURF");mod.levels=2
bpy.ops.object.modifier_apply(modifier=mod.name)
parts=[knight_base,neck]
for side in [-1,1]:
    ear=sphere("ear",(side*.087,-.068,1.18),(.037,.055,.128),16,10)
    ear.rotation_euler.x=-.24
    parts.append(ear)
    eye=sphere("eye-carving",(side*.14,.045,1.081),(.035,.043,.033),16,8)
    cut(neck,eye)
    nostril=sphere("nostril",(side*.075,.344,1.026),(.024,.028,.018),16,8)
    cut(neck,nostril)
# A continuous narrow mane follows the neck; shallow ridges read as carving.
for i in range(10):
    z=.48+i*.06; y=-.275 - .025*math.sin(i*.4)
    parts.append(sphere("mane",(0,y,z),(.055,.025,.048),12,6))
knight=join("knight",parts)
bpy.context.view_layer.objects.active=knight
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project()
bpy.ops.object.mode_set(mode="OBJECT")

models=[pawn,rook,knight,bishop,queen,king]
from mathutils import Vector
from mathutils.bvhtree import BVHTree

def cavity_shading(obj):
    # Local occlusion preserves carved creases under bright, top-down lighting.
    mesh=obj.data
    mesh.update()
    tree=BVHTree.FromPolygons([v.co for v in mesh.vertices],[list(p.vertices) for p in mesh.polygons])
    values=[]
    for vertex in mesh.vertices:
        normal=vertex.normal.normalized()
        tangent=normal.cross(Vector((0,0,1)))
        if tangent.length<.01: tangent=normal.cross(Vector((0,1,0)))
        tangent.normalize(); bitangent=normal.cross(tangent)
        occlusion=0
        for index in range(24):
            z=(index+.5)/24; radius=math.sqrt(1-z*z); angle=index*2.399963
            ray=normal*z+tangent*(radius*math.cos(angle))+bitangent*(radius*math.sin(angle))
            hit,_,_,distance=tree.ray_cast(vertex.co+normal*.003,ray,.24)
            if hit is not None: occlusion+=1-distance/.24
        values.append(max(.48,1-.82*occlusion/24))
    color=mesh.color_attributes.new(name="CarvingAO",type="FLOAT_COLOR",domain="CORNER")
    for poly in mesh.polygons:
        for index in poly.loop_indices:
            v=values[mesh.loops[index].vertex_index]
            color.data[index].color=(v,v,v,1)
    mesh.color_attributes.active_color=color

for obj in models:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True); bpy.context.view_layer.objects.active=obj
    # Hard carved caps retain their plane normals; rounded stems remain smooth.
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(42))
    cavity_shading(obj)
for obj in models:
    # Export geometry once, then assign the two physical materials at runtime.
    obj.data.materials.clear()
    obj.select_set(False)
bpy.ops.object.select_all(action="DESELECT")
for obj in models: obj.select_set(True)
from io_scene_gltf2 import get_format_items
options=[item[0] for item in get_format_items(None,bpy.context)]
if "GLB" not in options: raise RuntimeError("GLB exporter unavailable")
bpy.ops.export_scene.gltf(filepath=str(OUT/"staunton.glb"),export_format="GLB",use_selection=True,export_materials="NONE",export_yup=True,export_vertex_color="ACTIVE")
triangles={}
for obj in models:
    obj.data.calc_loop_triangles()
    triangles[obj.name]=len(obj.data.loop_triangles)
print("CHESS_GEOMETRY",triangles)
# An isolated source document and contact sheet for visual QA.
for i,obj in enumerate(models):
    obj.location.x=(i-2.5)*.9
    obj.data.materials.append(wood)
bpy.ops.mesh.primitive_plane_add(size=200)
floor=bpy.context.object
floor_mat=bpy.data.materials.new("Studio")
floor_mat.diffuse_color=(.12,.10,.075,1)
floor.data.materials.append(floor_mat)
bpy.ops.object.light_add(type="AREA", location=(-3,-4,6))
light=bpy.context.object;light.data.energy=800;light.data.shape="DISK";light.data.size=5
bpy.ops.object.camera_add(location=(3,-6,3.4))
camera=bpy.context.object
from mathutils import Vector
camera.rotation_euler=(Vector((0,0,.6))-camera.location).to_track_quat("-Z","Y").to_euler()
camera.data.type="ORTHO";camera.data.ortho_scale=6.1
scene=bpy.context.scene;scene.camera=camera
try: scene.render.engine="CYCLES"
except TypeError: pass
if hasattr(scene,"cycles"): scene.cycles.samples=24
scene.render.resolution_x=1400;scene.render.resolution_y=650;scene.render.resolution_percentage=100
scene.render.filepath=str(QA/"model-sheet.png")
bpy.ops.wm.save_as_mainfile(filepath=str(QA/"staunton-source.blend"))
bpy.ops.render.render(write_still=True)
