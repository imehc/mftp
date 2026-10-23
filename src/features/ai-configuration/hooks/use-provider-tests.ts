import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { AiConfigurationView, AiProviderView } from "~/bindings";
import { describeError } from "~/lib/errors";
import { aiProviderTest, aiProviderTestStreaming } from "~/lib/ipc";

import { useAiConfiguration } from "../store";

export function useProviderTests(
  view: AiConfigurationView | null,
  provider: AiProviderView | undefined,
) {
  const { t } = useLingui();
  const [testingId, setTestingId] = useState<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function test() {
    if (!view || !provider) return;
    const target = { expectedRevision: view.revision, providerId: provider.id };
    const command = view.streamingEnabled
      ? aiProviderTestStreaming
      : aiProviderTest;
    await useAiConfiguration.getState().execute(async () => {
      setTestingId(provider.id);
      try {
        // 页面关闭后尚未发出的请求不再启动；已发出的 worker 仍由后端管理。
        if (!mounted.current) return;
        // 测试记录由后端写入应用级活动面板，页面不再持有作用域。
        const report = await command(target);
        // 报告自身携带失败原因，不会抛出；没有反馈等于测试看起来没发生。
        if (!mounted.current) return;
        if (report.error) {
          toast.error(t`测试失败`, {
            description: describeError(report.error, t),
          });
        } else {
          toast.success(t`测试通过`);
        }
      } finally {
        if (mounted.current) setTestingId(null);
      }
    });
  }

  return {
    test,
    testing: testingId !== null && testingId === provider?.id,
  };
}
