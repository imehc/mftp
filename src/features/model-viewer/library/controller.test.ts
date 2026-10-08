import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  ModelLibraryCatalog,
  ModelLibraryDocument,
  ModelViewState,
} from "~/bindings";
import * as ipc from "~/lib/ipc";
import type { ModelViewerRuntime } from "../runtime/viewer";
import { ViewerSession } from "../runtime/session";
import { ModelLibraryController } from "./controller";
import { saveModel } from "./storage";
import type { ModelEntry } from "../runtime/collection";

vi.mock("~/lib/ipc", () => ({
  modelLibraryCatalog: vi.fn(),
  modelLibraryDocument: vi.fn(),
  modelLibrarySaveView: vi.fn(),
  modelLibraryCache: vi.fn(),
  modelLibraryDelete: vi.fn(),
  modelLibraryEdit: vi.fn(),
  modelLibraryThumbnail: vi.fn(),
}));

vi.mock("./storage", () => ({ librarySource: vi.fn(), saveModel: vi.fn() }));

const catalog: ModelLibraryCatalog = {
  entries: [],
  libraryBytes: 0,
  cacheBytes: 0,
  cacheLimit: 0,
  lastId: "saved",
};

const saved = {
  sourceName: "model.glb",
  resources: [],
  view: { version: 1 },
} as unknown as ModelLibraryDocument;

let controllers: ModelLibraryController[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { hidden: false }),
  );
  vi.stubGlobal("window", new EventTarget());
  vi.mocked(ipc.modelLibraryCatalog).mockResolvedValue(catalog);
  vi.mocked(ipc.modelLibraryDocument).mockResolvedValue(saved);
});

afterEach(() => {
  controllers.forEach((controller) => controller.stop());
  controllers = [];
  vi.unstubAllGlobals();
});

function fixture() {
  const session = new ViewerSession();
  const restoreState = vi.fn();
  session.runtime = {
    models: { entries: new Map() },
    captureState: () => null,
    restoreState,
  } as unknown as ModelViewerRuntime;
  const enqueue = vi
    .spyOn(session, "enqueue")
    .mockImplementation(async (requests) => {
      session.revision++;
      requests[0].loaded?.(session.runtime!, "restored");
    });
  const controller = new ModelLibraryController(session);
  controllers.push(controller);
  return { session, controller, enqueue, restoreState };
}

it("通过共享导入路径恢复上次保存的模型", async () => {
  const f = fixture();
  f.controller.start();
  await vi.waitFor(() =>
    expect(f.restoreState).toHaveBeenCalledWith("restored", saved.view),
  );
  expect(f.enqueue.mock.calls[0][0][0].libraryId).toBe("saved");
});

it("延迟到达的启动目录不能替换用户导入", async () => {
  let finish!: (value: ModelLibraryCatalog) => void;
  vi.mocked(ipc.modelLibraryCatalog).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const f = fixture();
  f.controller.start();
  f.session.revision++;
  finish(catalog);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ipc.modelLibraryDocument).not.toHaveBeenCalled();
});

it("导航或更新的导入发生后，延迟文档不能加入队列", async () => {
  let finish!: (value: ModelLibraryDocument) => void;
  vi.mocked(ipc.modelLibraryDocument).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const f = fixture();
  f.controller.start();
  await vi.waitFor(() => expect(finish).toBeDefined());
  f.session.revision++;
  finish(saved);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.enqueue).not.toHaveBeenCalled();
});

it("异步加载模型时，旧视图绝不覆盖更新的选择", async () => {
  const f = fixture();
  f.enqueue.mockImplementationOnce(async (requests) => {
    f.session.revision += 2;
    requests[0].loaded?.(f.session.runtime!, "old");
  });
  f.controller.start();
  await vi.waitFor(() => expect(f.enqueue).toHaveBeenCalledOnce());
  expect(f.restoreState).not.toHaveBeenCalled();
});

it("未变化的视图只持久化一次，写入失败后停止且仅在明确要求时重试", async () => {
  const f = fixture();
  vi.mocked(ipc.modelLibraryCatalog).mockResolvedValue({
    ...catalog,
    lastId: null,
  });
  const view = { version: 1 } as ModelViewState;
  const state = {
    ...f.session.snapshot(),
    selected: "active",
    items: [{ id: "active", libraryId: "saved", status: "ready" }],
  } as ReturnType<ViewerSession["snapshot"]>;
  vi.spyOn(f.session, "snapshot").mockReturnValue(state);
  f.session.runtime!.captureState = () => view;

  let subscriber = () => {};

  vi.spyOn(f.session, "subscribe").mockImplementation((listener) => {
    subscriber = listener;
    return () => {};
  });
  f.controller.start();
  subscriber();
  vi.mocked(ipc.modelLibrarySaveView).mockRejectedValueOnce({
    kind: "Custom",
    code: "model:library_missing",
    message: "missing",
    args: {},
  });
  f.controller.flush();
  await vi.waitFor(() => expect(f.controller.snapshot().failed).toBe(true));
  f.controller.flush();
  expect(ipc.modelLibrarySaveView).toHaveBeenCalledOnce();
  f.controller.retry();
  await vi.waitFor(() =>
    expect(ipc.modelLibrarySaveView).toHaveBeenCalledTimes(2),
  );
  f.controller.flush();
  expect(ipc.modelLibrarySaveView).toHaveBeenCalledTimes(2);
});

it("预览模型不入库、不生成缩略图、不标记保存失败，归档模型仍正常保存", async () => {
  const f = fixture();
  vi.mocked(ipc.modelLibraryCatalog).mockResolvedValue({
    ...catalog,
    lastId: null,
  });
  const state = {
    ...f.session.snapshot(),
    items: [
      { id: "preview", status: "ready" },
      { id: "saved", status: "ready" },
    ],
  } as ReturnType<ViewerSession["snapshot"]>;
  vi.spyOn(f.session, "snapshot").mockReturnValue(state);
  const capture = vi.fn(() => ({ version: 1 }) as ModelViewState),
    thumbnail = vi.fn();
  f.session.runtime!.captureState = capture;
  f.session.runtime!.thumbnail = thumbnail;
  const preview = { handle: { format: "FBX" } } as ModelEntry;
  const archived = {
    handle: { format: "GLB", archive: new Map([["", new Blob(["glTF"])]]) },
  } as ModelEntry;
  f.session.runtime!.models.entries.set("preview", preview);
  f.session.runtime!.models.entries.set("saved", archived);

  let subscriber = () => {};

  vi.spyOn(f.session, "subscribe").mockImplementation((listener) => {
    subscriber = listener;
    return () => {};
  });
  vi.mocked(saveModel).mockResolvedValue("stored");
  f.controller.start();
  subscriber();
  await vi.waitFor(() => expect(saveModel).toHaveBeenCalledOnce());
  expect(vi.mocked(saveModel).mock.calls[0][0]).toBe(archived.handle);
  expect(capture).not.toHaveBeenCalledWith("preview");
  expect(thumbnail).not.toHaveBeenCalled();
  expect(f.controller.snapshot().failed).toBe(false);
  expect(f.controller.snapshot().error).toBeNull();
});
