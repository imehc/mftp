import { beforeEach, describe, expect, it } from "vitest";

import {
  parsePoetryLibrarySearch,
  parsePoetryManageSearch,
  poetryManageReturnLink,
  poetryReadingLink,
  poetryResumeLink,
} from "./reading-navigation";
import { poetryReadingSession } from "./reading-session";

beforeEach(() =>
  poetryReadingSession.setState({ entries: [], location: null }),
);

describe("诗词返回目的地", () => {
  it("管理页原样恢复桌面作品、查询和注释标签", () => {
    expect(
      poetryManageReturnLink(
        parsePoetryManageSearch({ poem: "甲", q: "春", view: "annotations" }),
      ),
    ).toEqual({
      to: "/library",
      search: { poem: "甲", q: "春", view: "annotations" },
    });
  });

  it("独立详情经过管理或设置后仍返回独立详情", () => {
    expect(
      poetryManageReturnLink({
        poem: "甲",
        q: "春",
        view: "translation",
        from: "detail",
      }),
    ).toEqual(
      poetryReadingLink({
        page: "detail",
        uid: "甲",
        q: "春",
        view: "translation",
      }),
    );
    expect(
      poetryReadingLink({ page: "detail", uid: "甲", view: "annotations" }),
    ).toMatchObject({
      to: "/library/$id",
      params: { id: "甲" },
      search: { view: "annotations" },
    });
  });

  it("主导航恢复最近详情，普通列表和显式链接不被恢复记录覆盖", () => {
    poetryReadingSession.getState().rememberLocation({
      page: "detail",
      uid: "旧",
      q: "春",
      view: "annotations",
    });
    expect(poetryResumeLink({ resume: true })).toMatchObject({
      to: "/library/$id",
      params: { id: "旧" },
      search: { view: "annotations" },
    });
    expect(poetryResumeLink({})).toBeUndefined();
    expect(poetryResumeLink({ q: "新查询" })).toBeUndefined();
    expect(
      poetryResumeLink({ resume: true, poem: "新", view: "translation" }),
    ).toMatchObject({
      to: "/library",
      search: { poem: "新", view: "translation" },
    });
  });

  it("明确返回列表后主导航不会重新打开上一首诗", () => {
    poetryReadingSession
      .getState()
      .rememberLocation({ page: "library", q: "春", view: "annotations" });
    expect(poetryResumeLink({ resume: true })).toMatchObject({
      to: "/library",
      search: { poem: undefined, q: "春", view: "annotations" },
    });
  });

  it("旧参数兼容且拒绝无效标签和外部返回目标", () => {
    expect(
      parsePoetryLibrarySearch({ mode: "literary", resume: "true" }),
    ).toMatchObject({ view: "translation", resume: true });
    expect(
      parsePoetryManageSearch({
        mode: "literal",
        view: "annotations",
        from: "https://example.com",
      }),
    ).toMatchObject({ view: "annotations", from: undefined });
    expect(poetryManageReturnLink({ from: "detail" }).to).toBe("/library");
  });
});
