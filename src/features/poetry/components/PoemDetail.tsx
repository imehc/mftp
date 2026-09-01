import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  BookOpen,
  ChevronDown,
  LoaderCircle,
  Music,
  Settings2,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Slider } from "~/components/ui/slider";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { cn } from "~/lib/utils";
import type { AuthorBio, PoemDetail as PoemDetailModel } from "~/types";
interface PoemDetailViewProps {
  detail: PoemDetailModel | null;
  loading: boolean;
  fontSize: number;
  lineHeight: number;
  onFontSizeChange: (size: number) => void;
  onLineHeightChange: (height: number) => void;
}
function AnnotationSection({
  title,
  body,
}: {
  title: React.ReactNode;
  body: string;
}) {
  if (!body.trim()) return null;
  return (
    <section className="space-y-1">
      <h3 className="text-muted-foreground text-sm font-medium">{title}</h3>
      <p className="text-sm leading-relaxed whitespace-pre-line">{body}</p>
    </section>
  );
}
function CollapsibleStrains({ strains }: { strains: string[] }) {
  const [open, setOpen] = useState(false);
  if (strains.length === 0) return null;
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
      >
        <ChevronDown
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
          aria-hidden
        />
        <Trans>平仄</Trans>
      </button>
      {open ? (
        <div className="text-muted-foreground mt-1 font-mono text-xs leading-relaxed">
          {strains.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
export function AuthorBioSheet({
  bio,
  onClose,
}: {
  bio: AuthorBio | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={bio !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-[360px] sm:max-w-[85vw]">
        <SheetHeader>
          <SheetTitle>{bio?.name}</SheetTitle>
          <SheetDescription>{bio?.dynasty}</SheetDescription>
        </SheetHeader>
        <p className="px-4 pb-6 text-sm leading-loose whitespace-pre-line">
          {bio?.desc || <Trans>暂无作者小传。</Trans>}
        </p>
      </SheetContent>
    </Sheet>
  );
}
interface ReadingSettingsProps {
  fontSize: number;
  lineHeight: number;
  onFontSizeChange: (size: number) => void;
  onLineHeightChange: (height: number) => void;
}
export function ReadingSettingsPopover(props: ReadingSettingsProps) {
  const [open, setOpen] = useState(false);
  const { t } = useLingui();
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t`阅读设置`}
        title={t`阅读设置`}
        onClick={() => setOpen((value) => !value)}
      >
        <Settings2 />
      </Button>
      {open ? (
        <div className="border-border bg-popover absolute top-full right-0 z-20 mt-1 w-56 space-y-3 rounded-md border p-3 shadow-md">
          <label className="text-muted-foreground block space-y-1.5 text-xs">
            <span>{t`字号`}</span>
            <Slider
              value={[props.fontSize]}
              min={14}
              max={26}
              step={1}
              onValueChange={([size]) => props.onFontSizeChange(size)}
              aria-label={t`字号`}
            />
          </label>
          <label className="text-muted-foreground block space-y-1.5 text-xs">
            <span>{t`行距`}</span>
            <Slider
              value={[props.lineHeight]}
              min={1.5}
              max={2.6}
              step={0.1}
              onValueChange={([height]) => props.onLineHeightChange(height)}
              aria-label={t`行距`}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
export default function PoemDetail({
  detail,
  loading,
  fontSize,
  lineHeight,
  onFontSizeChange,
  onLineHeightChange,
}: PoemDetailViewProps) {
  const [bio, setBio] = useState<AuthorBio | null>(null);
  // 当诗词切换时在渲染期间重置作者简介（React 的“在 prop 变化时
  // 调整 state”模式），而不是用 effect。
  const [prevUid, setPrevUid] = useState(detail?.uid);
  if (prevUid !== detail?.uid) {
    setPrevUid(detail?.uid);
    setBio(null);
  }
  if (loading) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center">
        <LoaderCircle className="size-5 animate-spin" aria-hidden />
      </div>
    );
  }
  if (!detail) {
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
  }
  const annotation = detail.annotation;
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-2 px-5 pt-4">
        <div className="min-w-0 space-y-1.5">
          <h2 className="text-lg font-semibold tracking-wide">
            {detail.title}
          </h2>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {detail.author ? (
              detail.authorBio && detail.authorBio.desc ? (
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() => setBio(detail.authorBio ?? null)}
                >
                  {detail.author}
                </button>
              ) : (
                <span>{detail.author}</span>
              )
            ) : null}
            {detail.dynasty ? <span>{detail.dynasty}</span> : null}
            {detail.rhythmic ? (
              <Badge variant="outline">
                <Music
                  data-icon="inline-start"
                  className="size-3"
                  aria-hidden
                />
                {detail.rhythmic}
              </Badge>
            ) : null}
            {annotation?.hasAudio ? (
              <Badge variant="outline">
                <Trans>有朗诵</Trans>
              </Badge>
            ) : null}
          </div>
        </div>
        <ReadingSettingsPopover
          fontSize={fontSize}
          lineHeight={lineHeight}
          onFontSizeChange={onFontSizeChange}
          onLineHeightChange={onLineHeightChange}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        <div
          key={detail.uid}
          className="fade-in animate-in mx-auto max-w-prose space-y-4 pt-4 duration-200"
          style={{
            fontSize,
            lineHeight,
          }}
        >
          <div>
            {detail.body.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
          <CollapsibleStrains strains={detail.strains} />

          {annotation ? (
            <div className="border-border space-y-4 border-t pt-4">
              <AnnotationSection
                title={<Trans>注释</Trans>}
                body={annotation.remark}
              />
              <AnnotationSection
                title={<Trans>译文</Trans>}
                body={annotation.translation}
              />
              <AnnotationSection
                title={<Trans>赏析</Trans>}
                body={annotation.appreciation}
              />
            </div>
          ) : null}

          {detail.notes.length > 0 ? (
            <div className="border-border border-t pt-4">
              <h3 className="text-muted-foreground mb-1 text-sm font-medium">
                <Trans>注释</Trans>
              </h3>
              <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-sm leading-relaxed">
                {detail.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
      <AuthorBioSheet bio={bio} onClose={() => setBio(null)} />
    </div>
  );
}
