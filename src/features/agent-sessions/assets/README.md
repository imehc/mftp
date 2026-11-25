# Agent 图标

Claude Code、Codex、WorkBuddy、OpenCode、GitHub Copilot、Qoder、CodeBuddy 的 SVG 来自 [Lobe Icons](https://github.com/lobehub/lobe-icons/tree/master/packages/static-svg/icons)，采用 MIT 许可，见同目录 `LICENSE-lobe-icons.txt`。`copilot.svg` 对应上游 `githubcopilot.svg`，用于 VS Code Copilot。

资源本地打包。Codex 去除素材的白色画布，适配深色主题。OpenCode 与 GitHub Copilot 单色图标在深色主题中反色；Qoder 深色版本仅将上游 `currentColor` 前景设为浅色，保留绿色侧面和原路径。`AgentIcon` 统一外部槽位，并根据图形面积和素材内置留白补偿视觉大小；保留原图形比例与品牌颜色。
