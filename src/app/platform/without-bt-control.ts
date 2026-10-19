import type { BtControlAction } from "~/bindings";
import { IpcError } from "~/lib/errors";

export async function controlBtTransfer(
  _id: string,
  _action: BtControlAction,
  _deleteFiles: boolean,
) {
  throw new IpcError({
    kind: "custom",
    code: "bt:task_not_found",
    message: "BT is unavailable on this platform",
    args: {},
  });
}
