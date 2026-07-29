import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { Percent, Ruler } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "~/components/ui/input-group";
import {
  DIMENSION_MAX,
  type DimensionMode,
  type ResizeMethod,
} from "~/features/media-compress/resize/resize";
import { cn } from "~/lib/utils";

export const DIMENSION_MODES: readonly DimensionMode[] = [
  "exact",
  "width",
  "height",
  "longest",
  "shortest",
];

export function isDimensionMode(value: string): value is DimensionMode {
  return (DIMENSION_MODES as readonly string[]).includes(value);
}

export function dimensionModeLabel(mode: DimensionMode): ReactNode {
  switch (mode) {
    case "exact":
      return <Trans>固定尺寸</Trans>;
    case "width":
      return <Trans>固定宽度</Trans>;
    case "height":
      return <Trans>固定高度</Trans>;
    case "longest":
      return <Trans>固定最大边</Trans>;
    case "shortest":
      return <Trans>固定最小边</Trans>;
  }
}

export function parseDimensionInput(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.round(parsed);
}

interface ResizeMethodTabsProps {
  value: ResizeMethod;
  onChange: (method: ResizeMethod) => void;
  disabled?: boolean;
}

export function ResizeMethodTabs({
  value,
  onChange,
  disabled,
}: ResizeMethodTabsProps) {
  const methods: readonly {
    id: ResizeMethod;
    icon: ReactNode;
    label: ReactNode;
  }[] = [
    {
      id: "ratio",
      icon: <Percent className="size-3.5" />,
      label: <Trans>按比例</Trans>,
    },
    {
      id: "dimension",
      icon: <Ruler className="size-3.5" />,
      label: <Trans>按尺寸</Trans>,
    },
  ];

  return (
    <div
      role="tablist"
      className="inline-flex self-start rounded-md border border-border bg-muted/40 p-0.5"
    >
      {methods.map((method) => {
        const active = method.id === value;
        return (
          <Button
            key={method.id}
            type="button"
            role="tab"
            aria-selected={active}
            size="xs"
            variant={active ? "secondary" : "ghost"}
            disabled={disabled}
            className={cn("gap-1 px-2.5", active && "shadow-sm")}
            onClick={() => onChange(method.id)}
          >
            {method.icon}
            {method.label}
          </Button>
        );
      })}
    </div>
  );
}

interface DimensionInputProps {
  label: ReactNode;
  value: string;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (value: string) => void;
}

export function DimensionInput({
  label,
  value,
  disabled,
  ariaLabel,
  onChange,
}: DimensionInputProps) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          type="number"
          inputMode="numeric"
          min={1}
          max={DIMENSION_MAX}
          step={1}
          value={value}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(event) => onChange(event.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>px</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  );
}
