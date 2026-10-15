import { Trans } from "@lingui/react/macro";
import { useEffect, useEffectEvent } from "react";
import { toast } from "sonner";

import { foulLabel, FoulSummary } from "./BilliardsFoulFeedback";
import type { Session } from "./BilliardsMatch";
import type { FoulFeedback } from "./foul-feedback";
import { subscribeFoulPenalties } from "./foul-notifications";
import type { BilliardsMode } from "./types";

export function useFoulNotification(
  runner: Session["runner"],
  mode: BilliardsMode,
) {
  const notify = useEffectEvent((feedback: FoulFeedback, id: string) => {
    toast.warning(<FoulSummary feedback={feedback} mode={mode} />, {
      id,
      description: foulLabel(feedback.reason),
      duration: 6000,
      cancel: { label: <Trans>关闭</Trans>, onClick: () => toast.dismiss(id) },
    });
  });
  useEffect(() => {
    const id = `billiards-penalty:${runner.id}`;
    const unsubscribe = subscribeFoulPenalties(runner, (feedback) =>
      notify(feedback, id),
    );
    return () => {
      unsubscribe();
      toast.dismiss(id);
    };
  }, [runner]);
}
