import { Trans } from "@lingui/react/macro";
import { useEffect, useSyncExternalStore } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { describeError } from "~/lib/errors";

import type { ModelViewerRuntime } from "../runtime/viewer";
import {
  clearSystemError,
  subscribeSystem,
  systemSnapshot,
} from "../system/inbox";

export function ModelSystemStatus({
  runtime,
}: {
  runtime: ModelViewerRuntime | null;
}) {
  const state = useSyncExternalStore(subscribeSystem, systemSnapshot);
  useEffect(() => {
    runtime?.budget.setThermal(state.thermal);
  }, [runtime, state.thermal]);
  if (!state.error) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>
        {describeError(state.error)}
        <Button variant="ghost" onClick={clearSystemError}>
          <Trans>关闭</Trans>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
