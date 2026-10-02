import { beforeEach, expect, test, vi } from "vitest";
import { i18n } from "@lingui/core";
import { useTransfersStore } from "~/store/transfers";
import { createTransferActions } from "./transfer-actions";
import * as ipc from "~/lib/ipc";

vi.mock("~/lib/ipc", () => ({
  btControl: vi.fn(),
  sftpCancelTransfer: vi.fn(),
  sftpPauseTransfer: vi.fn(),
  sftpResumeTransfer: vi.fn(),
}));
vi.mock("./retry", () => ({ runTransferRetry: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  i18n.loadAndActivate({ locale: "zh-CN", messages: {} });
  useTransfersStore.setState({
    transfers: [],
    dismissed: new Set(),
    runtimeError: undefined,
  });
});
test("BT 取消仍通过原命令并标记结束", async () => {
  useTransfersStore.getState().start("bt:hash", "test");
  await createTransferActions().cancelTransfer(
    useTransfersStore.getState().transfers[0],
  );
  expect(ipc.btControl).toHaveBeenCalledWith("hash", "Cancel", false);
  expect(useTransfersStore.getState().transfers[0].status).toBe("cancelled");
});
test("SFTP 取消等待实际结束事件，不提前宣告完成", async () => {
  useTransfersStore.getState().start("sftp", "test");
  await createTransferActions().cancelTransfer(
    useTransfersStore.getState().transfers[0],
  );
  expect(ipc.sftpCancelTransfer).toHaveBeenCalledWith("sftp");
  expect(useTransfersStore.getState().transfers[0].status).toBe("running");
  expect(useTransfersStore.getState().transfers[0].cancelling).toBe(true);
});
test("操作失败恢复待处理状态并保留完整错误", async () => {
  const error = {
    kind: "external" as const,
    code: "io:operation",
    message: "Unavailable",
    args: {},
  };
  vi.mocked(ipc.sftpCancelTransfer).mockRejectedValue(error);
  useTransfersStore.getState().start("sftp", "test");
  await createTransferActions().cancelTransfer(
    useTransfersStore.getState().transfers[0],
  );
  expect(useTransfersStore.getState().transfers[0].cancelling).toBe(false);
  expect(useTransfersStore.getState().transfers[0].controlError).toEqual(error);
});
test("两个面板用旧快照重复暂停只发起一次请求", async () => {
  let finish!: () => void;
  vi.mocked(ipc.sftpPauseTransfer).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  useTransfersStore.getState().start("sftp", "test");
  const snapshot = useTransfersStore.getState().transfers[0];
  const first = createTransferActions().togglePause(snapshot);
  await createTransferActions().togglePause(snapshot);
  expect(ipc.sftpPauseTransfer).toHaveBeenCalledTimes(1);
  finish();
  await first;
  expect(useTransfersStore.getState().transfers[0].paused).toBe(true);
  expect(useTransfersStore.getState().transfers[0].controlPending).toBe(false);
});

test("已从列表移除的旧任务不能再次触发操作", async () => {
  useTransfersStore.getState().start("sftp", "test");
  const snapshot = useTransfersStore.getState().transfers[0];
  useTransfersStore.getState().dismiss("sftp");
  await createTransferActions().cancelTransfer(snapshot);
  expect(ipc.sftpCancelTransfer).not.toHaveBeenCalled();
});
