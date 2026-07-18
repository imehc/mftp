import { z } from "zod";

type TranslateTag = (
  literals: TemplateStringsArray,
  ...placeholders: unknown[]
) => string;

export function createKeyImportSchema(t: TranslateTag) {
  return z.object({
    label: z.string().trim().min(1, t`请输入密钥名称`),
    sourcePath: z.string().trim().min(1, t`请选择私钥文件`),
    hasPassphrase: z.boolean(),
  });
}

export const keyImportSchema = createKeyImportSchema(
  ((literals, ...placeholders) =>
    String.raw({ raw: literals }, ...placeholders)) as TranslateTag,
);

export type KeyImportFormValues = z.infer<typeof keyImportSchema>;

export const emptyKeyImportFormValues: KeyImportFormValues = {
  label: "",
  sourcePath: "",
  hasPassphrase: false,
};
