import { afterEach, expect, it } from "vitest";

import { ipcQuery, queryClient } from "~/lib/query-client";

import {
  directoryQuery,
  fileInfoQuery,
  forgetSessionQueries,
  runSftpWrite,
} from "./queries";

afterEach(() => queryClient.clear());

it("写入部分失败仍使源目标目录和属性过期，保留其他会话", async () => {
  const keys = [
    directoryQuery("a", "/source/").queryKey,
    directoryQuery("a", "/target").queryKey,
    fileInfoQuery("a", "/source/file").queryKey,
  ];
  keys.forEach((key) => queryClient.setQueryData(key, []));
  const other = directoryQuery("b", "/source").queryKey;
  queryClient.setQueryData(other, []);
  const error = new Error("Partial write");
  await expect(
    runSftpWrite("a", async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  for (const key of keys)
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false);
});

it("会话关闭后迟到的目录读取不恢复缓存", async () => {
  let finish!: (data: number[]) => void;
  const reading = queryClient
    .query(
      ipcQuery(
        ["ssh", "a", "directory", "/"],
        () =>
          new Promise<number[]>((resolve) => {
            finish = resolve;
          }),
      ),
    )
    .catch(() => undefined);
  forgetSessionQueries("a");
  finish([1]);
  await reading;
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
});
