const formats = { glb: "GLB", gltf: "glTF", fbx: "FBX" } as const;

export type ModelExtension = keyof typeof formats;

export const modelExtensions = Object.keys(formats) as ModelExtension[];

export const modelFileAccept = [
  ...modelExtensions.map((extension) => `.${extension}`),
  ".bin",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".ktx2",
  "model/gltf-binary",
  "model/gltf+json",
].join(",");

export function modelExtension(name: string): ModelExtension | null {
  if (!name.includes(".")) return null;
  const extension = name.split(".").pop()?.toLowerCase();
  return extension && Object.hasOwn(formats, extension)
    ? (extension as ModelExtension)
    : null;
}

export function modelFormat(name: string) {
  const extension = modelExtension(name);
  return extension ? formats[extension] : "";
}
