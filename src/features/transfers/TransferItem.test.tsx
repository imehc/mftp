import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { TransferState } from "~/store/transfers";

import TransferItem from "./TransferItem";

function transfer(patch: Partial<TransferState> = {}): TransferState {
  return {
    id: "rsync-1",
    label: "上传 project",
    phase: "同步中",
    kind: "upload",
    startedAt: 0,
    transferred: 1024,
    total: null,
    updatedAt: 0,
    status: "running",
    ...patch,
  };
}

function markup(value: TransferState) {
  const i18n = setupI18n({ locale: "zh-CN", messages: { "zh-CN": {} } });
  return renderToStaticMarkup(
    <I18nProvider i18n={i18n}>
      <TransferItem
        transfer={value}
        onCancel={vi.fn()}
        onTogglePause={vi.fn()}
        onRetry={vi.fn()}
      />
    </I18nProvider>,
  );
}

describe("传输任务的暂停能力", () => {
  it("不可暂停的任务只保留取消", () => {
    const rendered = markup(transfer({ pausable: false }));
    expect(rendered).toContain('aria-label="取消"');
    expect(rendered).not.toContain('aria-label="暂停"');
  });

  it("普通任务仍可暂停", () => {
    const rendered = markup(transfer({ pausable: true }));
    expect(rendered).toContain('aria-label="暂停"');
    expect(rendered).toContain('aria-label="取消"');
  });
});
