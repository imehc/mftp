import { Trans } from "@lingui/react/macro";

import { Button } from "~/components/ui/button";
import { describeError } from "~/lib/errors";
import type { AppError } from "~/types";

export default function PoetryReadError({
  error,
  onRetry,
}: {
  error: AppError;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex min-w-0 flex-col items-center gap-3 p-4 text-center text-sm"
    >
      <p>
        <Trans>读取失败</Trans>
      </p>
      <p className="text-muted-foreground max-w-full text-xs break-words">
        {describeError(error)}
      </p>
      <Button variant="outline" density="adaptive" onClick={onRetry}>
        <Trans comment="重新读取失败的诗词内容">重试</Trans>
      </Button>
    </div>
  );
}
