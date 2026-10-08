import { Trans, useLingui } from "@lingui/react/macro";
import { Pencil, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";

import type { RowActionsProps } from "./types";

export default function RowActionsDesktop(props: RowActionsProps) {
  const { t } = useLingui();
  return (
    <div className="flex shrink-0 items-center gap-1">
      {!props.current ? (
        <Button
          density="adaptive"
          variant="outline"
          size="sm"
          disabled={props.disabled}
          onClick={props.onSelect}
        >
          <Trans>选用</Trans>
        </Button>
      ) : null}
      <Button
        density="adaptive"
        variant="ghost"
        size="icon-sm"
        disabled={props.disabled}
        onClick={props.onEdit}
        aria-label={t`编辑`}
      >
        <Pencil />
      </Button>
      <Button
        density="adaptive"
        variant="ghost"
        size="icon-sm"
        disabled={props.disabled || !props.canDelete}
        onClick={props.onDelete}
        aria-label={t`删除`}
        title={!props.canDelete ? t`至少保留一项` : t`删除`}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
