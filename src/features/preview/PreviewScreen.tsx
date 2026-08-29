import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { LoaderCircle } from "lucide-react";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import type { PreviewKind } from "~/lib/preview-kind";
import PreviewSurface from "./PreviewSurface";

export interface PreviewScreenProps {
  /** File name, shown in the header and used as the image alt text. */
  name: string;
  kind: PreviewKind;
  /** null while the caller is still resolving the URL. */
  url: string | null;
  error?: string | null;
  /** Status shown while the caller prepares a loadable URL. */
  loadingLabel?: ReactNode;
  /** Header right side (e.g. close / save-to-local). */
  trailing?: ReactNode;
  /** Status bar under the viewer (e.g. BT speed and peers). */
  footer?: ReactNode;
}

/**
 * Shared full-page preview: header + kind-driven viewer + optional status
 * bar. Any module can render this by resolving a URL for the file; the BT
 * module adds its own live-stats footer.
 */
export default function PreviewScreen({
  name,
  kind,
  url,
  error,
  loadingLabel,
  trailing,
  footer,
}: PreviewScreenProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ToolPageHeader title={name} trailing={trailing} />
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2.5 sm:p-3">
        {error ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-border p-4 text-center text-xs text-destructive">
            {error}
          </div>
        ) : url ? (
          <PreviewSurface key={url} url={url} name={name} kind={kind} />
        ) : (
          <div className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" />
            {loadingLabel ?? <Trans>加载中…</Trans>}
          </div>
        )}
        {footer}
      </div>
    </div>
  );
}
