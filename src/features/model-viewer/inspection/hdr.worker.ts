import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

self.onmessage = async (event: MessageEvent<Blob>) => {
  try {
    if (event.data.size > 32 * 1024 * 1024)
      throw new Error("HDR budget exceeded");
    const bytes = await event.data.arrayBuffer();
    const header = new TextDecoder().decode(bytes.slice(0, 16384));
    const dimensions = header.match(/(?:^|\n)-Y (\d+) \+X (\d+)\r?\n/);
    if (
      !dimensions ||
      Number(dimensions[1]) > 1024 ||
      Number(dimensions[2]) > 2048
    )
      throw new Error("HDR dimensions unsupported");
    const result = new HDRLoader().parse(bytes);
    if (!result.data) throw new Error("Invalid HDR pixels");
    self.postMessage({ result }, { transfer: [result.data.buffer] });
  } catch {
    self.postMessage({ error: true });
  }
};
