import { frontendError, IpcError } from "~/lib/errors";

export function invalidAction(message: string): IpcError {
  return new IpcError(frontendError("junqi:invalid_action", message));
}
