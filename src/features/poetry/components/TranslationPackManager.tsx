import { Trans, useLingui } from "@lingui/react/macro";
import { FolderInput, Trash2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  poetryTranslationPackDelete,
  poetryTranslationPackImport,
  poetryTranslationPacks,
} from "~/lib/ipc";
import type { PoetryTranslationPackSummary } from "~/bindings";

export default function TranslationPackManager({
  packs,
  onChange,
}: {
  packs: PoetryTranslationPackSummary[];
  onChange: (packs: PoetryTranslationPackSummary[]) => void;
}) {
  const { t } = useLingui();
  const packCount = packs.length;

  const importPack = async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof picked !== "string") return;
    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const count = await poetryTranslationPackImport(
        await readTextFile(picked),
      );
      onChange(await poetryTranslationPacks());
      toast.success(t`译文包已导入`, { description: t`共 ${count} 条译文` });
    } catch (error) {
      toast.error(t`导入失败`, { description: String(error) });
    }
  };

  const deletePack = async (id: string) => {
    try {
      await poetryTranslationPackDelete(id);
      onChange(packs.filter((item) => item.id !== id));
      toast.success(t`已删除`);
    } catch (error) {
      toast.error(t`操作失败`, { description: String(error) });
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            <Trans>开放译文包</Trans>
          </p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {packCount
              ? t`已导入 ${packCount} 个译文包`
              : t`仅导入带作者、来源和许可证的本地 JSON`}
          </p>
        </div>
        <Button variant="outline" size="xs" onClick={() => void importPack()}>
          <FolderInput data-icon="inline-start" />
          <Trans>导入</Trans>
        </Button>
      </div>
      {packs.map((pack) => {
        const packName = pack.name;
        return (
          <div
            key={pack.id}
            className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
          >
            <span className="min-w-0 truncate">
              {pack.name} · {pack.author} · {pack.license}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t`删除 ${packName}`}
              onClick={() => void deletePack(pack.id)}
            >
              <Trash2 />
            </Button>
          </div>
        );
      })}
    </>
  );
}
