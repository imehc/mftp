import { Trans } from "@lingui/react/macro";
import { BookOpen, LoaderCircle, Tag } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useStore } from "zustand";

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

import { usePoetryReadingPosition } from "../hooks/use-poetry-reading-position";
import { usePoetrySpeech } from "../hooks/use-poetry-speech";
import { usePoetrySpeechFollow } from "../hooks/use-poetry-speech-follow";
import { poetryReadingSession } from "../reading-session";
import {
  type PoetryReadingView,
  resolvePoetryReadingView,
} from "../reading-view";
import { createSpeechDocument } from "../speech-document";
import { usePoetryStore } from "../store/poetry-store";
import {
  AuthorBioSheet,
  CollapsibleStrains,
  PoemAnnotationContent,
} from "./PoemAnnotations";
import PoetrySpeech from "./PoetrySpeech";
import PoetryTranslationSection from "./PoetryTranslationSection";
import ReadingControlsMobile from "./ReadingControls.mobile";
import ReadingModeTabs from "./ReadingModeTabs";

interface PoemDetailViewProps {
  settingsInHeader?: boolean;
  detail: PoemDetailModel | null;
  loading: boolean;
  fontSize: number;
  lineHeight: number;
  onFontSizeChange: (size: number) => void;
  onLineHeightChange: (height: number) => void;
  view?: PoetryReadingView;
  onViewChange?: (view: PoetryReadingView) => void;
  returnQuery?: string;
  returnPage?: "library" | "detail";
}

