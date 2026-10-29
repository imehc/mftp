import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useStore } from "zustand";

import type { McpCredential, McpCredentialInput } from "~/bindings";
import AppPageContent from "~/components/AppPageContent";
import { describeError } from "~/lib/errors";

import { presentModules } from "./catalog-presentation";
import { connectionConfig } from "./connection-config";
import { createMcpController } from "./mcp-controller";
import {
  type CredentialAction,
  McpCredentialConfirmation,
  McpIssuedDialog,
  McpStopDialog,
} from "./McpCredentialDialogs";
import McpCredentialEditor from "./McpCredentialEditor";
import McpCredentialsTable from "./McpCredentialsTable";
import McpHelpDialog from "./McpHelpDialog";
import McpServiceBar from "./McpServiceBar";
import McpToolsTable from "./McpToolsTable";

export default function McpSettings() {
  const { t } = useLingui();
  const client = useQueryClient();
  const [controller] = useState(() => createMcpController(undefined, client));
  const state = useStore(controller.store);
  const { snapshot, modules, loading, busy, issued, readFailed, pending } =
    state;
  const [editor, setEditor] = useState<{
    credential: McpCredential | null;
  } | null>(null);
  const [action, setAction] = useState<
    (CredentialAction & { input?: McpCredentialInput }) | null
  >(null);
  const [help, setHelp] = useState(false);
  const [stopping, setStopping] = useState(false);
  const notice = useRef(0);
  const toastId = useId();
  const presented = presentModules(modules, t);
  const endpoint =
    snapshot?.endpoint ?? `http://127.0.0.1:${snapshot?.port ?? 6021}/mcp`;
  const disabled = busy || loading || readFailed || !snapshot;

  useEffect(
    () =>
      controller.store.subscribe((current) => {
        if (!current.error || current.notice <= notice.current) return;
        notice.current = current.notice;
        toast.error(describeError(current.error, t), { id: toastId });
      }),
    [controller, t, toastId],
  );

  useEffect(() => {
    void controller.start();
    const timer = window.setInterval(() => void controller.refresh(), 5000);
    return () => {
      window.clearInterval(timer);
      controller.close();
      toast.dismiss(toastId);
    };
  }, [controller, toastId]);

  async function saveCredential(input: McpCredentialInput) {
    if (editor?.credential) {
      setAction({ kind: "update", credential: editor.credential, input });
      return false;
    }
    const success = await controller.create(input);
    if (success) setEditor(null);
    return success;
  }

  async function confirm() {
    if (!action) return;
    const { credential, kind } = action;
    const input = { name: credential.name, grants: credential.grants };
    const success =
      kind === "revoke"
        ? await controller.revoke(credential.id)
        : kind === "update" && action.input
          ? await controller.update(credential.id, action.input)
          : await controller.rotate(credential.id, input);
    if (success) {
      setAction(null);
      if (kind === "update") setEditor(null);
    }
  }

  async function stop() {
    if (await controller.stopServer()) setStopping(false);
  }

  return (
    <AppPageContent bottomInset="scroll" density="compact">
      <McpServiceBar
        snapshot={snapshot}
        busy={busy}
        pending={pending}
        loading={loading}
        readFailed={readFailed}
        onConfigure={controller.configure}
        onStart={() => void controller.startServer()}
        onStop={() => setStopping(true)}
        onRefresh={() => void controller.refresh()}
        config={connectionConfig(endpoint)}
        onCopyError={controller.reportError}
        onHelp={() => setHelp(true)}
      />
      <McpCredentialsTable
        credentials={snapshot?.credentials ?? []}
        disabled={disabled}
        available={!!snapshot && !readFailed}
        onAdd={() => {
          controller.dismissIssued();
          setEditor({ credential: null });
        }}
        onEdit={(credential) => setEditor({ credential })}
        onAction={setAction}
      />
      <McpToolsTable
        modules={presented}
        available={!!snapshot && !readFailed}
        onCopyError={controller.reportError}
      />
      {editor ? (
        <McpCredentialEditor
          key={editor.credential?.id ?? "new"}
          open={!action}
          credential={editor.credential}
          busy={busy}
          onSave={saveCredential}
          onCancel={() => setEditor(null)}
        />
      ) : null}
      {action ? (
        <McpCredentialConfirmation
          action={action}
          busy={busy}
          onClose={() => setAction(null)}
          onConfirm={() => void confirm()}
        />
      ) : null}
      {issued && !editor && !action ? (
        <McpIssuedDialog
          issued={issued}
          onClose={controller.dismissIssued}
          endpoint={endpoint}
          onError={controller.reportError}
        />
      ) : null}
      {help ? <McpHelpDialog onClose={() => setHelp(false)} /> : null}
      {stopping ? (
        <McpStopDialog
          busy={busy}
          onClose={() => setStopping(false)}
          onConfirm={() => void stop()}
        />
      ) : null}
    </AppPageContent>
  );
}
