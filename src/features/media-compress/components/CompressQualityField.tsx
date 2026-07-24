import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { Field, FieldLabel } from "~/components/ui/field";
import { Slider } from "~/components/ui/slider";
import { cn } from "~/lib/utils";

interface CompressQualityFieldProps {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (value: number) => void;
  /** Replaces the right-end “high quality” label when set. */
  rightHint?: ReactNode;
  className?: string;
}

export function CompressQualityField({
  value,
  min,
  max,
  step,
  disabled,
  ariaLabel,
  onChange,
  rightHint,
  className,
}: CompressQualityFieldProps) {
  return (
    <Field className={cn("min-w-0", className)}>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>
          <Trans>压缩程度</Trans>
        </FieldLabel>
        <span className="text-xs tabular-nums text-muted-foreground">
          {value}%
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(values) => {
          const next = values[0];
          if (typeof next === "number") onChange(next);
        }}
        disabled={disabled}
        aria-label={ariaLabel}
        className="mt-1"
      />
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          <Trans>更小</Trans>
        </span>
        {rightHint ?? (
          <span>
            <Trans>高质量</Trans>
          </span>
        )}
      </div>
    </Field>
  );
}
