import { Trans } from "@lingui/react/macro";
import { BookOpen, LoaderCircle, Music } from "lucide-react";
import { useId, useState } from "react";

import type { PoetryTranslationMode } from "~/bindings";
import { Badge } from "~/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Separator } from "~/components/ui/separator";
import { Tabs, TabsContent } from "~/components/ui/tabs";
import { useDesktopLayout } from "~/lib/use-desktop-layout";
import type { AuthorBio, PoemDetail as PoemDetailModel } from "~/types";

import {
  AnnotationSection,
  AuthorBioSheet,
  CollapsibleStrains,
} from "./PoemAnnotations";
import PoetryTranslationSection from "./PoetryTranslationSection";
import ReadingControlsDesktop from "./ReadingControls.desktop";
import ReadingControlsMobile from "./ReadingControls.mobile";

interface PoemDetailViewProps {
  settingsInHeader?: boolean;
  detail: PoemDetailModel | null;
  loading: boolean;
  fontSize: number;
  lineHeight: number;
  onFontSizeChange: (size: number) => void;
  onLineHeightChange: (height: number) => void;
  initialTranslationMode?: PoetryTranslationMode;
  onTranslationModeChange?: (mode: PoetryTranslationMode) => void;
}

export default function PoemDetail({
  detail,
  loading,
  settingsInHeader = false,
  fontSize,
  lineHeight,
  onFontSizeChange,
  onLineHeightChange,
  initialTranslationMode,
  onTranslationModeChange,
}: PoemDetailViewProps) {
  const narrow = !useDesktopLayout();
  const originalLabelId = useId();
  const translationLabelId = useId();
  const [view, setView] = useState(
    initialTranslationMode ? "translation" : "original",
  );
  const [bio, setBio] = useState<AuthorBio | null>(null);
  const [prevUid, setPrevUid] = useState(detail?.uid);
  if (prevUid !== detail?.uid) {
    setPrevUid(detail?.uid);
    setBio(null);
    setView(initialTranslationMode ? "translation" : "original");
  }
  if (loading)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center">
        <LoaderCircle className="size-5 animate-spin" aria-hidden />
      </div>
    );
  if (!detail)
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookOpen />
          </EmptyMedia>
          <EmptyTitle>
            <Trans>尚未选择作品</Trans>
          </EmptyTitle>
          <EmptyDescription>
            <Trans>从左侧列表选择一篇，或试试每日一诗。</Trans>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  const settings = {
    fontSize,
    lineHeight,
    onFontSizeChange,
    onLineHeightChange,
  };
  const annotation = detail.annotation;
  return (
    <Tabs
      value={view}
      onValueChange={setView}
      className="ui-density-adaptive flex h-full min-h-0 flex-col gap-0"
    >
      {narrow ? (
        <ReadingControlsMobile
          settings={settings}
          settingsInHeader={settingsInHeader}
        />
      ) : null}
      <div className="app-scroll-safe-end min-h-0 flex-1 overflow-y-auto px-4 md:px-6">
        <article className="mx-auto flex w-full max-w-prose flex-col gap-6 py-8 md:py-10">
          <header className="font-poetry flex flex-col items-center gap-3 text-center">
            <span
              id={originalLabelId}
              className="text-muted-foreground text-xs"
            >
              {!narrow || view === "original" ? (
                <Trans>原文</Trans>
              ) : (
                <Trans>译文</Trans>
              )}
            </span>
            <h2 className="text-2xl font-semibold tracking-wide break-words">
              {detail.title}
            </h2>
            <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm">
              {detail.authorBio?.desc ? (
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => setBio(detail.authorBio ?? null)}
                >
                  {detail.author}
                </button>
              ) : (
                <span>{detail.author}</span>
              )}
              {detail.dynasty ? <span>· {detail.dynasty}</span> : null}
              {detail.rhythmic ? (
                <Badge variant="outline">
                  <Music aria-hidden />
                  {detail.rhythmic}
                </Badge>
              ) : null}
              {annotation?.hasAudio ? (
                <Badge variant="outline">
                  <Trans>有朗诵</Trans>
                </Badge>
              ) : null}
            </div>
          </header>
          <TabsContent
            value="original"
            forceMount
            hidden={narrow && view !== "original"}
            {...(!narrow && {
              role: "region",
              "aria-labelledby": originalLabelId,
              tabIndex: undefined,
            })}
          >
            <div
              className="font-poetry flex flex-col gap-3 text-center break-words"
              style={{ fontSize: `${fontSize / 16}rem`, lineHeight }}
            >
              {detail.body.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
            <div className="mt-6 flex flex-col gap-4">
              <CollapsibleStrains strains={detail.strains} />
              {annotation ? (
                <>
                  <AnnotationSection
                    title={<Trans>注释</Trans>}
                    body={annotation.remark}
                  />
                  <AnnotationSection
                    title={<Trans>赏析</Trans>}
                    body={annotation.appreciation}
                  />
                </>
              ) : null}
              {detail.notes.length ? (
                <section className="flex flex-col gap-1">
                  <h3 className="text-muted-foreground text-sm font-medium">
                    <Trans>注释</Trans>
                  </h3>
                  <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-4 text-sm leading-relaxed">
                    {detail.notes.map((note, index) => (
                      <li key={index}>{note}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          </TabsContent>
          {/* 桌面连续显示原文和译文；跨断点只切换可见性与语义，保留翻译任务订阅和编辑草稿。 */}
          <TabsContent
            value="translation"
            forceMount
            hidden={narrow && view !== "translation"}
            {...(!narrow && {
              role: "region",
              "aria-labelledby": translationLabelId,
              tabIndex: undefined,
            })}
          >
            {!narrow ? (
              <div className="mb-4 flex flex-col gap-4">
                <Separator />
                <h3
                  id={translationLabelId}
                  className="text-muted-foreground text-sm font-medium"
                >
                  <Trans>译文</Trans>
                </h3>
              </div>
            ) : null}
            <PoetryTranslationSection
              key={detail.uid}
              uid={detail.uid}
              {...settings}
              referenceTranslation={annotation?.translation}
              initialMode={initialTranslationMode}
              onModeChange={onTranslationModeChange}
            />
          </TabsContent>
          {!narrow ? (
            <ReadingControlsDesktop
              settings={settings}
              settingsInHeader={settingsInHeader}
            />
          ) : null}
        </article>
      </div>
      <AuthorBioSheet bio={bio} onClose={() => setBio(null)} />
    </Tabs>
  );
}
