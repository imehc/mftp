#!/usr/bin/env bash
# 审计文件行数是否违反 600 行上限。
# 后端：src-tauri/**/*.rs 全部受限。
# 前端：src/**/*.{ts,tsx} 受限，但 src/components/ui/**（shadcn 安装的组件）豁免。
# 用法：bash .agents/skills/project-conventions/scripts/check_lines.sh
set -euo pipefail

LIMIT=600
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"

violations=0

check() {
  local f="$1"
  local lines
  lines=$(wc -l < "$f" | tr -d ' ')
  if [ "$lines" -gt "$LIMIT" ]; then
    printf '  %6s  %s\n' "$lines" "$f"
    violations=$((violations + 1))
  fi
}

echo "== 后端 (src-tauri/**/*.rs) 超过 ${LIMIT} 行 =="
while IFS= read -r f; do check "$f"; done < <(find src-tauri/src -name '*.rs' 2>/dev/null | sort)

echo "== 前端 (src/**/*.{ts,tsx}，排除 src/components/ui) 超过 ${LIMIT} 行 =="
while IFS= read -r f; do check "$f"; done < <(find src \( -name '*.ts' -o -name '*.tsx' \) -not -path 'src/components/ui/*' 2>/dev/null | sort)

echo
if [ "$violations" -eq 0 ]; then
  echo "✅ 无超标文件。"
else
  echo "❌ 共 ${violations} 个文件超过 ${LIMIT} 行，请按功能块拆分（见 references/）。"
  exit 1
fi
