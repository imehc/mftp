import type { Session } from "./BilliardsMatch";
import { type FoulFeedback, foulFeedback } from "./foul-feedback";

export function subscribeFoulPenalties(
  runner: Pick<Session["runner"], "getSnapshot" | "subscribe" | "controllers">,
  notify: (feedback: FoulFeedback) => void,
): () => void {
  let previous = runner.getSnapshot();
  return runner.subscribe(() => {
    const current = runner.getSnapshot();
    const newShot =
      current.moveCount > previous.moveCount &&
      current.state.shotCount > previous.state.shotCount;
    previous = current;
    if (!newShot) return;
    const feedback = foulFeedback(current.state);
    if (
      feedback &&
      feedback.penalty > 0 &&
      feedback.shooter !== null &&
      runner.controllers[feedback.shooter]?.kind === "local"
    )
      notify(feedback);
  });
}
