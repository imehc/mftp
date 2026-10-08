import {
  AnimationClip,
  Bone,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  Skeleton,
  SkinnedMesh,
} from "three";
import { describe, expect, it, vi } from "vitest";

import { ModelAnimation } from "./animation";

function fixture() {
  const root = new Group();
  root.name = "Root";
  const clips = [
    new AnimationClip("Move", 2, [
      new NumberKeyframeTrack("Root.position[x]", [0, 2], [0, 4]),
    ]),
    new AnimationClip("Other", 1, [
      new NumberKeyframeTrack("Root.position[y]", [0, 1], [0, 3]),
    ]),
  ];
  const animation = new ModelAnimation(root, clips, vi.fn());
  return { root, animation };
}

describe("模型动画传输", () => {
  it("恢复乒乓阶段、暂停姿态、速度和播放方向", () => {
    const first = fixture();
    first.animation.setLoop("pingpong");
    first.animation.setSpeed(0.5);
    first.animation.play();
    first.animation.update(5);
    const saved = first.animation.persist();
    const second = fixture();
    second.animation.restore(saved);
    expect(second.root.position.x).toBeCloseTo(first.root.position.x);
    first.animation.update(0.5);
    second.animation.update(0.5);
    expect(second.root.position.x).toBeCloseTo(first.root.position.x);
    expect(second.animation.snapshot().time).toBeCloseTo(1.25);
    second.animation.pause();
    const third = fixture();
    third.animation.restore(second.animation.persist());
    third.animation.update(1);
    expect(third.animation.snapshot().time).toBeCloseTo(1.25);
    expect(third.animation.snapshot().playing).toBe(false);
  });

  it("从暂停开始，预览精确的暂停帧并在零点停止", () => {
    const { root, animation } = fixture();
    animation.update(1);
    expect(root.position.x).toBe(0);
    animation.seek(1);
    expect(root.position.x).toBeCloseTo(2);
    expect(animation.snapshot().playing).toBe(false);
    animation.play();
    animation.update(0.25);
    animation.pause();
    animation.update(1);
    expect(root.position.x).toBeCloseTo(2.5);
    animation.stop();
    expect(root.position.x).toBe(0);
    expect(animation.snapshot()).toMatchObject({ time: 0, playing: false });
  });

  it("只限制一次，从开头重新开始并跨越重复与乒乓边界", () => {
    const { root, animation } = fixture();
    animation.setLoop("once");
    animation.play();
    animation.update(3);
    expect(root.position.x).toBe(4);
    expect(animation.snapshot()).toMatchObject({ time: 2, playing: false });
    animation.play();
    expect(root.position.x).toBe(0);
    animation.setLoop("repeat");
    animation.update(2.25);
    expect(root.position.x).toBeCloseTo(0.5);
    animation.stop();
    animation.setLoop("pingpong");
    animation.play();
    animation.update(2);
    expect(root.position.x).toBeCloseTo(4);
    animation.update(0.25);
    expect(root.position.x).toBeCloseTo(3.5);
    animation.update(1.75);
    expect(root.position.x).toBeCloseTo(0);
    animation.update(8.5);
    expect(root.position.x).toBeCloseTo(1);
  });

  it("拖动时不推进，仅在此前播放时恢复，切换片段时保留速度和循环", () => {
    const { root, animation } = fixture();
    animation.beginScrub();
    animation.seek(1);
    animation.endScrub();
    expect(animation.running).toBe(false);
    animation.setSpeed(2);
    animation.setLoop("pingpong");
    animation.play();
    animation.beginScrub();
    animation.seek(0.5);
    animation.update(10);
    expect(root.position.x).toBeCloseTo(1);
    animation.endScrub();
    animation.update(0.25);
    expect(root.position.x).toBeCloseTo(2);
    animation.select(1);
    expect(root.position.x).toBe(0);
    expect(animation.snapshot()).toMatchObject({
      time: 0,
      playing: false,
      speed: 2,
      loop: "pingpong",
      selected: 1,
    });
    animation.seek(1);
    expect(root.position.y).toBe(3);
  });

  it("处理无片段、零时长、无效输入和释放操作", () => {
    const root = new Group();
    const empty = new ModelAnimation(root, [], vi.fn());
    empty.play();
    empty.update(1);
    empty.select(3);
    expect(empty.snapshot()).toMatchObject({
      selected: -1,
      time: 0,
      playing: false,
    });
    const zero = new ModelAnimation(
      root,
      [new AnimationClip("Still", 0, [])],
      vi.fn(),
    );
    zero.play();
    zero.seek(Infinity);
    zero.update(2);
    zero.setSpeed(-1);
    expect(zero.snapshot()).toMatchObject({
      time: 0,
      playing: false,
      speed: 1,
    });
    const { animation, root: animated } = fixture();
    animation.play();
    animation.update(1);
    animation.dispose();
    animation.dispose();
    animation.update(1);
    animation.seek(1);
    expect(animated.position.x).toBe(0);
    expect(animation.running).toBe(false);
  });

  it("使用相同的暂停定位路径计算骨骼和变形轨道", () => {
    const root = new Group();
    const bone = new Bone();
    bone.name = "Joint";
    const skin = new SkinnedMesh(new BoxGeometry(), new MeshBasicMaterial());
    skin.add(bone);
    skin.bind(new Skeleton([bone]));
    root.add(skin);
    const geometry = new BoxGeometry();
    geometry.morphAttributes.position = [geometry.attributes.position.clone()];
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.name = "Face";
    root.add(mesh);
    const clip = new AnimationClip("Pose", 2, [
      new NumberKeyframeTrack("Joint.rotation[z]", [0, 2], [0, 1]),
      new NumberKeyframeTrack("Face.morphTargetInfluences[0]", [0, 2], [0, 1]),
    ]);
    const animation = new ModelAnimation(root, [clip], vi.fn());
    animation.seek(1);
    expect(bone.rotation.z).toBeCloseTo(0.5);
    expect(mesh.morphTargetInfluences?.[0]).toBeCloseTo(0.5);
    animation.stop();
    expect(bone.rotation.z).toBe(0);
    expect(mesh.morphTargetInfluences?.[0]).toBe(0);
  });

  it("每秒最多发布十个时间快照，同时计算每一帧", () => {
    const { root, animation } = fixture();
    const listener = vi.fn();
    animation.subscribe(listener);
    animation.play();
    listener.mockClear();
    for (let i = 0; i < 60; i++) animation.update(1 / 60);
    expect(root.position.x).toBeCloseTo(2);
    expect(listener.mock.calls.length).toBeLessThanOrEqual(10);
    expect(listener.mock.calls.length).toBeGreaterThan(0);
  });
});
