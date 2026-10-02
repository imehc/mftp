import { expect, test } from "vitest";
import { createPoller } from "~/lib/polling";

// 轮询原语的行为验收：慢读取不堆叠、触发合并、可见性暂停。
// 订阅注册与释放的验收见 event-subscription.test.ts。

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

test("慢读取不堆叠：同一时刻只有一次在途", async () => {
  let concurrent = 0;
  let peak = 0;
  let runs = 0;
  const poller = createPoller(
    async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      runs += 1;
      await sleep(25);
      concurrent -= 1;
    },
    { intervalMs: 5 },
  );
  await sleep(140);
  poller.stop();
  expect(runs, `轮询应重复运行，实际 ${runs} 次`).toBeGreaterThanOrEqual(2);
  expect(peak, "同一时刻只能有一次在途读取").toBe(1);
});

test("触发合并：未开始前只排一次，在途期间只补跑一次", async () => {
  const pending: Array<() => void> = [];
  let started = 0;
  const poller = createPoller(
    () => {
      started += 1;
      return new Promise<void>((resolve) => {
        pending.push(resolve);
      });
    },
    { intervalMs: 10_000, runImmediately: false },
  );
  poller.trigger();
  poller.trigger();
  await sleep(0);
  expect(started, "未开始前的重复触发只排一次").toBe(1);
  poller.trigger();
  poller.trigger();
  poller.trigger();
  pending.shift()?.();
  await sleep(5);
  expect(started, "在途期间的多次触发只补跑一次").toBe(2);
  pending.shift()?.();
  await sleep(5);
  expect(started, "补跑结束后不再重复").toBe(2);
  poller.stop();
  poller.stop();
  poller.trigger();
  await sleep(5);
  expect(started, "停止后不再运行").toBe(2);
});

test("可见性暂停：隐藏时停止，恢复时补跑，停止后移除监听", async () => {
  const listeners = new Set<() => void>();
  const fakeDocument = {
    hidden: false,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
  };
  const host = globalThis as unknown as Record<string, unknown>;
  host.document = fakeDocument;
  try {
    let runs = 0;
    const poller = createPoller(
      async () => {
        runs += 1;
      },
      { intervalMs: 5, pauseWhenHidden: true },
    );
    await sleep(40);
    const beforeHide = runs;
    expect(beforeHide, "可见时必须轮询").toBeGreaterThanOrEqual(1);
    fakeDocument.hidden = true;
    for (const listener of [...listeners]) listener();
    await sleep(40);
    expect(runs, "隐藏时不再轮询").toBe(beforeHide);
    fakeDocument.hidden = false;
    for (const listener of [...listeners]) listener();
    await sleep(10);
    expect(runs, "恢复可见后补跑一次").toBeGreaterThan(beforeHide);
    poller.stop();
    expect(listeners.size, "停止后必须移除可见性监听").toBe(0);
  } finally {
    delete host.document;
  }
});
