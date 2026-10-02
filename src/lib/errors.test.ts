import { expect, test } from "vitest";
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { AppError, LanTransferTask } from "~/bindings";
import { describeError, IpcError, toIpcError } from "~/lib/errors";
import {
  customErrorMessages,
  unknownErrorMessage,
} from "~/lib/errors/messages";
import {
  appDataReset,
  btBrowseFiles,
  btList,
  lanTransferTasks,
  sftpDownload,
} from "~/lib/ipc";
import { useTransfersStore } from "~/store/transfers";
import { applyBtTaskEvent } from "~/features/bt/task-events";

const custom: AppError = {
  kind: "custom",
  code: "bt:file_not_in_task",
  message: "File does not belong to this download task",
  args: { path: "目录/文件.txt" },
};
const external: AppError = {
  kind: "external",
  code: "io:permission_denied",
  message: "Permission denied",
  args: { osCode: "13" },
};
const descriptor = customErrorMessages["bt:file_not_in_task"];
const retained = toIpcError(custom);
// 实际 BT 事件与 IPC 边界用例共用的任务标识。
const taskHash = "a".repeat(40);
const transferId = `bt:${taskHash}`;
i18n.load("zh-CN", { [descriptor.id]: ["文件不属于此下载任务"] });
i18n.load("en", {
  [descriptor.id]: ["File outside task: ", ["path"]],
  [unknownErrorMessage.id]: ["Unknown error"],
});
i18n.activate("zh-CN");

// 该测试只验证错误，不依赖传输阶段文案；提供编译后的最小词条避免回退警告。
for (const phase of [msg`准备中`, msg`失败`, msg`完成`, msg`已取消`]) {
  expect(phase.id).toBeTruthy();
  for (const locale of ["zh-CN", "en"])
    i18n.load(locale, { [phase.id]: ["status"] });
}

test("归一化 AppError 并保持协议结构", () => {
  expect(descriptor.id).toBeTruthy();
  expect(unknownErrorMessage.id).toBeTruthy();
  for (const payload of [custom, external]) {
    for (const input of [payload, JSON.stringify(payload)]) {
      const error = toIpcError(input);
      expect(error.payload).toStrictEqual(payload);
      expect(toIpcError(error)).toBe(error);
      expect(String(error).trim()).toBeTruthy();
      expect(!String(error).includes("[object Object]")).toBeTruthy();
    }
  }
  expect(String(retained)).toBe("文件不属于此下载任务");
  i18n.activate("en");
  expect(describeError(retained)).toBe("File outside task: 目录/文件.txt");
  expect(retained.payload.message).toBe(custom.message);
  expect(describeError(external)).toBe("Permission denied");
});

test("BT 事件经传输 store 后保留协议并随语言切换", () => {
  // 实际 BT 事件经过传输 store 后仍保留协议，既有任务也能随语言切换。
  for (const payload of [custom, external]) {
    useTransfersStore.getState().start(transferId, "BT test", { source: "bt" });
    applyBtTaskEvent({
      kind: "package-failed",
      infoHash: taskHash,
      error: payload,
    });
    const item = useTransfersStore.getState().transfers[0];
    expect(item.status).toBe("error");
    expect(item.error).toStrictEqual(payload);
    expect(describeError(item.error)).toBe(describeError(payload));
  }
  useTransfersStore.getState().setControlError(transferId, retained);
  expect(useTransfersStore.getState().transfers[0].controlError).toStrictEqual(
    custom,
  );
  i18n.activate("zh-CN");
  expect(
    describeError(useTransfersStore.getState().transfers[0].controlError),
  ).toBe("文件不属于此下载任务");
  i18n.activate("en");
  expect(
    describeError(useTransfersStore.getState().transfers[0].controlError),
  ).toBe("File outside task: 目录/文件.txt");
  useTransfersStore
    .getState()
    .finish(transferId, "error", "historical transfer error");
  expect(useTransfersStore.getState().transfers[0].error?.code).toBe(
    "legacy:raw",
  );
  for (const kind of ["package-completed", "cancelled"] as const) {
    applyBtTaskEvent({ kind, infoHash: taskHash });
    expect(useTransfersStore.getState().transfers[0].error).toBe(undefined);
    expect(useTransfersStore.getState().transfers[0].controlError).toBe(
      undefined,
    );
  }
});

