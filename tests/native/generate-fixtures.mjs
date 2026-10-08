import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const output = process.argv[2];
if (!output) throw new Error("Provide an empty fixture directory");
fs.mkdirSync(output, { recursive: true });
if (fs.readdirSync(output).length)
  throw new Error("Fixture directory must be empty");
const manifest = {};
const write = (name, value) => {
  const bytes = Buffer.from(value);
  fs.writeFileSync(path.join(output, name), bytes, { flag: "wx" });
  manifest[name] = {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};
// 自建四面体，不依赖外部模型许可或下载；副本用于验证源文件始终不被修改。
const vertices = new Float32Array([
  0, 1, 0, -1, -1, 1, 1, -1, 1, 0, 1, 0, 1, -1, 1, 0, -1, -1, 0, 1, 0, 0, -1,
  -1, -1, -1, 1, -1, -1, 1, 0, -1, -1, 1, -1, 1,
]);
const binary = Buffer.from(vertices.buffer);
const model = {
  asset: { version: "2.0", generator: "MFTP native QA fixture" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: "QA tetrahedron" }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
  materials: [
    {
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorFactor: [0.2, 0.65, 0.95, 1],
        metallicFactor: 0,
        roughnessFactor: 0.5,
      },
    },
  ],
  buffers: [{ byteLength: binary.length }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: binary.length, target: 34962 },
  ],
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: 12,
      type: "VEC3",
      min: [-1, -1, -1],
      max: [1, 1, 1],
    },
  ],
};
const raw = Buffer.from(JSON.stringify(model));
const json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 0x20);
raw.copy(json);
const glb = Buffer.alloc(12 + 8 + json.length + 8 + binary.length);
glb.writeUInt32LE(0x46546c67, 0);
glb.writeUInt32LE(2, 4);
glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(json.length, 12);
glb.writeUInt32LE(0x4e4f534a, 16);
json.copy(glb, 20);
glb.writeUInt32LE(binary.length, 20 + json.length);
glb.writeUInt32LE(0x004e4942, 24 + json.length);
binary.copy(glb, 28 + json.length);
write("qa-tetrahedron.glb", glb);
write("qa-tetrahedron.bin", binary);
model.buffers[0].uri = "qa-tetrahedron.bin";
write("qa-tetrahedron.gltf", JSON.stringify(model, null, 2));
write(
  "qa-environment.hdr",
  Buffer.concat([
    Buffer.from("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 4\n"),
    Buffer.from(Array.from({ length: 8 }, () => [160, 190, 220, 129]).flat()),
  ]),
);
write("qa-note.txt", "MFTP native QA\n中文附件重启恢复测试\n");
write(
  "qa-untrusted.md",
  '# QA attachment\n<script>throw new Error("must remain text")</script>\n![remote](https://invalid.example/image.png)\n',
);
// 使用自包含 PDF 对象和 xref，避免验收夹具依赖系统打印或外部 PDF 库。
const content = "BT /F1 18 Tf 50 780 Td (MFTP native QA attachment) Tj ET";
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
];
let pdf = "%PDF-1.4\n";
const offsets = [0];
for (const [index, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const start = Buffer.byteLength(pdf);
pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
for (const offset of offsets.slice(1))
  pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
write("qa-attachment.pdf", pdf);
fs.writeFileSync(
  path.join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  `Created ${Object.keys(manifest).length} fixtures in ${path.resolve(output)}`,
);
