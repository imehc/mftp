import { isTauri } from "@tauri-apps/api/core";
import { Image as TauriImage } from "@tauri-apps/api/image";
import {
  readImage as readNativeImage,
  writeImage as writeNativeImage,
} from "@tauri-apps/plugin-clipboard-manager";

import { toIpcError } from "~/lib/errors";
import { isMobilePlatform } from "~/lib/platform";

import { noteError } from "./note-document";
import type { LoadedNoteImage } from "./note-image-cache";
import { validateNoteImageDimensions } from "./note-image-input";

async function rgbaToPng(
  rgba: Uint8Array,
  width: number,
  height: number,
  name: string,
): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable for image clipboard");
    context.putImageData(
      new ImageData(new Uint8ClampedArray(rgba), width, height),
      0,
      0,
    );
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(new File([blob], name, { type: "image/png" }));
        else reject(new Error("Image clipboard encoding failed"));
      }, "image/png");
    });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function canReadNoteClipboardImage(): boolean {
  return isTauri() && !isMobilePlatform();
}

export async function readNoteClipboardImage(): Promise<File | null> {
  if (!canReadNoteClipboardImage()) return null;
  try {
    const image = await readNativeImage();
    try {
      const size = await image.size();
      validateNoteImageDimensions(size.width, size.height);
      const rgba = await image.rgba();
      if (rgba.length !== size.width * size.height * 4)
        throw noteError("todo:note_image_unsupported");
      return await rgbaToPng(rgba, size.width, size.height, "pasted-image.png");
    } finally {
      await image.close();
    }
  } catch (error) {
    throw toIpcError(error);
  }
}

async function pngBlob(value: LoadedNoteImage): Promise<Blob> {
  if (value.blob.type === "image/png") return value.blob;
  const image = new globalThis.Image();
  image.src = value.url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = value.image.width;
  canvas.height = value.image.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable for image clipboard");
    context.drawImage(image, 0, 0);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Image clipboard encoding failed"));
      }, "image/png"),
    );
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function canCopyNoteImage() {
  return (
    canReadNoteClipboardImage() ||
    (typeof ClipboardItem !== "undefined" &&
      typeof navigator.clipboard?.write === "function")
  );
}

async function copyNoteImageWeb(value: LoadedNoteImage): Promise<void> {
  // 在用户手势内直接调用 write，图片转码作为 ClipboardItem 的延迟值交给 WebKit。
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": pngBlob(value) }),
  ]);
}

async function copyNoteImageNative(value: LoadedNoteImage): Promise<void> {
  const bitmap = await createImageBitmap(value.blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable for image clipboard");
    const { width, height } = bitmap;
    context.drawImage(bitmap, 0, 0);
    const rgba = new Uint8Array(context.getImageData(0, 0, width, height).data);
    const image = await TauriImage.new(rgba, width, height);
    try {
      await writeNativeImage(image);
    } finally {
      await image.close();
    }
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function copyNoteImage(value: LoadedNoteImage): Promise<void> {
  if (canReadNoteClipboardImage()) await copyNoteImageNative(value);
  else await copyNoteImageWeb(value);
}
