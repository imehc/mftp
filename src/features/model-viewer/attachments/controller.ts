import type { ModelAttachment } from "~/bindings";
import { exportBlob } from "~/features/model-viewer/export/native-export";
import { type IpcError, toIpcError } from "~/lib/errors";
import {
  modelAttachmentAdd,
  modelAttachmentDelete,
  modelAttachmentList,
  modelAttachmentRead,
} from "~/lib/ipc";

import { modelError } from "../domain/errors";

function hasControl(value: string, text = false) {
  for (const char of value) {
    if (/\p{Cc}/u.test(char) && !(text && ["\n", "\r", "\t"].includes(char)))
      return true;
  }
  return false;
}

export function validateAttachment(name: string, bytes: Uint8Array) {
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (
    !name.trim() ||
    new TextEncoder().encode(name).length > 240 ||
    /[\\/:]/.test(name) ||
    hasControl(name) ||
    !bytes.length ||
    bytes.length > (extension === "pdf" ? 8 : 1) * 1024 * 1024 ||
    !["txt", "md", "pdf"].includes(extension ?? "")
  )
    throw modelError("attachment_invalid");
  if (extension === "pdf") {
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-")
      throw modelError("attachment_invalid");
    return null;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (hasControl(text, true)) throw modelError("attachment_invalid");
    return text;
  } catch {
    throw modelError("attachment_invalid");
  }
}

type State = {
  entries: ModelAttachment[] | null;
  selected: ModelAttachment | null;
  text: string | null;
  busy: boolean;
  error: IpcError | null;
  saved: boolean;
};

export class AttachmentController {
  private state: State = {
    entries: null,
    selected: null,
    text: null,
    busy: false,
    error: null,
    saved: false,
  };
  private listeners = new Set<() => void>();
  private alive = false;
  private generation = 0;
  private task: AbortController | null = null;
  constructor(
    private model: string,
    private changed: () => void,
  ) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  start() {
    this.alive = true;
    void this.refresh();
  }
  stop() {
    this.alive = false;
    this.generation++;
    this.task?.abort();
  }
  private async run(work: (signal: AbortSignal) => Promise<Partial<State>>) {
    if (!this.alive || this.state.busy) return;
    const task = new AbortController();
    const generation = this.generation;
    this.task = task;
    this.publish({ busy: true, error: null, saved: false });
    try {
      const patch = await work(task.signal);
      if (this.alive && generation === this.generation) this.publish(patch);
    } catch (error) {
      if (this.alive && generation === this.generation)
        this.publish({ error: toIpcError(error) });
    } finally {
      this.task = null;
      this.publish({ busy: false });
      // StrictMode 的重新挂载只能补读列表，不能自动重放已提交的写操作。
      if (this.alive && generation !== this.generation) void this.refresh();
    }
  }
  refresh() {
    return this.run(async () => ({
      entries: await modelAttachmentList(this.model),
    }));
  }
  add(file: File) {
    return this.run(async (signal) => {
      if (file.size > 8 * 1024 * 1024) throw modelError("attachment_invalid");
      const bytes = new Uint8Array(await file.arrayBuffer());
      signal.throwIfAborted();
      validateAttachment(file.name, bytes);
      await modelAttachmentAdd(this.model, file.name, Array.from(bytes));
      this.changed();
      signal.throwIfAborted();
      return { entries: await modelAttachmentList(this.model) };
    });
  }
  read(entry: ModelAttachment) {
    return this.run(async (signal) => {
      const bytes = new Uint8Array(
        await modelAttachmentRead(this.model, entry.id),
      );
      signal.throwIfAborted();
      return { selected: entry, text: validateAttachment(entry.name, bytes) };
    });
  }
  save(entry: ModelAttachment) {
    return this.run(async (signal) => {
      const bytes = new Uint8Array(
        await modelAttachmentRead(this.model, entry.id),
      );
      signal.throwIfAborted();
      validateAttachment(entry.name, bytes);
      // 规范后缀以匹配原生导出白名单；文件内容与附件原始字节保持一致。
      const extension = entry.name.split(".").at(-1)!.toLowerCase();
      const name = entry.name.replace(/\.[^.]+$/, `.${extension}`);
      const type = entry.kind === "pdf" ? "application/pdf" : "text/plain";
      const result = await exportBlob(
        new Blob([bytes], { type }),
        name,
        "save",
        signal,
      );
      return { saved: result === "saved" };
    });
  }
  remove(entry: ModelAttachment) {
    return this.run(async (signal) => {
      await modelAttachmentDelete(this.model, entry.id);
      this.changed();
      signal.throwIfAborted();
      return {
        entries: await modelAttachmentList(this.model),
        selected: null,
        text: null,
      };
    });
  }
}
