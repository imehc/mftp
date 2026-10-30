import { Trans, useLingui } from "@lingui/react/macro";
import { CircleHelp } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";

/** 玩法说明的一节：标题下接自定义内容、段落或有序列表，三者可任意组合。 */
export interface GameHelpSection {
  title: ReactNode;
  /** 需要自定义排版的内容，例如规则示意图，直接渲染不额外包裹。 */
  content?: ReactNode;
  paragraphs?: readonly ReactNode[];
  items?: readonly ReactNode[];
}

/**
 * 所有小游戏共用的玩法说明入口。
 * 图标、文案、容器与排版在此锁定，游戏只提供 `name`、`summary` 与分节内容，
 * 避免每个游戏各自实现一套帮助弹窗导致入口位置与观感漂移。
 */
export function GameHelpDialog({
  name,
  summary,
  sections,
  children,
  open,
  onOpenChange,
}: {
  /** 已本地化的游戏名，标题统一呈现为「{游戏名}玩法」。 */
  name: ReactNode;
  /** 一句话目标，作为弹窗描述。 */
  summary: ReactNode;
  sections: readonly GameHelpSection[];
  /** 分节之后的额外内容，例如规则示意图。 */
  children?: ReactNode;
  /** 传入即为受控；触发器始终渲染。 */
  open?: boolean;
  onOpenChange?(open: boolean): void;
}) {
  const { t } = useLingui();
  const [uncontrolled, setUncontrolled] = useState(false);
  const controlled = open !== undefined;
  const label = t({ message: "玩法说明", comment: "小游戏标题栏的帮助按钮" });
  return (
    <Dialog
      open={controlled ? open : uncontrolled}
      onOpenChange={(next) => {
        if (!controlled) setUncontrolled(next);
        onOpenChange?.(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          density="adaptive"
          aria-label={label}
          title={label}
        >
          <CircleHelp />
        </Button>
      </DialogTrigger>
      <DialogLayoutContent placement="responsive-sheet">
        <DialogLayoutHeader>
          <DialogTitle>
            <Trans>{name}玩法</Trans>
          </DialogTitle>
          <DialogDescription>{summary}</DialogDescription>
        </DialogLayoutHeader>
        <DialogLayoutBody className="flex flex-col gap-4 text-sm leading-relaxed">
          {sections.map((section, index) => (
            <section key={index} className="flex flex-col gap-2">
              <h3 className="font-medium">{section.title}</h3>
              {section.content}
              {section.paragraphs?.map((paragraph, paragraphIndex) => (
                <p key={paragraphIndex}>{paragraph}</p>
              ))}
              {section.items ? (
                <ol className="flex list-decimal flex-col gap-2 pl-5">
                  {section.items.map((item, itemIndex) => (
                    <li key={itemIndex}>{item}</li>
                  ))}
                </ol>
              ) : null}
            </section>
          ))}
          {children}
        </DialogLayoutBody>
      </DialogLayoutContent>
    </Dialog>
  );
}
