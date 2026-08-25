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
 * Full-page detail for direct visits to `/library/$id`. The normal desktop
 * flow shows the detail pane inside `/library` instead.
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
    setDetail(null);
    setError(null);
    void poetryPoem(uid)
      .then((poem) => !cancelled && setDetail(poem))
      .catch((err) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [uid]);

  return (
    <main className="flex h-full flex-col bg-background text-foreground">
      <ToolPageHeader
        title={detail?.title ?? <Trans>古诗词</Trans>}
        trailing={
          <Button variant="ghost" size="xs" asChild>
            <Link to="/library" search={{ q: undefined, poem: undefined }}>
              <ArrowLeft data-icon="inline-start" />
              <Trans>返回古诗词</Trans>
            </Link>
          </Button>
        }
      />
      {error ? (
        <p className="flex-1 pt-10 text-center text-sm text-muted-foreground">
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
