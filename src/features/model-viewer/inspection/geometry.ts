import { Box3, InstancedMesh, Matrix3, Matrix4, Mesh, Vector3 } from "three";
import type { ModelEntry } from "../runtime/collection";
import { modelError } from "../domain/errors";
import type { MeshSample } from "./types";

export function sourcePoint(entry: ModelEntry, world: Vector3) {
  entry.layer.updateWorldMatrix(true, true);
  return world
    .clone()
    .applyMatrix4(entry.handle.scene.parent!.matrixWorld.clone().invert());
}

export async function sampleGeometry(entry: ModelEntry, signal: AbortSignal) {
  entry.layer.updateWorldMatrix(true, true);
  const inverse = entry.handle.scene.parent!.matrixWorld.clone().invert();
  const meshes: Mesh[] = [];
  entry.handle.scene.traverse((node) => {
    if (node instanceof Mesh) meshes.push(node);
  });
  let vertices = 0,
    triangles = 0,
    instances = 0;
  // 在分配之前统计实例展开量，避免恶意索引或大量实例制造内存峰值。
  for (const mesh of meshes) {
    const count = mesh instanceof InstancedMesh ? mesh.count : 1;
    instances += count;
    vertices += (mesh.geometry.getAttribute("position")?.count ?? 0) * count;
    triangles +=
      ((mesh.geometry.index?.count ??
        mesh.geometry.getAttribute("position")?.count ??
        0) /
        3) *
      count;
  }
  if (vertices > 200_000 || triangles > 100_000 || instances > 1000)
    throw modelError("analysis_limit");
  const samples: MeshSample[] = [];
  const bounds = new Box3();
  const vertex = new Vector3();
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position");
    if (!position) continue;
    if ("skeleton" in mesh)
      (mesh as import("three").SkinnedMesh).skeleton.update();
    const normal = mesh.geometry.getAttribute("normal");
    const vertexSource =
      mesh instanceof InstancedMesh && mesh.morphTexture
        ? new Mesh(mesh.geometry, mesh.material)
        : mesh;
    const count = mesh instanceof InstancedMesh ? mesh.count : 1;
    for (let instance = 0; instance < count; instance++) {
      signal.throwIfAborted();
      if (mesh instanceof InstancedMesh && mesh.morphTexture)
        mesh.getMorphAt(instance, vertexSource);
      const matrix = inverse.clone().multiply(mesh.matrixWorld);
      if (mesh instanceof InstancedMesh) {
        const instanceMatrix = new Matrix4();
        mesh.getMatrixAt(instance, instanceMatrix);
        matrix.multiply(instanceMatrix);
      }
      const positions = new Float64Array(position.count * 3);
      // 当前蒙皮/morph 顶点可准确取样；原始法线不等于变形法线，不据此误报。
      const normals =
        normal &&
        !vertexSource.morphTargetInfluences?.length &&
        !("skeleton" in mesh)
          ? new Float32Array(position.count * 3)
          : null;
      const normalMatrix = new Matrix3().getNormalMatrix(matrix);
      for (let i = 0; i < position.count; i++) {
        vertexSource.getVertexPosition(i, vertex).applyMatrix4(matrix);
        if (!vertex.toArray().every(Number.isFinite))
          throw modelError("invalid");
        vertex.toArray(positions, i * 3);
        bounds.expandByPoint(vertex);
        if (normals)
          vertex
            .fromBufferAttribute(normal, i)
            .applyNormalMatrix(normalMatrix)
            .toArray(normals, i * 3);
        if (i % 8192 === 0) {
          await new Promise<void>((r) => setTimeout(r, 0));
          signal.throwIfAborted();
        }
      }
      const index = mesh.geometry.index;
      const start = Math.max(0, mesh.geometry.drawRange.start);
      const end = Math.min(
        index?.count ?? position.count,
        start + mesh.geometry.drawRange.count,
      );
      const indices = new Uint32Array(
        Math.max(0, Math.floor((end - start) / 3) * 3),
      );
      for (let i = 0; i < indices.length; i++) {
        const value = index ? index.getX(start + i) : start + i;
        if (value >= position.count || value < 0 || !Number.isInteger(value))
          throw modelError("invalid");
        indices[i] = value;
      }
      // 镜像节点的正面由渲染器反转；保持相同朝向，避免把镜像误报为内翻。
      if (matrix.determinant() < 0)
        for (let i = 0; i < indices.length; i += 3) {
          [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
        }
      samples.push({
        name: `${mesh.name || mesh.uuid}${count > 1 ? ` [${instance}]` : ""}`,
        positions,
        normals,
        indices,
      });
    }
  }
  return { samples, bounds };
}
