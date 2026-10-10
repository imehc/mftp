/** 游戏各自持有资源实例；合成音色与缓存继续由调用方管理。 */
export function createGameAudioResources() {
  let context: AudioContext | null = null;
  const active = new Map<AudioScheduledSourceNode, () => void>();

  function unlock(): void {
    if (typeof window === "undefined" || !window.AudioContext) return;
    try {
      context ??= new window.AudioContext();
      void context.resume().catch(() => {
        // 自动播放策略可能拒绝解锁，下一次用户操作可以再次尝试。
      });
    } catch {
      // 不支持音频或资源不足时，游戏仍可继续。
    }
  }

  function track(
    source: AudioScheduledSourceNode,
    ...nodes: AudioNode[]
  ): void {
    const cleanup = () => {
      source.onended = null;
      active.delete(source);
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };

    source.onended = cleanup;
    active.set(source, cleanup);
  }

  function stop(): void {
    // 包括尚未开始的延迟音符；不留下跨对局的定时器。
    for (const [source, cleanup] of active) {
      source.stop();
      cleanup();
    }
  }

  function dispose(): void {
    stop();
    const previous = context;
    context = null;
    if (previous && previous.state !== "closed") {
      void previous.close().catch(() => {
        // 页面清理不等待浏览器关闭音频设备，也不产生未处理的拒绝。
      });
    }
  }

  return {
    unlock,
    track,
    stop,
    dispose,
    // 读取不会分配上下文，防止页面释放后的迟到音效重新打开设备。
    getContext: () => (context?.state === "closed" ? null : context),
  };
}
