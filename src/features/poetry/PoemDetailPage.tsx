import { Link } from "@tanstack/react-router";
import ReadingSettingsPopover from "./components/ReadingSettingsPopover";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowLeft } from "lucide-react";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import { Button } from "~/components/ui/button";
import type { PoetryTranslationMode } from "~/bindings";
import PoemDetail from "./components/PoemDetail";
import { usePoetryStore } from "./store/poetry-store";
import { usePoemRead } from "./hooks/use-poem-read";
import PoetryReadError from "./components/PoetryReadError";

/**
 * 直接访问 `/library/$id` 时的整页详情。桌面端的常规
 * 流程是在 `/library` 内部展示详情面板。
 */
export default function PoemDetailPage({
  uid,
  backQuery,
  initialTranslationMode,
  onTranslationModeChange,
}: {
  uid: string;
  backQuery?: string;
  initialTranslationMode?: PoetryTranslationMode;
  onTranslationModeChange?: (mode: PoetryTranslationMode) => void;
}) {
  const { t } = useLingui();
  const fontSize = usePoetryStore((s) => s.fontSize);
  const lineHeight = usePoetryStore((s) => s.lineHeight);
  const setFontSize = usePoetryStore((s) => s.setFontSize);
  const setLineHeight = usePoetryStore((s) => s.setLineHeight);
  const { detail, error, loading, retry } = usePoemRead(uid);
  return (
    <main
      data-bottom-inset="scroll"
      className="ui-density-adaptive bg-background text-foreground flex h-full min-h-0 flex-col"
    >
      <ToolPageHeader
        showHome={false}
        title={detail?.title ?? <Trans>古诗词</Trans>}
        trailing={
          <ReadingSettingsPopover
            fontSize={fontSize}
            lineHeight={lineHeight}
            onFontSizeChange={setFontSize}
            onLineHeightChange={setLineHeight}
          />
        }
        leading={
          <Button variant="ghost" size="icon-sm" asChild>
            <Link
              aria-label={t`返回古诗词`}
              title={t`返回古诗词`}
              to="/library"
              search={{
                q: backQuery,
                poem: undefined,
              }}
            >
              <ArrowLeft data-icon="inline-start" />
            </Link>
          </Button>
        }
      />
      {error ? (
        <PoetryReadError error={error} onRetry={retry} />
      ) : !loading && !detail ? (
        <p className="text-muted-foreground p-4 text-center text-sm">
          <Trans>没有找到作品</Trans>
        </p>
      ) : (
        <PoemDetail
          settingsInHeader
          detail={detail}
          loading={loading}
          fontSize={fontSize}
          lineHeight={lineHeight}
          onFontSizeChange={setFontSize}
          onLineHeightChange={setLineHeight}
          initialTranslationMode={initialTranslationMode}
          onTranslationModeChange={onTranslationModeChange}
        />
      )}
    </main>
  );
}
