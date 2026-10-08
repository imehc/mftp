import { Trans, useLingui } from "@lingui/react/macro";
import { ListFilter, Search } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "~/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useDesktopLayout } from "~/lib/use-desktop-layout";

import type { ActivityLogsController } from "./use-activity-logs";

function FilterSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Record<string, string>;
  disabled: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        density="adaptive"
        aria-label={label}
        className="w-full min-w-0"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {Object.entries(options).map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export default function LogFilters({
  controller: c,
}: {
  controller: ActivityLogsController;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const wide = useDesktopLayout();
  const filters: Array<{
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: Record<string, string>;
  }> = [
    {
      label: t`来源`,
      value: c.source,
      onChange: c.setSource,
      options: { all: t`全部来源`, ...c.sourceLabels },
    },
    {
      label: t`结果`,
      value: c.result,
      onChange: c.setResult,
      options: { all: t`全部结果`, ...c.resultLabels },
    },
    {
      label: t`时间`,
      value: c.range,
      onChange: c.setRange,
      options: { all: t`全部时间`, "7d": t`近 7 天` },
    },
  ];
  return (
    <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-2 md:px-4">
      <InputGroup className="min-w-0 flex-1">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          aria-label={t`搜索日志`}
          placeholder={t`搜索日志`}
          value={c.query}
          onChange={(e) => c.setQuery(e.target.value)}
        />
      </InputGroup>
      {wide ? (
        <div className="flex shrink-0 gap-2">
          {filters.map((filter) => (
            <FilterSelect key={filter.label} {...filter} disabled={c.busy} />
          ))}
        </div>
      ) : (
        <Button
          variant={
            c.source !== "all" || c.result !== "all" || c.range !== "all"
              ? "secondary"
              : "ghost"
          }
          size="icon-sm"
          density="adaptive"
          aria-label={t`筛选日志`}
          onClick={() => setOpen(true)}
        >
          <ListFilter />
        </Button>
      )}
      <Dialog open={open && !wide} onOpenChange={setOpen}>
        <DialogLayoutContent
          className="ui-density-adaptive md:max-w-sm"
          showCloseButton={false}
        >
          <DialogLayoutHeader showCloseButton>
            <DialogTitle>
              <Trans>筛选日志</Trans>
            </DialogTitle>
          </DialogLayoutHeader>
          <DialogLayoutBody>
            <FieldGroup>
              {filters.map((filter) => (
                <Field key={filter.label}>
                  <FieldLabel>{filter.label}</FieldLabel>
                  <FilterSelect {...filter} disabled={c.busy} />
                </Field>
              ))}
            </FieldGroup>
          </DialogLayoutBody>
        </DialogLayoutContent>
      </Dialog>
    </div>
  );
}
