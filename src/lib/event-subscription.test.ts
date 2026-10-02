import { expect, test } from "vitest";
import {
  createSubscription,
  disposeSubscriptions,
  type Subscription,
} from "~/lib/event-subscription";

// 前端运行期公共原语的行为验收：订阅注册与释放的时序。
// 轮询相关的验收见 polling.test.ts。

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

test("注册在释放之后才完成时，晚到的解除函数必须立刻执行", async () => {
  let released = 0;
  let adopt: (dispose: () => void) => void = () => undefined;
  const subscription = createSubscription(
    () =>
      new Promise<() => void>((resolve) => {
        adopt = resolve;
      }),
  );
  subscription.dispose();
  adopt(() => {
    released += 1;
  });
  await subscription.ready;
  expect(released, "释放后完成的注册必须立刻解除").toBe(1);
});

test("ready 兑现后可解除，且 dispose 幂等", async () => {
  let released = 0;
  const subscription = createSubscription(async () => () => {
    released += 1;
  });
  await subscription.ready;
  subscription.dispose();
  subscription.dispose();
  expect(released, "dispose 必须幂等").toBe(1);
});

test("注册同步抛错时报告给 onError，ready 仍兑现且 dispose 不抛", async () => {
  const failures: unknown[] = [];
  const subscription = createSubscription(
    () => {
      throw new Error("register failed");
    },
    {
      onError: (error) => {
        failures.push(error);
      },
    },
  );
  await subscription.ready;
  expect(failures.length, "同步抛错必须报告给调用方").toBe(1);
  subscription.dispose();
});

test("注册异步拒绝时报告给 onError，不产生未处理的 Promise 拒绝", async () => {
  const failures: unknown[] = [];
  const subscription = createSubscription(
    () => Promise.reject(new Error("register rejected")),
    {
      onError: (error) => {
        failures.push(error);
      },
    },
  );
  await subscription.ready;
  expect(failures.length, "异步拒绝必须报告给调用方").toBe(1);
});

test("释放函数同步抛错或返回被拒绝的 Promise 都不冒泡", async () => {
  const subscription = createSubscription(async () => () => {
    throw new Error("release failed");
  });
  await subscription.ready;
  subscription.dispose();
  // Tauri 的解除函数声明为返回 void，运行时却可能返回 Promise（见
  // event-subscription 的说明），这里显式模拟这种被拒绝的异步解除。
  const rejectingDisposer = async () => {
    throw new Error("async release failed");
  };
  const asyncFailing = createSubscription(
    async () => rejectingDisposer as unknown as () => void,
  );
  await asyncFailing.ready;
  asyncFailing.dispose();
  await sleep(0);
});

test("顺序释放时单个失败不阻止其余清理", () => {
  const disposed: string[] = [];
  const failing: Subscription = {
    ready: Promise.resolve(),
    dispose: () => {
      throw new Error("release failed");
    },
  };
  const first: Subscription = {
    ready: Promise.resolve(),
    dispose: () => {
      disposed.push("first");
    },
  };
  const second: Subscription = {
    ready: Promise.resolve(),
    dispose: () => {
      disposed.push("second");
    },
  };
  disposeSubscriptions([failing, first, second]);
  expect(disposed).toStrictEqual(["first", "second"]);
});
