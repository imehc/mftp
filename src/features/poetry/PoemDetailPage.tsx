import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trans } from "@lingui/react/macro";
import { ArrowLeft } from "lucide-react";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import { poetryPoem } from "~/lib/ipc";
import type { PoemDetail as PoemDetailModel } from "~/types";
import PoemDetail from "./components/PoemDetail";
import { usePoetryStore } from "./store/poetry-store";

/**
 * 直接访问 `/library/$id` 时的整页详情。桌面端的常规
 * 流程是在 `/library` 内部展示详情面板。
 */
export default function PoemDetailPage({ uid }: { uid: string }) {
  const fontSize = usePoetryStore((s) => s.fontSize);
  const lineHeight = usePoetryStore((s) => s.lineHeight);
  const setFontSize = usePoetryStore((s) => s.setFontSize);
  const setLineHeight = usePoetryStore((s) => s.setLineHeight);
  const [detail, setDetail] = useState<PoemDetailModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // 用微任务延后，使重置发生在 effect 函数体之外。
    queueMicrotask(() => {
      setDetail(null);
      setError(null);
    });
    void poetryPoem(uid)
      .then((poem) => !cancelled && setDetail(poem))
      .catch((err) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [uid]);
  return (
    <main className="bg-background text-foreground flex h-full flex-col">
      <ToolPageHeader
        title={detail?.title ?? <Trans>古诗词</Trans>}
        trailing={
          <Button variant="ghost" size="xs" asChild>
            <Link
              to="/library"
              search={{
                q: undefined,
                poem: undefined,
              }}
            >
              <ArrowLeft data-icon="inline-start" />
              <Trans>返回古诗词</Trans>
            </Link>
          </Button>
        }
      />
      {error ? (
        <p className="text-muted-foreground flex-1 pt-10 text-center text-sm">
          {error}
        </p>
      ) : (
        <PoemDetail
          detail={detail}
          loading={detail === null}
          fontSize={fontSize}
          lineHeight={lineHeight}
          onFontSizeChange={setFontSize}
          onLineHeightChange={setLineHeight}
        />
      )}
    </main>
  );
}
