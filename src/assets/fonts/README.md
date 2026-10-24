# 内置中文字体

界面「设置 → 外观与语言 → 字体」里可选的四个中文字族，全部随应用打包，不联网。

| 文件                             | 字体         | 体积   | 汉字覆盖 | 来源                                                         |
| -------------------------------- | ------------ | ------ | -------- | ------------------------------------------------------------ |
| `lxgw-wenkai-cjk-500.woff2`      | 霞鹜文楷     | 1.8 MB | 7333     | `@fontsource/lxgw-wenkai`，经 `pnpm fonts:subset` 子集化     |
| `zcool-kuaile-cjk-400.woff2`     | 站酷快乐体   | 709 KB | 5719     | `@fontsource/zcool-kuaile` 的 `chinese-simplified` 子集      |
| `long-cang-cjk-400.woff2`        | 龙藏体       | 2.4 MB | 5717     | `@fontsource/long-cang` 的 `chinese-simplified` 子集         |
| `fusion-pixel-8px-cjk-400.woff2` | 缝合像素 8px | 333 KB | 13218    | `@fontsource/fusion-pixel-8px-proportional-kr`（含简中字形） |

## 授权

四款字体均为 **SIL Open Font License 1.1**，允许随应用打包、再分发与商用；
需要保留字体自带的版权与许可声明（见各 npm 包内的 `LICENSE`）。
文楷经过子集化，属于 OFL 允许的修改版；其版权声明未保留字体名，故可继续使用原族名。
应用内统一加 `App` 后缀只是为了避免与本机已安装的同名字体串味。

## 覆盖策略

西文字形始终由 Geist 承担（拉丁与中文是两个独立 token，见 `src/App.css` 的
`--font-latin-token` / `--font-cjk-token`）。因此这里只需覆盖汉字与标点。
超出覆盖集的生僻字按 `--font-cjk-token` 的回退链落到系统字体，不会显示成方框。

诗词正文固定使用文楷（`--font-poetry`），不随字体设置变化。

## 重新生成文楷子集

```sh
pip install fonttools brotli
pnpm fonts:subset   # 字符集取自思源黑体的 chinese-simplified，与其余字族对齐
```

字符集参考用 `@fontsource/noto-sans-sc`，只为对齐覆盖范围而安装，不会打进构建产物。
另三款直接取自上游 `chinese-simplified` 子集，不需要重新生成；升级依赖后
从 `node_modules` 重新拷贝对应 woff2 即可。
