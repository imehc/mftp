import { commands, type ModelExportAction } from "~/bindings";
import { unwrapCommand, voidCommand } from "~/lib/ipc-result";

export const modelExportBegin = (name: string, size: number) =>
  unwrapCommand(commands.modelExportBegin(name, size));
export const modelExportWrite = (id: string, offset: number, bytes: number[]) =>
  voidCommand(commands.modelExportWrite(id, offset, bytes));
export const modelExportPresent = (id: string, action: ModelExportAction) =>
  unwrapCommand(commands.modelExportPresent(id, action));
export const modelExportCancel = (id: string) =>
  voidCommand(commands.modelExportCancel(id));
export const modelExportClose = (id: string) =>
  voidCommand(commands.modelExportClose(id));

export const modelAttachmentList = (model: string) =>
  unwrapCommand(commands.modelAttachmentList(model));
export const modelAttachmentAdd = (
  model: string,
  name: string,
  bytes: number[],
) => unwrapCommand(commands.modelAttachmentAdd(model, name, bytes));
export const modelAttachmentRead = (model: string, id: string) =>
  unwrapCommand(commands.modelAttachmentRead(model, id));
export const modelAttachmentDelete = (model: string, id: string) =>
  voidCommand(commands.modelAttachmentDelete(model, id));

export const modelEnvironmentBegin = (name: string, size: number) =>
  unwrapCommand(commands.modelEnvironmentBegin(name, size));
export const modelEnvironmentWrite = (
  id: string,
  offset: number,
  bytes: number[],
) => voidCommand(commands.modelEnvironmentWrite(id, offset, bytes));
export const modelEnvironmentCommit = (id: string) =>
  voidCommand(commands.modelEnvironmentCommit(id));
export const modelEnvironmentCurrent = () =>
  unwrapCommand(commands.modelEnvironmentCurrent());
export const modelEnvironmentRead = (id: string, offset: number) =>
  unwrapCommand(commands.modelEnvironmentRead(id, offset));
export const modelEnvironmentAbort = (id: string) =>
  voidCommand(commands.modelEnvironmentAbort(id));
export const modelEnvironmentClear = () =>
  voidCommand(commands.modelEnvironmentClear());

export const modelSystemPoll = () => unwrapCommand(commands.modelSystemPoll());
