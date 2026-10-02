import { useState, type ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronDown, History, Search, X } from "lucide-react";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "~/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "~/components/ui/dropdown-menu";
import type { PoetrySearchScope } from "~/types";
interface SearchBarProps {
  input: string;
  scope: PoetrySearchScope;
  history: string[];
  /** 在范围标签右侧渲染（如合集筛选）。 */
  filterSlot?: ReactNode;
  onInputChange: (value: string) => void;
  onScopeChange: (scope: PoetrySearchScope) => void;
  onSubmit?: (query: string) => void;
  onRemoveHistory?: (query: string) => void;
  onClearHistory?: () => void;
}
const SCOPES: Array<{
  value: PoetrySearchScope;
  label: React.ReactNode;
}> = [
  {
    value: "all",
    label: <Trans>全部</Trans>,
  },
  {
    value: "title",
    label: <Trans>标题</Trans>,
  },
  {
    value: "author",
    label: <Trans>作者</Trans>,
  },
  {
    value: "body",
    label: <Trans>正文</Trans>,
  },
];
export default function SearchBar({
  input,
  scope,
  history,
  filterSlot,
  onInputChange,
  onScopeChange,
  onSubmit,
  onRemoveHistory,
  onClearHistory,
}: SearchBarProps) {
  const { t } = useLingui();
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-1.5 md:px-5">
      <div className="relative min-w-0 flex-1">
        <InputGroup className="pointer-coarse:h-11">
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
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
          />
          {input ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={t`清空搜索`}
                onClick={() => {
                  onInputChange("");
                  setHistoryOpen(false);
                }}
              >
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
          <InputGroupAddon align="inline-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <InputGroupButton aria-label={t`搜索范围`}>
                  <span>
                    {SCOPES.find((item) => item.value === scope)?.label}
                  </span>
                  <ChevronDown data-icon="inline-end" />
                </InputGroupButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={scope}
                  onValueChange={(value) =>
                    onScopeChange(value as PoetrySearchScope)
                  }
                >
                  {SCOPES.map((item) => (
                    <DropdownMenuRadioItem key={item.value} value={item.value}>
                      {item.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </InputGroupAddon>
        </InputGroup>
        {historyOpen && history.length > 0 ? (
          <div className="border-border bg-popover absolute inset-x-0 top-full z-20 mt-1 rounded-md border p-1 shadow-md">
            <div className="text-muted-foreground flex items-center justify-between px-2 py-1 text-[11px]">
              <span className="flex items-center gap-1">
                <History className="size-3" aria-hidden />
                <Trans>搜索历史</Trans>
              </span>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  className="hover:text-foreground"
                  onClick={() => {
                    onClearHistory?.();
                    setHistoryOpen(false);
                  }}
                >
                  <Trans>清空</Trans>
                </button>
                <button
                  type="button"
                  className="hover:text-foreground"
                  onClick={() => setHistoryOpen(false)}
                >
                  <Trans context="action">关闭</Trans>
                </button>
              </span>
            </div>
            {history.map((name) => (
              <div key={name} className="flex items-center gap-0.5">
                <button
                  type="button"
                  className="hover:bg-accent min-w-0 flex-1 truncate rounded-sm px-2 py-1.5 text-left text-sm"
                  onClick={() => {
                    onInputChange(name);
                    onSubmit?.(name);
                    setHistoryOpen(false);
                  }}
                >
                  {name}
                </button>
                <button
                  type="button"
                  // 变量名用 name，以复用目录里已有的 `删除 {name}` 而非新增近似条目。
                  aria-label={t`删除 ${name}`}
                  className="text-muted-foreground hover:text-foreground shrink-0 rounded-sm p-1"
                  onClick={() => onRemoveHistory?.(name)}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {filterSlot}
    </div>
  );
}
