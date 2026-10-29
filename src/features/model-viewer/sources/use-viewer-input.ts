import { useLingui } from "@lingui/react/macro";
import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { listenNativeFileDrop } from "~/lib/events";
import {
  isTauriRuntime,
  pickFilePathNative,
  pickFilePathsNative,
} from "~/lib/files";
import { isMobilePlatform } from "~/lib/platform";

import { modelError } from "../domain/errors";
import { modelExtensions } from "../loaders/registry";
import type { ViewerSession } from "../runtime/session";
import { browserSource } from "./browser";
import { nativeSource } from "./native";
import { isModelName } from "./paths";

function enqueueNativePaths(
  session: ViewerSession,
  entries: string[],
  companions: string[],
) {
  return session.enqueue(
    entries.map((path) => ({
      name: path.split(/[\\/]/).pop() ?? path,
      open: () => nativeSource(path, companions),
    })),
  );
}

export function useViewerInput(session: ViewerSession) {
  const { t } = useLingui();
  const input = useRef<HTMLInputElement>(null);
  const supplement = useRef<HTMLInputElement>(null);
  const supplementKey = useRef("");
  const supplementId = useRef<string | null>(null);
  const [hovering, setHovering] = useState(false);
  const nativeDesktop = isTauriRuntime() && !isMobilePlatform();

  useEffect(() => {
    if (!nativeDesktop) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listenNativeFileDrop(
      (paths) => {
        if (!active) return;
        const entries = paths.filter(isModelName);
        if (!entries.length) {
          session.report(modelError("unsupported"));
          return;
        }
        void enqueueNativePaths(session, entries, paths);
      },
      (value) => {
        if (active) setHovering(value);
      },
    )
      .then((listener) => {
        if (active) unlisten = listener;
        else listener();
      })
      .catch((error) => {
        if (active) session.report(error);
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [session, nativeDesktop]);

  async function chooseModel() {
    if (!nativeDesktop) {
      input.current?.click();
      return;
    }
    try {
      const paths = await pickFilePathsNative({
        filterName: t({
          message: "3D 模型",
          comment: "本地 GLB、glTF、FBX 三维模型查看工具名称。",
        }),
        extensions: modelExtensions,
      });
      if (paths?.length) await enqueueNativePaths(session, paths, paths);
    } catch (error) {
      session.report(error);
    }
  }

  async function chooseDependency(key: string) {
    const target = session.snapshot().awaitingId;
    if (!target) return;
    if (!nativeDesktop) {
      supplementKey.current = key;
      supplementId.current = target;
      supplement.current?.click();
      return;
    }
    try {
      const path = await pickFilePathNative({
        title: key,
        filterName: t({
          message: "模型依赖文件",
          comment: "3D 模型的二进制数据或纹理文件选择器类型。",
        }),
        extensions: ["*"],
      });
      if (typeof path === "string") await session.attach(key, path, target);
    } catch (error) {
      session.report(error);
    }
  }

  function openFiles(files: File[]) {
    const entries = files.filter((file) => isModelName(file.name));
    if (!entries.length) {
      session.report(modelError("unsupported"));
      return;
    }
    void session.enqueue(
      entries.map((entry) => ({
        name: entry.name,
        size: entry.size,
        open: () => browserSource(files, entry),
      })),
    );
  }

  function onFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length) openFiles(files);
  }

  function onDependencySelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file)
      void session.attach(supplementKey.current, file, supplementId.current);
  }

  const dropProps = {
    onDragOver(event: DragEvent) {
      if (isMobilePlatform()) return;
      event.preventDefault();
      setHovering(true);
    },
    onDragLeave() {
      setHovering(false);
    },
    onDrop(event: DragEvent) {
      event.preventDefault();
      setHovering(false);
      if (
        !nativeDesktop &&
        !isMobilePlatform() &&
        event.dataTransfer.files.length
      )
        openFiles(Array.from(event.dataTransfer.files));
    },
  };

  return {
    input,
    supplement,
    hovering,
    chooseModel,
    chooseDependency,
    onFilesSelected,
    onDependencySelected,
    dropProps,
  };
}
