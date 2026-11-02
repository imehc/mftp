/**
 * 传输任务的重试意图。
 *
 * 全局传输状态里不能保存捕获页面 setState 的闭包：任务比页面活得久，
 * 离开页面后重试必须仍然有意义。因此重试记录的是「做什么」，而不是
 * 「调用哪个函数」：
 * - `sftp-action`：SFTP 用例自身保留的模块动作，只依赖 IPC 参数，
 *   不调用页面的渲染回调。
 */
export type TransferRetryIntent = {
  kind: "sftp-action";
  run: () => Promise<void>;
};

export async function runTransferRetry(
  intent: TransferRetryIntent,
): Promise<void> {
  await intent.run();
}
