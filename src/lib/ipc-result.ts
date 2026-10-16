import { toIpcError } from "~/lib/errors";

type CommandResult<T, E> =
  { status: "ok"; data: T } | { status: "error"; error: E };

export const unwrapCommand = async <T, E>(
  promise: Promise<CommandResult<T, E>>,
): Promise<T> => {
  try {
    const result = await promise;
    if (result.status === "ok") {
      return result.data;
    }
    throw toIpcError(result.error);
  } catch (error) {
    throw toIpcError(error);
  }
};

export const voidCommand = async <E>(
  promise: Promise<CommandResult<null, E>>,
): Promise<void> => {
  await unwrapCommand(promise);
};