test("toIpcError 复制 payload 且不信任异常输入", () => {
  const mutable = structuredClone(custom);
  const copied = toIpcError(mutable);
  mutable.args.path = "changed";
  expect(copied.payload.args.path).toBe(custom.args.path);
  expect(toIpcError("ordinary error").payload.code).toBe("legacy:raw");
  expect(toIpcError(new Error("native failure")).payload.code).toBe(
    "frontend:error",
  );
  expect(toIpcError(new Error("native failure")).payload.message).toBe(
    "native failure",
  );

  for (const input of [
    null,
    undefined,
    42,
    "",
    "   ",
    {},
    [],
    { token: "secret-token" },
    { ...custom, kind: "invalid" },
    { ...custom, args: { invalid: 42 } },
    { ...custom, args: [] },
    { ...custom, code: "" },
    { ...custom, message: " " },
    { kind: "custom", code: custom.code, message: custom.message },
    Object.defineProperty({}, "kind", {
      get() {
        throw new Error("secret-token");
      },
    }),
  ]) {
    const error = toIpcError(input);
    expect(error.payload.code).toBe("frontend:unknown");
    expect(!String(error).includes("secret-token")).toBeTruthy();
    expect(String(error).trim()).toBeTruthy();
  }
  const malformed = JSON.stringify({ ...custom, args: [] });
  expect(toIpcError(malformed).payload.code).toBe("legacy:raw");
  expect(toIpcError(malformed).payload.message).toBe(malformed);
  expect(describeError({ ...custom, code: "future:code" })).toBe(
    custom.message,
  );
});

