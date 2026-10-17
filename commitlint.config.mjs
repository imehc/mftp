export default {
  extends: ["@commitlint/config-conventional"],
  // 合并、版本号和 fixup 等提交也必须满足前缀要求，不走默认忽略规则。
  defaultIgnores: false,
  prompt: {
    messages: {
      type: "选择提交类型：",
      customScope: "输入提交范围（可选，回车跳过）：",
      subject: "填写简短的中文变更描述：",
      body: "填写详细说明（可选，使用 | 换行）：",
      breaking: "描述不兼容变更（可选，使用 | 换行）：",
      footerPrefixesSelect: "选择关联 Issue 前缀（可选）：",
      customFooterPrefix: "输入关联 Issue 前缀：",
      footer: "填写关联 Issue（可选，例如 #31）：",
      confirmCommit: "确认提交以上内容？",
    },
    types: [
      { value: "feat", name: "feat:     ✨ 新增功能", emoji: "✨" },
      { value: "fix", name: "fix:      🐛 修复问题", emoji: "🐛" },
      { value: "refactor", name: "refactor: ♻️ 代码重构", emoji: "♻️" },
      { value: "perf", name: "perf:     ⚡️ 性能优化", emoji: "⚡️" },
      { value: "docs", name: "docs:     📝 文档变更", emoji: "📝" },
      { value: "test", name: "test:     ✅ 测试变更", emoji: "✅" },
      { value: "style", name: "style:    💄 代码格式", emoji: "💄" },
      { value: "build", name: "build:    📦 构建和依赖", emoji: "📦" },
      { value: "ci", name: "ci:       🎡 持续集成", emoji: "🎡" },
      { value: "revert", name: "revert:   ⏪ 回退提交", emoji: "⏪" },
      { value: "chore", name: "chore:    🔨 其他维护", emoji: "🔨" },
    ],
    useEmoji: true,
    emojiAlign: "center",
    useAI: false,
    // 跳过范围列表，用 cz-git 的输入模式直接填写可选范围。
    skipQuestions: ["scope"],
    defaultScope: "___CUSTOM___:",
    allowCustomScopes: true,
    allowEmptyScopes: true,
    emptyIssuePrefixAlias: "跳过关联 Issue",
    customIssuePrefixAlias: "自定义 Issue 前缀",
    minSubjectLength: 1,
    upperCaseSubject: false,
  },
  rules: {
    // 中文标题可能以 SSH、SFTP 等技术名称开头，不限制描述的字母大小写。
    "subject-case": [0],
  },
};
