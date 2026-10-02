import * as ipc from "~/lib/ipc";
import { type TransferState, useTransfersStore } from "~/store/transfers";
import { runTransferRetry } from "./retry";

/** 两种面板共享任务动作；订阅与资源生命周期仍由应用运行期持有。 */
export function createTransferActions() {
  const {
    markCancelling,
    cancelFailed,
    finish: finishTransfer,
    setPaused,
    setControlPending,
    setControlError,
    setRetrying,
  } = useTransfersStore.getState();
  const cancelTransfer = async (transfer: TransferState) => {
    const current = useTransfersStore
      .getState()
      .transfers.find((item) => item.id === transfer.id);
    if (!current) return;
    transfer = current;
    if (
      transfer.status !== "running" ||
      transfer.controlPending ||
      transfer.cancelling
    )
      return;
    const { id } = transfer;
    setControlError(id);
    markCancelling(id);
    try {
      if (id.startsWith("bt:")) {
        await ipc.btControl(id.slice(3), "Cancel", false);
        finishTransfer(id, "cancelled");
      } else {
        await ipc.sftpCancelTransfer(id);
      }
    } catch (error) {
      cancelFailed(id);
      setControlError(id, error);
    }
  };
  const togglePause = async (transfer: TransferState) => {
    const current = useTransfersStore
      .getState()
      .transfers.find((item) => item.id === transfer.id);
    if (!current) return;
    transfer = current;
    if (
      transfer.status !== "running" ||
      transfer.controlPending ||
      transfer.cancelling
    )
      return;
    const { id } = transfer;
    setControlError(id);
    setControlPending(id, true);
    try {
      if (id.startsWith("bt:")) {
        await ipc.btControl(
          id.slice(3),
          transfer.paused ? "Resume" : "Pause",
          false,
        );
      } else if (transfer.paused) {
        await ipc.sftpResumeTransfer(id);
      } else {
        await ipc.sftpPauseTransfer(id);
      }
      setPaused(id, !transfer.paused);
    } catch (error) {
      setControlError(id, error);
    } finally {
      setControlPending(id, false);
    }
  };
  const retryTransfer = async (transfer: TransferState) => {
    const current = useTransfersStore
      .getState()
      .transfers.find((item) => item.id === transfer.id);
    if (!current) return;
    transfer = current;
    if (!transfer.retry || transfer.retrying) return;
    setRetrying(transfer.id, true);
    try {
      await runTransferRetry(transfer.retry);
    } catch (error) {
      setControlError(transfer.id, error);
    } finally {
      setRetrying(transfer.id, false);
    }
  };
  return { cancelTransfer, togglePause, retryTransfer };
}
