/** 单一 URL 所有者：创建新地址成功后再释放旧地址，清理可以重复调用。 */
export function createObjectUrlOwner(
  api: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL,
) {
  let current: string | null = null;
  return {
    replace(blob: Blob | null) {
      const next = blob ? api.createObjectURL(blob) : null;
      if (current) api.revokeObjectURL(current);
      current = next;
      return next;
    },
    clear() {
      if (current) api.revokeObjectURL(current);
      current = null;
    },
  };
}
