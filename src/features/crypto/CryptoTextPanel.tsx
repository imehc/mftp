import { Plural } from "@lingui/react/macro";
import type { ReactNode } from "react";

import { Textarea } from "~/components/ui/textarea";

export default function CryptoTextPanel({
  id,
  label,
  value,
  onChange,
  placeholder,
  actions,
  error,
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange?: (value: string) => void;
  placeholder: string;
  actions: ReactNode;
  error?: string | null;
}) {
  return (
    <section className="border-border bg-card flex min-h-72 min-w-0 flex-col overflow-hidden rounded-lg border md:min-h-96">
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className="text-muted-foreground text-xs">
          <Plural value={value.length} one="# 个字符" other="# 个字符" />
        </span>
      </div>
      <Textarea
        id={id}
        value={value}
        readOnly={!onChange}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className="min-h-48 flex-1 resize-y rounded-none border-0 bg-transparent p-3 font-mono text-sm focus-visible:ring-inset"
      />
      {error ? (
        <p
          id={`${id}-error`}
          role="status"
          className="text-destructive px-3 pb-3 text-xs"
        >
          {error}
        </p>
      ) : null}
      <div className="border-border flex items-center justify-end gap-2 border-t p-2 max-md:[&>button]:flex-1">
        {actions}
      </div>
    </section>
  );
}
