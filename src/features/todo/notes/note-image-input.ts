import { imageDimensionsFromStream } from "image-dimensions";

import { noteError, TODO_NOTE_INPUT_LIMIT } from "./note-document";

export const TODO_NOTE_MAX_PIXELS = 12_000_000;
export const TODO_NOTE_MAX_EDGE = 8_192;

export function validateNoteImageDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    throw noteError("todo:note_image_invalid");
  if (width > TODO_NOTE_MAX_EDGE || height > TODO_NOTE_MAX_EDGE)
    throw noteError("todo:note_image_dimensions");
  if (width * height > TODO_NOTE_MAX_PIXELS)
    throw noteError("todo:note_image_pixels");
}

export async function validateNoteImageInput(file: File) {
  if (!file.size || file.size > TODO_NOTE_INPUT_LIMIT)
    throw noteError("todo:note_image_limit");
  // 仅解析文件头，读到尺寸即取消流；超限图不解码像素、不展开为 Base64 或发送 IPC。
  const dimensions = await imageDimensionsFromStream(file.stream());
  if (!dimensions) throw noteError("todo:note_image_invalid");
  if (!["png", "jpeg", "webp"].includes(dimensions.type))
    throw noteError("todo:note_image_unsupported");
  validateNoteImageDimensions(dimensions.width, dimensions.height);
}
