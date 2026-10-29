import { modelLibraryDocument, modelLibraryReadThumbnail } from "~/lib/ipc";
import { ipcQuery } from "~/lib/query-client";

export const modelCatalogKey = ["model", "catalog"] as const;
export const modelKey = (id: string) => ["model", "item", id] as const;
export const modelDocumentQuery = (id: string) => ({
  ...ipcQuery([...modelKey(id), "document"], () => modelLibraryDocument(id)),
  staleTime: 0,
});
export const modelThumbnailQuery = (id: string, updatedAt: number) => ({
  ...ipcQuery([...modelKey(id), "thumbnail", updatedAt], () =>
    modelLibraryReadThumbnail(id),
  ),
  // 缩略图只保留虚拟列表中可见/预渲染的行，离屏即回收，不累积历史图片。
  gcTime: 0,
});
