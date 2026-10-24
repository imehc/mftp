/**
 * 生成中文子集字体。
 *
 * 三款中文字体共用同一份字符集——以思源黑体 `chinese-simplified` 的覆盖为准
 * （7946 字），保证切换字体时字形覆盖一致；超出该集合的生僻字由 CSS font stack
 * 回退到系统字体，因此不必把三万字的全量字库打进安装包。
 *
 * 依赖 python3 + fonttools + brotli（`pip install fonttools brotli`）。
 * 用法：`pnpm fonts:subset`，或用 `PYTHON=/path/to/python` 指定解释器。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const python = process.env.PYTHON ?? "python3";
const source = path.join(
  project,
  "node_modules/@fontsource/lxgw-wenkai/files/lxgw-wenkai-latin-500-normal.woff2",
);
const reference = path.join(
  project,
  "node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2",
);
const output = path.join(project, "src/assets/fonts/lxgw-wenkai-cjk-500.woff2");

// 字符集不硬编码在脚本里：直接从参考字体导出，字体升级时一并更新。
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mftp-cjk-"));
const charsetFile = path.join(workdir, "charset.txt");
execFileSync(
  python,
  [
    "-c",
    [
      "import sys",
      "from fontTools.ttLib import TTFont",
      "cmap = TTFont(sys.argv[1]).getBestCmap()",
      "open(sys.argv[2], 'w', encoding='utf-8').write(''.join(chr(c) for c in sorted(cmap)))",
    ].join("\n"),
    reference,
    charsetFile,
  ],
  { stdio: "inherit" },
);

execFileSync(
  python,
  [
    "-m",
    "fontTools.subset",
    source,
    `--text-file=${charsetFile}`,
    "--layout-features=*",
    "--flavor=woff2",
    `--output-file=${output}`,
  ],
  { stdio: "inherit" },
);

fs.rmSync(workdir, { recursive: true, force: true });
const size = fs.statSync(output).size;
console.log(
  `已生成 ${path.relative(project, output)}：${(size / 1024 / 1024).toFixed(2)} MB`,
);
