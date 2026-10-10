import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowDownUp, Eraser } from "lucide-react";
import { toast } from "sonner";

import AppPageLayout from "~/components/AppPageLayout";
import { CopyButton } from "~/components/CopyButton";
import FixedSelect from "~/components/FixedSelect";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { describeError } from "~/lib/errors";

import CryptoTextPanel from "./CryptoTextPanel";
import { useCrypto } from "./use-crypto";

export default function CryptoTool() {
  const { t } = useLingui();
  const crypto = useCrypto();
  return (
    <AppPageLayout
      adaptiveDensity
      bottomInset="scroll"
      title={<Trans>加解密</Trans>}
      contentDensity="compact"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Field orientation="horizontal" className="w-auto">
          <FieldLabel htmlFor="crypto-algorithm">
            <Trans>算法</Trans>
          </FieldLabel>
          <Select value="base64">
            <SelectTrigger
              id="crypto-algorithm"
              density="adaptive"
              aria-label={t`选择算法`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="base64">Base64</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <FixedSelect
          className="flex-1"
          alignment="end"
          value={crypto.mode}
          onValueChange={(value) => {
            if (value === "encode" || value === "decode") crypto.setMode(value);
          }}
        >
          <SelectTrigger aria-label={t`模式`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="encode">
                <Trans>编码</Trans>
              </SelectItem>
              <SelectItem value="decode">
                <Trans>解码</Trans>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </FixedSelect>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <CryptoTextPanel
          id="crypto-input"
          label={<Trans>输入</Trans>}
          value={crypto.input}
          onChange={crypto.setInput}
          placeholder={
            crypto.mode === "encode" ? t`输入要编码的文本` : t`输入要解码的内容`
          }
          error={crypto.error}
          actions={
            <Button
              density="adaptive"
              variant="outline"
              size="sm"
              disabled={!crypto.input}
              onClick={() => crypto.setInput("")}
            >
              <Eraser />
              <Trans>清空</Trans>
            </Button>
          }
        />
        <CryptoTextPanel
          id="crypto-output"
          label={<Trans>结果</Trans>}
          value={crypto.output}
          placeholder={t`结果会实时显示在这里`}
          actions={
            <>
              <Button
                density="adaptive"
                variant="outline"
                size="sm"
                disabled={!crypto.output || !!crypto.error}
                onClick={crypto.swap}
                title={t`将结果写回输入并切换模式`}
              >
                <ArrowDownUp />
                <Trans>互换</Trans>
              </Button>
              <CopyButton
                variant="outline"
                size="sm"
                value={crypto.output}
                disabled={!crypto.output}
                showLabel
                label={t`复制结果`}
                onError={(error) => toast.error(describeError(error))}
              />
            </>
          }
        />
      </div>
      <Field orientation="horizontal">
        <Checkbox
          id="crypto-url-safe"
          checked={crypto.urlSafe}
          onCheckedChange={(value) => crypto.setUrlSafe(value === true)}
        />
        <div>
          <FieldLabel htmlFor="crypto-url-safe">
            <Trans>使用 URL 安全字符</Trans>
          </FieldLabel>
          <FieldDescription>
            <Trans>使用 -_ 替换 +/，并省略填充</Trans>
          </FieldDescription>
        </div>
      </Field>
    </AppPageLayout>
  );
}
