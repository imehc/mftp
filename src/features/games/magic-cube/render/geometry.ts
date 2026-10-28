import {
  BoxGeometry,
  CanvasTexture,
  Color,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshPhysicalMaterial,
  Quaternion,
  Shape,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";

import { type CubeMove, type CubeState, FACES, NORMALS } from "../types";

export const FACE_COLORS = [
  0xc73832, 0xf18b26, 0xf4f1df, 0xf4d338, 0x24955c, 0x2867be,
];

function tileGeometry() {
  const shape = new Shape();
  const h = 0.425,
    r = 0.065;
  shape.moveTo(-h + r, -h);
  shape.lineTo(h - r, -h);
  shape.quadraticCurveTo(h, -h, h, -h + r);
  shape.lineTo(h, h - r);
  shape.quadraticCurveTo(h, h, h - r, h);
  shape.lineTo(-h + r, h);
  shape.quadraticCurveTo(-h, h, -h, h - r);
  shape.lineTo(-h, -h + r);
  shape.quadraticCurveTo(-h, -h, -h + r, -h);
  return new ExtrudeGeometry(shape, {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 2,
    curveSegments: 5,
    steps: 1,
  });
}

export function createCubeGeometry(initial: CubeState) {
  const group = new Group();
  const bodyGeometry = new RoundedBoxGeometry(0.965, 0.965, 0.965, 3, 0.06);
  const stickerGeometry = tileGeometry();
  const bodyMaterial = new MeshPhysicalMaterial({
    color: 0x161a1c,
    roughness: 0.36,
    clearcoat: 0.2,
    clearcoatRoughness: 0.3,
  });
  const stickerMaterial = new MeshPhysicalMaterial({
    roughness: 0.29,
    clearcoat: 0.45,
    clearcoatRoughness: 0.24,
  });
  const bodies = new InstancedMesh(
    bodyGeometry,
    bodyMaterial,
    initial.cubies.length,
  );
  const stickers = new InstancedMesh(
    stickerGeometry,
    stickerMaterial,
    initial.order ** 2 * 6,
  );
  bodies.castShadow = stickers.castShadow = true;
  bodies.receiveShadow = stickers.receiveShadow = true;
  bodies.frustumCulled = stickers.frustumCulled = false;
  group.add(bodies, stickers);
  const edgeSource = new BoxGeometry(1, 1, 1);
  const edgeLines = new EdgesGeometry(edgeSource);
  const edges = new LineSegmentsGeometry().fromEdgesGeometry(edgeLines);
  edgeLines.dispose();
  edgeSource.dispose();
  // 屏幕空间双层描边在白面、暗色面及两种主题上都保持可辨识，不随阶数变细。
  const outlineBacking = new LineMaterial({
    color: 0x252b30,
    linewidth: 4,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  const outlineMaterial = new LineMaterial({
    color: 0xffe4a8,
    linewidth: 1.75,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  const outline = new Group();
  const backing = new LineSegments2(edges, outlineBacking);
  const foreground = new LineSegments2(edges, outlineMaterial);
  backing.renderOrder = 2;
  foreground.renderOrder = 3;
  outline.add(backing, foreground);
  outline.visible = false;
  group.add(outline);
  const labelResources: { texture: CanvasTexture; material: SpriteMaterial }[] =
    [];
  const labels = new Group();
  for (const [face, index] of FACES.map(
    (face, index) => [face, index] as const,
  )) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context) continue;
    context.beginPath();
    context.roundRect(8, 8, 80, 80, 20);
    context.fillStyle = "#252b30";
    context.fill();
    context.fillStyle = "#fff7e9";
    context.font = "600 48px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(face, 48, 49);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const material = new SpriteMaterial({ map: texture, depthTest: true });
    const sprite = new Sprite(material);
    sprite.position.fromArray(NORMALS[index]).multiplyScalar(1.88);
    sprite.scale.setScalar(0.34);
    labels.add(sprite);
    labelResources.push({ texture, material });
  }
  group.add(labels);
  labels.visible = false;
  const hits: { cubie: number; face: number }[] = [];
  const matrix = new Matrix4();
  const rotation = new Matrix4();
  const position = new Vector3();
  const normal = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const front = new Vector3(0, 0, 1);
  const color = new Color();

  function update(
    state: CubeState,
    preview: { move: CubeMove; angle: number } | null,
  ): void {
    const unit = 3 / state.order;
    const center = (state.order - 1) / 2;
    const axis = new Vector3();
    if (preview) {
      axis.setComponent(preview.move.axis, 1);
      rotation.makeRotationAxis(axis, preview.angle);
    }
    let sticker = 0;
    state.cubies.forEach((cubie, bodyIndex) => {
      const rotating =
        preview && cubie.position[preview.move.axis] === preview.move.layer;
      position
        .fromArray(cubie.position)
        .addScalar(-center)
        .multiplyScalar(unit);
      quaternion.identity();
      scale.setScalar(unit);
      matrix.compose(position, quaternion, scale);
      if (rotating) matrix.premultiply(rotation);
      bodies.setMatrixAt(bodyIndex, matrix);
      cubie.colors.forEach((face, faceIndex) => {
        if (face === null) return;
        normal.fromArray(NORMALS[faceIndex]);
        position
          .fromArray(cubie.position)
          .addScalar(-center)
          .addScaledVector(normal, 0.486)
          .multiplyScalar(unit);
        quaternion.setFromUnitVectors(front, normal);
        matrix.compose(position, quaternion, scale);
        if (rotating) matrix.premultiply(rotation);
        stickers.setMatrixAt(sticker, matrix);
        stickers.setColorAt(
          sticker,
          color.setHex(FACE_COLORS[FACES.indexOf(face)]),
        );
        hits[sticker++] = { cubie: bodyIndex, face: faceIndex };
      });
    });
    bodies.instanceMatrix.needsUpdate =
      stickers.instanceMatrix.needsUpdate = true;
    if (stickers.instanceColor) stickers.instanceColor.needsUpdate = true;
  }

  function select(move: CubeMove | null): void {
    outline.visible = move !== null;
    if (!move) return;
    outline.position
      .set(0, 0, 0)
      .setComponent(
        move.axis,
        ((move.layer - (initial.order - 1) / 2) * 3) / initial.order,
      );
    outline.scale
      .set(3.07, 3.07, 3.07)
      .setComponent(move.axis, (3 / initial.order) * 0.99);
  }

  update(initial, null);
  return {
    group,
    stickers,
    hits,
    labels,
    update,
    select,
    dispose() {
      bodies.dispose();
      stickers.dispose();
      bodyGeometry.dispose();
      stickerGeometry.dispose();
      edges.dispose();
      bodyMaterial.dispose();
      stickerMaterial.dispose();
      outlineBacking.dispose();
      outlineMaterial.dispose();
      for (const resource of labelResources) {
        resource.texture.dispose();
        resource.material.dispose();
      }
    },
  };
}