test("生成绑定与 IPC 边界保留完整错误", async () => {
  // 原生 IPC mock 仍经过自动生成的 commands 和统一 unwrap，验证真实调用路径。
  Object.defineProperty(globalThis, "window", {
    value: {},
    configurable: true,
  });
  try {
    // SFTP 错误经生成绑定与传输状态保存后，参数和分类不随语言切换改变。
    const sizeMessage = customErrorMessages["sftp:size_mismatch"];
    expect(sizeMessage.id).toBeTruthy();
    i18n.load("zh-CN", {
      [sizeMessage.id]: ["实际 ", ["actual"], "，预期 ", ["expected"]],
    });
    i18n.load("en", {
      [sizeMessage.id]: ["Actual ", ["actual"], ", expected ", ["expected"]],
    });
    const sizeError: AppError = {
      kind: "custom",
      code: "sftp:size_mismatch",
      message: "File size mismatch",
      args: { actual: "12", expected: "24", path: "目录/文件.bin" },
    };
    mockIPC((command, args) => {
      expect(command).toBe("sftp_download");
      expect((args as { sessionId?: string })?.sessionId).toBe("session");
      throw sizeError;
    });
    await expect(
      sftpDownload("session", "/remote", "/local", "sftp-test"),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(IpcError);
      const ipcError = error as IpcError;
      expect(ipcError.payload).toStrictEqual(sizeError);
      useTransfersStore.getState().start("sftp-test", "SFTP test");
      useTransfersStore.getState().finish("sftp-test", "error", error);
      const stored = useTransfersStore
        .getState()
        .transfers.find((item) => item.id === "sftp-test")?.error;
      expect(stored).toStrictEqual(sizeError);
      i18n.activate("zh-CN");
      expect(describeError(stored)).toBe("实际 12，预期 24");
      i18n.activate("en");
      expect(describeError(stored)).toBe("Actual 12, expected 24");
      expect(stored).toStrictEqual(sizeError);
      return true;
    });
    clearMocks();
    // 维护拒绝同样经过生成命令与公共解析层，切换语言不改写原始错误。
    for (const [code, chinese, english] of [
      [
        "app:maintenance_in_progress",
        "应用正在清理数据，请稍后重试",
        "Application data cleanup is in progress. Please try again later.",
      ],
      [
        "app:operations_busy",
        "当前操作尚未完成，请稍后重试清理数据",
        "An operation is still running. Please try cleaning up later.",
      ],
    ] as const) {
      const message = customErrorMessages[code];
      expect(message.id).toBeTruthy();
      i18n.load("zh-CN", { [message.id]: [chinese] });
      i18n.load("en", { [message.id]: [english] });
      const payload: AppError = {
        kind: "custom",
        code,
        message: "Safe diagnostic",
        args: {},
      };
      mockIPC(() => {
        throw payload;
      });
      await expect(appDataReset()).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(IpcError);
        const ipcError = error as IpcError;
        expect(ipcError.payload).toStrictEqual(payload);
        i18n.activate("zh-CN");
        expect(describeError(error)).toBe(chinese);
        i18n.activate("en");
        expect(describeError(error)).toBe(english);
        expect(ipcError.payload).toStrictEqual(payload);
        return true;
      });
      clearMocks();
    }
    for (const failure of [
      custom,
      external,
      JSON.stringify(custom),
      new Error("native failure"),
    ]) {
      mockIPC(() => {
        throw failure;
      });
      await expect(
        btBrowseFiles("a".repeat(40), "../outside"),
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(IpcError);
        expect((error as IpcError).payload).toStrictEqual(
          toIpcError(failure).payload,
        );
        return true;
      });
      clearMocks();
    }
    const listing = {
      current: { name: "root", path: "", isDir: true, size: 0 },
      entries: [],
    };
    mockIPC(() => listing);
    expect(await btBrowseFiles("a".repeat(40), null)).toStrictEqual(listing);
    mockIPC(() => [{ infoHash: taskHash, status: "Error", error: custom }]);
    expect((await btList())[0].error).toStrictEqual(custom);
    // LAN 任务经实际生成绑定读取后保留完整错误，渲染语言变化不改写任务。
    const lanMessage = customErrorMessages["lan:transfer_incomplete"];
    expect(lanMessage.id).toBeTruthy();
    i18n.load("zh-CN", { [lanMessage.id]: ["局域网传输意外结束，请重试"] });
    i18n.load("en", {
      [lanMessage.id]: ["LAN transfer ended unexpectedly. Please try again."],
    });
    const lanError: AppError = {
      kind: "custom",
      code: "lan:transfer_incomplete",
      message: "LAN transfer worker ended before completion",
      args: { file: "目录/文件.bin" },
    };
    for (const payload of [lanError, external]) {
      const task: LanTransferTask = {
        id: "lan-task",
        direction: "upload",
        fileName: "文件.bin",
        ip: "127.0.0.1",
        status: "failed",
        transferred: 3,
        total: 10,
        startedAt: 0,
        updatedAt: 1,
        error: payload,
      };
      mockIPC((command) => {
        expect(command).toBe("lan_transfer_tasks");
        return [task];
      });
      const [received] = await lanTransferTasks();
      expect(received.error).toStrictEqual(payload);
      i18n.activate("zh-CN");
      expect(describeError(received.error)).toBe(
        payload.kind === "custom"
          ? "局域网传输意外结束，请重试"
          : payload.message,
      );
      i18n.activate("en");
      expect(describeError(received.error)).toBe(
        payload.kind === "custom"
          ? "LAN transfer ended unexpectedly. Please try again."
          : payload.message,
      );
      expect(received.error).toStrictEqual(payload);
    }
  } finally {
    clearMocks();
    Reflect.deleteProperty(globalThis, "window");
  }
});
