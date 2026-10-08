import { expect, it, vi } from "vitest";
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import { packFbx, unpackFbx } from "./fbx-transfer";
import { FBX_NODE_LIMIT } from "./fbx-policy";

it("场景移交保留骨骼绑定、动画轨道和初始变形权重", async () => {
  const scene = new Group(),
    bone = new Bone();
  bone.name = "Joint";
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  geometry.setAttribute(
    "skinIndex",
    new Uint16BufferAttribute(new Array(12).fill(0), 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  const morph = new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3);
  morph.name = "Smile";
  geometry.morphAttributes.position = [morph];
  geometry.morphTargetsRelative = true;
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  mesh.name = "Skin";
  mesh.add(bone);
  scene.add(mesh);
  mesh.bind(new Skeleton([bone]));
  mesh.morphTargetInfluences![0] = 0.25;
  scene.animations = [
    new AnimationClip("Move", 1, [
      new VectorKeyframeTrack("Joint.position", [0, 1], [0, 0, 0, 2, 0, 0]),
      new NumberKeyframeTrack(
        "Skin.morphTargetInfluences[Smile]",
        [0, 1],
        [0, 1],
      ),
    ]),
  ];
  const packed = packFbx(scene, []);
  const restored = await unpackFbx(
    structuredClone(packed.value),
    {},
    new AbortController().signal,
    vi.fn(),
  );
  const restoredMesh = restored.getObjectByName("Skin") as SkinnedMesh;
  expect(restoredMesh.skeleton.bones[0]).toBe(
    restored.getObjectByName("Joint"),
  );
  expect(restoredMesh.morphTargetInfluences).toEqual([0.25]);

  const point = (root: Group, target: SkinnedMesh) => {
    const mixer = new AnimationMixer(root);
    mixer.clipAction(root.animations[0]).play();
    mixer.update(0.5);
    root.updateMatrixWorld(true);
    target.skeleton.update();
    return target.getVertexPosition(0, new Vector3()).toArray();
  };

  expect(point(restored, restoredMesh)).toEqual(point(scene, mesh));
  expect(restoredMesh.morphTargetInfluences).toEqual([0.5]);
});

it("超过对象数量预算时停止移交，避免主线程重建过大场景", () => {
  const scene = new Group();
  for (let i = 0; i < FBX_NODE_LIMIT; i++) scene.add(new Group());
  expect(() => packFbx(scene, [])).toThrow(
    expect.objectContaining({ code: "model:fbx_limit" }),
  );
});
