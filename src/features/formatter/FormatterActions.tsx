import { Trans, useLingui } from "@lingui/react/macro";
import { useRef } from "react";
import { Ellipsis } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import type { FormatterController } from "./use-formatter";

export function FormatterActions({
  controller: c,
}: {
  controller: FormatterController;
}) {
  const { t } = useLingui();
  const searchOnClose = useRef(false);
  const empty = !c.value.trim();
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        density="adaptive"
        onClick={c.handleFormat}
        disabled={empty || !c.isDocValid}
      >
        <Trans>格式化</Trans>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            density="adaptive"
            aria-label={t`更多操作`}
            title={t`更多操作`}
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="ui-density-adaptive"
          onCloseAutoFocus={(event) => {
            if (!searchOnClose.current) return;
            event.preventDefault();
            searchOnClose.current = false;
            c.handleSearch();
          }}
        >
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={c.handleMinify}
              disabled={empty || !c.isDocValid || !c.language.minify}
            >
              <Trans>压缩</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={c.handleValidate}
              disabled={empty || !c.language.validate}
            >
              <Trans>校验</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => c.handleSortKeys("asc")}
              disabled={empty || !c.isDocValid || !c.language.sortKeys}
            >
              <Trans>键升序</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => c.handleSortKeys("desc")}
              disabled={empty || !c.isDocValid || !c.language.sortKeys}
            >
              <Trans>键降序</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={c.handleEscape}
              disabled={!c.value || !c.language.escape}
            >
              <Trans>添加转义</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={c.handleUnescape}
              disabled={!c.value || !c.language.unescape}
            >
              <Trans>移除转义</Trans>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => {
                searchOnClose.current = true;
              }}
              disabled={!c.value}
            >
              <Trans>搜索</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => c.replaceDoc("")}
              disabled={!c.value}
            >
              <Trans>清空</Trans>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
