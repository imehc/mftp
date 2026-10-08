# 原生验收夹具

原生测试使用独立 QA 应用、数据和凭据命名空间；构建或浏览器模拟不能计作设备通过。执行设备验收前，按 AGENTS.md 确认具体计划。

```sh
node tests/native/generate-fixtures.mjs <空的测试目录>
```

生成自建四面体 GLB、带外部 bin 的 glTF、Radiance HDR、文本、恶意 Markdown 和单页 PDF，以及记录字节数和 SHA-256 的 manifest.json。目录非空即拒绝，避免覆盖已有文件。样本不含用户数据，不依赖外部模型下载。GLB/glTF 已通过项目 gltf-validator 校验。

通过应用的系统文件选择器导入样本，记录 UI、实际落盘/重启恢复与导出结果；验收前后比对 manifest 中原文件哈希。恶意 Markdown 中的远程地址仅用于确认内容保持纯文本，不应加载。PDF 和 HDR 的实际查看效果需由对应原生用例记录，不以生成成功代替通过。

每次运行独立保存设备、系统版本、应用标识、源码摘要、结果和限制；编译缓存和输出保留在临时验收目录。当前本机计划见 docs/project-improvement-native-final.md（依照项目策略本地保留）。
