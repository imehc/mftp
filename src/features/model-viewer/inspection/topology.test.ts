import { expect, it } from "vitest";
import { analyzeTopology } from "./topology";
import type { MeshSample } from "./types";

function sample(positions: number[], indices: number[]): MeshSample {
  return {
    name: "fixture",
    positions: new Float64Array(positions),
    indices: new Uint32Array(indices),
    normals: null,
  };
}
it("报告开放三角形但不声称存在朝内法线", () => {
  const report = analyzeTopology(
    sample([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]),
    1e-5,
  );
  expect(report).toMatchObject({
    triangles: 1,
    openEdges: 3,
    nonManifoldEdges: 0,
    windingConflicts: 0,
    inwardShells: 0,
  });
});
it("区分绕序不一致、非流形边和退化三角形", () => {
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1];
  expect(
    analyzeTopology(sample(positions, [0, 1, 2, 0, 1, 3]), 1e-5)
      .windingConflicts,
  ).toBe(1);
  const report = analyzeTopology(
    sample(positions, [0, 1, 2, 1, 0, 3, 0, 1, 4, 0, 0, 1]),
    1e-5,
  );
  expect(report).toMatchObject({
    nonManifoldEdges: 1,
    degenerate: 1,
    inwardShells: 0,
  });
});
it("独立于大幅平移检测朝内的闭合四面体", () => {
  const p = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1].map((v) => v + 1e6);
  const outward = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
  expect(analyzeTopology(sample(p, outward), 1e-5)).toMatchObject({
    openEdges: 0,
    inwardShells: 0,
  });
  const inward = outward.map((_, i) => outward[i - (i % 3) + (2 - (i % 3))]);
  expect(analyzeTopology(sample(p, inward), 1e-5)).toMatchObject({
    openEdges: 0,
    inwardShells: 1,
  });
});
it("跨空间桶边界合并实际接近的距离", () => {
  const p = [0.099, 0, 0, 1, 0, 0, 0, 1, 0, 0.101, 0, 0, 0, -1, 0];
  expect(analyzeTopology(sample(p, [0, 1, 2, 1, 3, 4]), 0.01)).toMatchObject({
    openEdges: 4,
    windingConflicts: 0,
  });
});
it("独立于拓扑将相反的顶点法线报告为建议信息", () => {
  const mesh = sample([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
  mesh.normals = new Float32Array([0, 0, -1, 0, 0, 1, 0, 0, 1]);
  expect(analyzeTopology(mesh, 1e-5)).toMatchObject({
    opposedNormals: 1,
    inwardShells: 0,
  });
});
