import { Vector3 } from "three";

import type { MeshSample, TopologyReport } from "./types";

/** 在相邻空间桶内按实际距离焊接，桶边界两侧的近点也能合并。 */
export function analyzeTopology(
  mesh: MeshSample,
  tolerance: number,
): TopologyReport {
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error("Invalid tolerance");
  const points: Vector3[] = [];
  const buckets = new Map<string, number[]>();
  const welded: number[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const p = new Vector3().fromArray(mesh.positions, i);
    const cell = p.toArray().map((n) => Math.floor(n / tolerance));
    let match: number | undefined;
    for (let x = -1; x <= 1 && match === undefined; x++)
      for (let y = -1; y <= 1 && match === undefined; y++)
        for (let z = -1; z <= 1 && match === undefined; z++) {
          const ids = buckets.get(
            `${cell[0] + x},${cell[1] + y},${cell[2] + z}`,
          );
          match = ids?.find(
            (id) => points[id].distanceToSquared(p) <= tolerance * tolerance,
          );
        }
    if (match === undefined) {
      match = points.length;
      points.push(p);
      const key = cell.join(",");
      const bucket = buckets.get(key) ?? [];
      bucket.push(match);
      buckets.set(key, bucket);
    }
    welded.push(match);
  }
  const result: TopologyReport = {
    name: mesh.name,
    triangles: Math.floor(mesh.indices.length / 3),
    openEdges: 0,
    nonManifoldEdges: 0,
    windingConflicts: 0,
    degenerate: 0,
    opposedNormals: 0,
    inwardShells: 0,
    normalsAvailable: !!mesh.normals,
  };
  const edges = new Map<string, { face: number; sign: number }[]>();
  const faces: { points: Vector3[]; neighbors: number[]; closed: boolean }[] =
    [];
  const cross = new Vector3();
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const original = Array.from(mesh.indices.subarray(i, i + 3));
    const ids = original.map((id) => welded[id]);
    const p = original.map((id) =>
      new Vector3().fromArray(mesh.positions, id * 3),
    );
    cross.crossVectors(p[1].clone().sub(p[0]), p[2].clone().sub(p[0]));
    if (new Set(ids).size < 3 || cross.lengthSq() <= tolerance ** 4) {
      result.degenerate++;
      continue;
    }
    if (
      mesh.normals &&
      original.some(
        (id) =>
          new Vector3().fromArray(mesh.normals!, id * 3).dot(cross) <
          -1e-10 * cross.length(),
      )
    )
      result.opposedNormals++;
    const face = faces.length;
    faces.push({ points: p, neighbors: [], closed: true });
    for (let j = 0; j < 3; j++) {
      const a = ids[j],
        b = ids[(j + 1) % 3];
      const key = `${Math.min(a, b)},${Math.max(a, b)}`;
      const list = edges.get(key) ?? [];
      list.push({ face, sign: a < b ? 1 : -1 });
      edges.set(key, list);
    }
  }
  for (const list of edges.values()) {
    if (list.length === 1) result.openEdges++;
    if (list.length > 2) result.nonManifoldEdges++;
    const conflict = list.length === 2 && list[0].sign === list[1].sign;
    if (conflict) result.windingConflicts++;
    for (const edge of list) {
      faces[edge.face].closed &&= list.length === 2 && !conflict;
      // 星形连通避免非流形高阶边产生平方级邻接表。
      if (edge !== list[0]) {
        faces[edge.face].neighbors.push(list[0].face);
        faces[list[0].face].neighbors.push(edge.face);
      }
    }
  }
  const visited = new Set<number>();
  for (let start = 0; start < faces.length; start++) {
    if (visited.has(start)) continue;
    const stack = [start];
    const origin = faces[start].points[0];
    let closed = true,
      volume = 0;
    while (stack.length) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const face = faces[id];
      closed &&= face.closed;
      const [a, b, c] = face.points.map((p) => p.clone().sub(origin));
      volume += a.dot(b.cross(c)) / 6;
      stack.push(...face.neighbors.filter((n) => !visited.has(n)));
    }
    if (closed && volume < -(tolerance ** 3)) result.inwardShells++;
  }
  return result;
}
