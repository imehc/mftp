import { useState, type ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { History, Search, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import type { PoetrySearchScope } from "~/types";

interface SearchBarProps {
  input: string;
  scope: PoetrySearchScope;
  history: string[];
  /** Rendered right-aligned next to the scope tabs (e.g. collection filter). */
  filterSlot?: ReactNode;
  onInputChange: (value: string) => void;
  onScopeChange: (scope: PoetrySearchScope) => void;
  onSubmit?: (query: string) => void;
}

const SCOPES: Array<{ value: PoetrySearchScope; label: React.ReactNode }> = [
  { value: "all", label: <Trans>全部</Trans> },
  { value: "title", label: <Trans>标题</Trans> },
  { value: "author", label: <Trans>作者</Trans> },
  { value: "body", label: <Trans>正文</Trans> },
];

export default function SearchBar({
  input,
  scope,
  history,
  filterSlot,
  onInputChange,
  onScopeChange,
  onSubmit,
}: SearchBarProps) {
  const { t } = useLingui();
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2 px-3 pt-2">
      <div className="flex items-center gap-2">
        {filterSlot}
        <div className="relative min-w-0 flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={input}
          onChange={(event) => {
            onInputChange(event.target.value);
            setHistoryOpen(false);
          }}
          onFocus={() => setHistoryOpen(history.length > 0)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && input.trim()) {
              onSubmit?.(input.trim());
              setHistoryOpen(false);
            }
            if (event.key === "Escape") setHistoryOpen(false);
          }}
          placeholder={t`标题、作者、正文`}
          aria-label={t`搜索诗词`}
          className="pr-8 pl-8"
        />
        {input ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t`清空搜索`}
            onClick={() => {
              onInputChange("");
              setHistoryOpen(false);
            }}
            className="absolute top-1/2 right-1.5 -translate-y-1/2"
          >
            <X />
          </Button>
        ) : null}
        {historyOpen ? (
          <div className="absolute inset-x-0 top-full z-20 mt-1 rounded-md border border-border bg-popover p-1 shadow-md">
            <div className="flex items-center justify-between px-2 py-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <History className="size-3" aria-hidden />
                <Trans>搜索历史</Trans>
              </span>
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => setHistoryOpen(false)}
              >
                <Trans context="action">关闭</Trans>
              </button>
            </div>
            {history.map((item) => (
              <button
                key={item}
                type="button"
                className="block w-full truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onInputChange(item);
                  onSubmit?.(item);
                  setHistoryOpen(false);
                }}
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Tabs
          value={scope}
          onValueChange={(value) => onScopeChange(value as PoetrySearchScope)}
        >
          <TabsList className="h-7 w-fit">
            {SCOPES.map((item) => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                className="text-xs"
              >
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
