import { z } from "zod";

export const keyImportSchema = z.object({
  label: z.string().trim().min(1, "请输入密钥名称"),
  sourcePath: z.string().trim().min(1, "请选择私钥文件"),
  hasPassphrase: z.boolean(),
});

export type KeyImportFormValues = z.infer<typeof keyImportSchema>;

export const emptyKeyImportFormValues: KeyImportFormValues = {
  label: "",
  sourcePath: "",
  hasPassphrase: false,
};
