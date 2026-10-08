import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";

import { Field, FieldLabel } from "~/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "~/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  DIMENSION_MAX,
  type DimensionMode,
  type ResizeMethod,
} from "~/features/media-compress/resize/resize";

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
  const { t } = useLingui();
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next === "ratio" || next === "dimension") onChange(next);
      }}
      disabled={disabled}
      variant="outline"
      aria-label={t`缩放方式`}
    >
      <ToggleGroupItem value="ratio">
        <Trans>按比例</Trans>
      </ToggleGroupItem>
      <ToggleGroupItem value="dimension">
        <Trans>按尺寸</Trans>
      </ToggleGroupItem>
    </ToggleGroup>
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
