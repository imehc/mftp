import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowDownUp, Eraser, Info } from "lucide-react";
import { toast } from "sonner";

import AppPageLayout from "~/components/AppPageLayout";
import { CopyButton } from "~/components/CopyButton";
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
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
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
      contentClassName="flex flex-col gap-3"
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
        <Tabs
          value={crypto.mode}
          onValueChange={(value) => {
            if (value === "encode" || value === "decode") crypto.setMode(value);
          }}
        >
          <TabsList density="adaptive" aria-label={t`模式`}>
            <TabsTrigger value="encode">
              <Trans>编码</Trans>
            </TabsTrigger>
            <TabsTrigger value="decode">
              <Trans>解码</Trans>
            </TabsTrigger>
          </TabsList>
        </Tabs>
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
      <p className="text-muted-foreground flex items-center gap-2 pb-3 text-xs">
        <Info className="size-4 shrink-0" />
        <Trans>内容在本机实时处理。</Trans>
      </p>
    </AppPageLayout>
  );
}
