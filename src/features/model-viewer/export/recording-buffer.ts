import { modelError } from "../domain/errors";

const PAGE_BYTES = 64 * 1024;
export const RECORDING_MAX_BYTES = 64 * 1024 * 1024;

/** 支持容器回写头部，按实际使用分配内存，并限制最终文件地址空间。 */
export class RecordingBuffer {
  private pages: Uint8Array<ArrayBuffer>[] = [];
  private length = 0;

  write(data: Uint8Array, position: number) {
    const end = position + data.length;
    if (
      !Number.isSafeInteger(position) ||
      position < 0 ||
      end > RECORDING_MAX_BYTES
    )
      throw modelError("recording_limit");
    for (let offset = 0; offset < data.length;) {
      const address = position + offset;
      const index = Math.floor(address / PAGE_BYTES);
      const within = address % PAGE_BYTES;
      const count = Math.min(PAGE_BYTES - within, data.length - offset);
      const page = (this.pages[index] ??= new Uint8Array(PAGE_BYTES));
      page.set(data.subarray(offset, offset + count), within);
      offset += count;
    }
    this.length = Math.max(this.length, end);
  }

  blob(type: string) {
    if (!this.length) throw modelError("recording_failed");
    const parts: Uint8Array<ArrayBuffer>[] = [];
    for (let position = 0; position < this.length; position += PAGE_BYTES) {
      const count = Math.min(PAGE_BYTES, this.length - position);
      parts.push(
        (
          this.pages[position / PAGE_BYTES] ?? new Uint8Array(PAGE_BYTES)
        ).subarray(0, count),
      );
    }
    return new Blob(parts, { type });
  }

  clear() {
    this.pages = [];
    this.length = 0;
  }
}