export default function PoemDetail({
  detail,
  loading,
  settingsInHeader = false,
  fontSize,
  lineHeight,
  onFontSizeChange,
  onLineHeightChange,
  view: controlledView,
  onViewChange,
  returnQuery,
  returnPage,
}: PoemDetailViewProps) {
  const narrow = !useDesktopLayout();
  const originalLabelId = useId();
  const preferredView = usePoetryStore((state) => state.readingView);
  const preferredReference = usePoetryStore((state) => state.referenceView);
  const setPreferredView = usePoetryStore((state) => state.setReadingView);
  const savedView = useStore(
    poetryReadingSession,
    (state) => state.entries.find((entry) => entry.uid === detail?.uid)?.view,
  );
  const savedReference = useStore(
    poetryReadingSession,
    (state) =>
      state.entries.find((entry) => entry.uid === detail?.uid)?.referenceView,
  );
  const strainsOpen = useStore(
    poetryReadingSession,
    (state) =>
      state.entries.find((entry) => entry.uid === detail?.uid)?.strainsOpen ??
      false,
  );
  const view = controlledView ?? savedView ?? preferredView;
  const referenceView =
    view === "original" ? (savedReference ?? preferredReference) : view;
  const activeView = narrow ? view : referenceView;
  const [translationReadyUid, setTranslationReadyUid] = useState<string>();
  const [bio, setBio] = useState<AuthorBio | null>(null);
  const [speechSettingsOpen, setSpeechSettingsOpen] = useState(false);
  const readingRoot = useRef<HTMLElement>(null);
  const readingViewport = useRef<HTMLDivElement>(null);
  const capturePosition = usePoetryReadingPosition({
    uid: loading ? undefined : detail?.uid,
    positionKey: narrow ? `mobile-${view}` : `desktop-${referenceView}`,
    ready:
      !loading &&
      !!detail &&
      (activeView !== "translation" || translationReadyUid === detail.uid),
    viewport: readingViewport,
  });
  const speechText = createSpeechDocument(loading ? null : detail);
  const speech = usePoetrySpeech(loading ? null : (detail?.uid ?? null));
  usePoetrySpeechFollow(
    readingRoot,
    readingViewport,
    speechText,
    speech.snapshot,
    speechSettingsOpen || Boolean(bio) || (narrow && view !== "original"),
  );
  const [prevUid, setPrevUid] = useState(detail?.uid);
  if (prevUid !== detail?.uid) {
    setPrevUid(detail?.uid);
    setBio(null);
    setSpeechSettingsOpen(false);
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
            <Trans comment="诗词详情页未选中作品时的引导，列表在左侧">
              从左侧选择
            </Trans>
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
      value={activeView}
      onValueChange={(value) => {
        const nextView = resolvePoetryReadingView(value);
        if (!nextView) return;
        capturePosition();
        poetryReadingSession.getState().update(detail.uid, {
          view: nextView,
          referenceView: nextView === "original" ? referenceView : nextView,
        });
        setPreferredView(nextView);
        onViewChange?.(nextView);
      }}
      className="ui-density-adaptive flex h-full min-h-0 flex-col gap-0"
    >
      {narrow ? (
        <ReadingControlsMobile
          settings={settings}
          settingsInHeader={settingsInHeader}
        />
      ) : null}
      <div
        ref={readingViewport}
        className="app-scroll-safe-end relative min-h-0 flex-1 overflow-y-auto px-4 md:px-6"
      >
        <article
          ref={readingRoot}
          className="mx-auto flex w-full max-w-prose flex-col gap-3 pt-3 pb-6 md:pt-4 md:pb-8"
        >
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
            <div className="flex flex-col gap-4">
              <header className="font-poetry flex flex-col items-center gap-2 text-center">
                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                  <span
                    id={originalLabelId}
                    className="text-muted-foreground text-xs"
                  >
                    <Trans>原文</Trans>
                  </span>
                  <PoetrySpeech
                    key={detail.uid}
                    speech={speech}
                    text={speechText}
                    onSettingsOpenChange={setSpeechSettingsOpen}
                  />
                </div>
                <h2
                  data-poetry-speech="title"
                  className="text-2xl font-semibold tracking-wide wrap-break-word"
                >
                  {detail.title}
                </h2>
                <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm">
                  {detail.dynasty ? (
                    <>
                      <span data-poetry-speech="dynasty">{detail.dynasty}</span>
                      <span aria-hidden>·</span>
                    </>
                  ) : null}
                  {detail.authorBio?.desc ? (
                    <button
                      data-poetry-speech="author"
                      type="button"
                      className="hover:underline"
                      onClick={() => setBio(detail.authorBio ?? null)}
                    >
                      {detail.author}
                    </button>
                  ) : (
                    <span data-poetry-speech="author">{detail.author}</span>
                  )}
                  {detail.rhythmic ? (
                    <Badge variant="outline">
                      <Tag aria-hidden />
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
              <div
                className="font-poetry flex flex-col gap-3 text-center wrap-break-word"
                style={{ fontSize: `${fontSize / 16}rem`, lineHeight }}
              >
                {detail.body.map((paragraph, index) => (
                  <p key={index} data-poetry-speech={`body-${index}`}>
                    {paragraph}
                  </p>
                ))}
              </div>
              <CollapsibleStrains
                strains={detail.strains}
                open={strainsOpen}
                onOpenChange={(open) =>
                  poetryReadingSession
                    .getState()
                    .update(detail.uid, { strainsOpen: open })
                }
              />
            </div>
          </TabsContent>
          {!narrow ? (
            <div className="flex flex-col gap-3">
              <Separator />
              <ReadingModeTabs desktop />
            </div>
          ) : null}
          <TabsContent
            value="annotations"
            forceMount
            hidden={activeView !== "annotations"}
          >
            <PoemAnnotationContent
              remark={annotation?.remark ?? ""}
              appreciation={annotation?.appreciation ?? ""}
              notes={detail.notes}
            />
          </TabsContent>
          {/* 三个面板保持挂载；切换只改变可见性，保留翻译订阅与编辑草稿。 */}
          <TabsContent
            value="translation"
            forceMount
            hidden={activeView !== "translation"}
          >
            <PoetryTranslationSection
              key={detail.uid}
              uid={detail.uid}
              {...settings}
              referenceTranslation={annotation?.translation}
              returnQuery={returnQuery}
              returnPage={returnPage}
              onReady={setTranslationReadyUid}
            />
          </TabsContent>
        </article>
      </div>
      <AuthorBioSheet bio={bio} onClose={() => setBio(null)} />
    </Tabs>
  );
}
