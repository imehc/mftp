# 文库（中华古典文库）方案清单

> 状态：**核心决策已确认（2026-08-25），进入实施**。剩余开放项见文末清单。
>
> 已确认：D1 本地 SQLite；D2 手动增量同步；D5 收藏放主库纳入导出；D8 桌面 master-detail 双栏；D9 发现页并入 M2。
> 2026-08-25 二轮确认：D4 用简体镜像做源；D6 默认只索引标题/作者、正文 LIKE 兜底；D7 改为接注释包（原 D7-A 降级为无注释时的兜底表现）；**一期只做桌面**，移动端 UI 延后。
> 目标目录（已建空占位）：`src/routes/library/`、`src/features/poetry/`、`src-tauri/src/poetry/{discover,index}/`。
>
> 本文第二节起的所有数字都是 2026-08-25 在本机实测所得（下载测速、解析计数、建库体积、查询延迟），不是估算。

## 一、结论速览（TL;DR）

| 问题                        | 建议                                                                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 纯线上 vs 本地              | **本地 SQLite（FTS5）优先**，手动增量同步                                                                                                                                                            |
| 数据来源                    | 正文取 [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)（简体镜像 `chinese-poetry-zhCN` 覆盖唐诗/宋诗），一期直接同步上游 `codeload` tar.gz（90.5MB / 实测 10s），不必先搭托管仓库 |
| 全文搜索                    | 标题/作者进归一后的 contentless FTS5，正文用 LIKE 兜底（繁简变体 OR 扩展）；正文索引作为可开关的升级项，用 unigram+bigram 而非 trigram                                                               |
| 释义（译文/注解）           | 上游正文数据自带释义仅约 890 条，接 [aopao/chinese-gushiwen](https://github.com/aopao/chinese-gushiwen) 注释包（1 万首含注释/译文/赏析/朗诵链接，约 14MB）                                           |
| 收藏                        | 收藏表放主库 `mftp.sqlite3`（纳入现有 data_export），Phase 5 实现，键用内容哈希 uid                                                                                                                  |
| palemoky/chinese-poetry-api | 仅作接口设计参考；个人在线 demo 无 SLA，**不做主数据通道**                                                                                                                                           |

## 二、数据源实测（2026-08-25）

### chinese-poetry/chinese-poetry（MIT，51k+ stars）

一次性下载 `codeload.github.com/chinese-poetry/chinese-poetry/tar.gz/refs/heads/master`：**90.5MB / 10.2s / 9.3MB/s**，`Accept-Ranges` 缺失（不支持断点续传）。解包后逐目录解析计数：

| 合集                 | 篇数    | 正文体积 | 简繁 | 备注                     |
| -------------------- | ------- | -------- | ---- | ------------------------ |
| 全宋诗               | 254,225 | 46.9MB   | 繁   | 占全部作品 74%           |
| 全唐诗               | 57,603  | 11.2MB   | 繁   |                          |
| 宋词                 | 21,053  | 5.3MB    | 简   | 带 `rhythmic` 词牌       |
| 元曲                 | 10,914  | 2.9MB    | 简   |                          |
| 花间集               | 498     | —        | 简   |                          |
| 诗经                 | 305     | —        | 简   | 带 `chapter/section`     |
| 纳兰性德             | 258     | —        | 简   |                          |
| 幽梦影               | 219     | —        | 简   |                          |
| 水墨唐诗             | 176     | —        | 简   |                          |
| 楚辞                 | 65      | —        | 简   |                          |
| 南唐二主词           | 45      | —        | 简   |                          |
| 曹操诗集             | 26      | —        | 简   |                          |
| 蒙学（含唐诗三百首） | —       | ~1.1MB   | 繁   | 嵌套 dict，非统一 schema |

合计 **345,387 篇 / 67MB UTF-8 正文**。

字段并不统一，导入层必须按合集适配：正文键有 `paragraphs` / `content` / `para` 三种；注释键有 `notes` / `comment` / `prologue` / `abstract`；蒙学、四书五经、论语是嵌套 dict（章节→段落），需单独 parser。唐诗三百首实际躺在 `蒙学/tangshisanbaishou.json`，且是繁体。

自带释义总量实测仅 **892 条**，不足以支撑详情页的「注释/译文/赏析」，因此 D7 必须外接注释包。

### chinese-poetry/chinese-poetry-zhCN（简体镜像）

实测只镜像了 `poetry/` 一个目录：255 个 `poet.song.*.json` + 58 个 `poet.tang.*.json` + `authors.song.json` + `authors.tang.json`，共 **179.03MB**。也就是说它**恰好覆盖繁体的那两大块（全唐诗、全宋诗）**，其余合集上游本来就是简体。结论：D4 不需要引入任何转换库（见 D4）。

### palemoky/chinese-poetry-api

在线 demo 已与 README 漂移：`/api/v1/*` 全 404，可用路由是 `/api/poems`、`/api/stats`（自报 371,313 首 / 13,577 作者）。响应 0.69–4.8s，有限流、无 SLA、无释义。本地库同类查询 0.2–5ms。**只作接口形态参考，不做运行时依赖。**

### aopao/chinese-gushiwen（注释包）

约 14MB JSONL，1 万首，字段 `remark`（注释）/`translation`（译文）/`shangxi`（赏析）/`audioUrl`（朗诵）。按归一后的 `(title, writer)` 与正文库匹配。数据源自古诗文网爬取，版权灰色：**仅在用户显式点击时下载、只落 `app_data_dir`、不随安装包分发、不二次转发**。

## 三、核心决策点

### D1 运行模式：本地数据库（推荐） vs 纯线上

**推荐：本地 SQLite。**

理由：

1. 全量搜索（作者/标题/正文）33 万+作品，本地 FTS5 毫秒级返回、无请求配额；线上要么自建服务要么依赖不稳定第三方。
2. 桌面工具属性一致：本项目其他能力（SSH/SFTP、密码本、加解密）均离线可用，文库不应例外。
3. 数据 MIT 许可，一次构建长期复用；同步只在用户手动触发时发生，可控省流量。
4. 纯线上方案唯一优势是零磁盘占用，与"全量搜索"诉求冲突。

线上模式可作为远期可选兜底（未安装任何数据包时的试搜），本期不做。

### D2 数据分发：一期直连上游，托管包延后

原方案要求先有一个自己的托管仓库（构建脚本产出 SQLite pack + manifest → GitHub Releases）。实测下来这一步在一期是可以省掉的：

- **主通道：上游 tar.gz 直连。** `codeload.github.com/.../tar.gz/refs/heads/master` 一把 90.5MB、10.2s 拿完，比逐文件快两个数量级（jsDelivr 单文件仅 111KB/s，raw.githubusercontent 间歇 25s 超时）。下载完在本地解析 → 归一 → 事务写入 `poetry.sqlite3`，用户勾选的合集才解析。
- **备通道：本地导入。** 用户自己下好的 tar.gz / 解开的目录，选中路径直接导入。这是代理受限环境下唯一可靠的路径，必须一期就有。
- **版本标识**：记 commit sha（`api.github.com/repos/.../commits/master`，实测本机可达）+ 各合集导入时的行数与内容哈希。"检查更新"= 比 sha，"增量"= 只重建 sha 变化涉及的合集。
- ⚠️ codeload **不支持 Range**（无 `Accept-Ranges`），断了只能重下。下载写临时文件 + 完成后校验大小/解包可用性，中断即清理。
- 延后项：等真的需要"秒级安装、免解析"时，再补 `scripts/poetry-build/` 产出预建 SQLite pack + manifest（版本/sha256/体积/篇数）走 GitHub Releases。届时应用侧只多一条"下载预建包"通道，schema 不变。

### D3 模块范围（默认勾选建议）

体量以第二节实测为准，不再估算。分级按"装了会不会后悔"划：

| 分级                   | 模块                                                                   | 实测                                                     |
| ---------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| 首批推荐（体积可忽略） | 唐诗三百首、诗经、楚辞、花间集、纳兰性德、幽梦影、南唐二主词、曹操诗集 | 合计 < 2MB，1,600 余篇                                   |
| 默认勾选               | 全唐诗、宋词、元曲                                                     | 89,570 篇 / 22MB 正文 / 建库 82MB（含正文 bigram 索引）  |
| 显式可选               | 全宋诗                                                                 | 254,225 篇 / 46.9MB 正文 / 仅表 +70MB，正文索引再 +175MB |

分界线就是全宋诗：它一家占 74% 的作品量，且是唯一会把库从"几十 MB"推到"几百 MB"的模块。UI 上单独一张卡、单独标注体积、默认不勾。

**所有合集一律走下载，不随安装包内置**（已确认）。安装包不塞种子库，也就不需要构建期生成产物；首启文库页是空态 + 一个"获取数据"的引导，首批推荐项默认勾好，用户点一次即可。

### D4 简繁策略：用 zhCN 镜像补齐繁体那两块，零新依赖

- 繁体只有三处：全唐诗、全宋诗（占正文体积 87%）、蒙学（1.1MB，含唐诗三百首）。
- 前两者直接换用 `chinese-poetry-zhCN` 的 `poet.tang.*` / `poet.song.*` / `authors.*`（实测正是该镜像的全部内容），入库即简体。
- 蒙学体量小，一期原样入库并在 UI 标注"繁体"，不为 1.1MB 引入转换库。
- 因此 **不引入 `zhconv` / `character_converter` / `opencc-rust`**（后者还需系统级 OpenCC，直接排除）。
- 遗留：用户输入繁体关键词时匹配不到简体正文。用查询侧变体扩展兜底（见 D6），代价是一简对多繁的字（干→乾/幹）会有多余命中；真要做无损折叠再评估 `zhconv`（纯 Rust，可接受）。

### D5 存储：单独一个 `poetry.sqlite3`，不按模块拆库

```
app_data/
├── mftp.sqlite3     # 现有主库：新增 poetry_favorites 表 + 一个 ExportSection
└── poetry.sqlite3   # 文库库：collections / authors / poems / poems_fts / annotations
```

原方案是每模块一个 `packs/<module>.db`。放弃的理由：用户要的是**跨合集全量搜索**，多库就得 ATTACH 后 UNION，FTS5 排序（BM25）无法跨库统一，分页游标也得自己缝。单库 + `poems.collection_id` 索引就是一条 `WHERE collection_id IN (...)`。卸载合集 = 一条带事务的 `DELETE` + `VACUUM`，代价可接受（不是热路径）。

- 文库库整体可删可重建，独立于主库，不拖累现有备份/迁移。
- 收藏属用户数据，放主库并纳入 `data_export/import`。
- ⚠️ 键不能用 rowid 或 `(module_id, source_index)`：重建库后行序会变。收藏键用 `uid = hash(collection | 归一 title | 归一 author | 正文)`，并冗余存标题/作者/首句快照——合集被卸载后收藏页仍能渲染，只是点进去提示"需重新安装该合集"。
- `rusqlite(bundled)` 实测为 SQLite 3.53.2 且编译了 `-DSQLITE_ENABLE_FTS5`，无需新依赖。

### D6 中文全文检索：标题/作者进索引，正文默认 LIKE 兜底

四种方案在全量语料（345,387 篇 / 67MB 正文）上的实测：

| 方案                                  | 建库体积       | 1–2 字查询                    | ≥3 字查询     |
| ------------------------------------- | -------------- | ----------------------------- | ------------- |
| 只建表，无索引                        | 90MB           | LIKE 57–126ms                 | LIKE 57–110ms |
| **标题/作者 FTS + 正文 LIKE**（已选） | **112MB**      | 标题/作者 <1ms；正文 57–126ms | 同            |
| 全字段 unigram+bigram FTS             | ~265MB（推算） | 0.1–0.4ms                     | 0.1–0.4ms     |
| 全字段 trigram FTS                    | 338MB          | **索引失效**，必须 LIKE       | 0.2–5ms       |

关键实测结论：

- **trigram 查不了 1–2 字**。`月`、`明月` 返回 0 行，前缀写法 `月*` / `明月*` 同样 0 行——不是慢，是静默无结果。所以 trigram 无论如何都得配 LIKE 兜底，而它却是最占地方的方案，直接淘汰。
- **bigram 是唯一全档位亚毫秒的方案**。89,570 篇 / 22MB 子集实测：建库 82MB、耗时 3.9s，`月` 20,625 命中 0.4ms、`明月` 1,764 命中 0.1ms、`明月光` 0.1ms、`千里共婵娟` 0.2ms。它比 trigram 更小且能力更强。
- 原方案写"导入时生成 `search_text` 列"——**不要真的建这个列**，那等于把正文按 3 倍膨胀再存一遍。切分结果只喂给 `content=''` 的 contentless FTS5 表（`contentless_delete=1`，SQLite 3.43+ 实测可用），正文本体只在 `poems` 里存一份。上面 82MB / 265MB 就是这么测的。
- AND-of-bigram 会误配（`明月光` 切成 `明月 月光` 两个词 AND，两处分别出现也算命中）。查询要用 FTS5 短语语法 `"明月 月光"`（需 `detail=full`），或命中后用 LIKE 复核。
- 简繁折叠必须做：`愛` 10,756 命中 vs `爱` 1,131。标题/作者在入索引前归一（简体化），零额外存储且精确；正文 LIKE 侧把关键词扩成变体 OR（实测全量计数 1 变体 68ms / 2 变体 90ms / 3 变体 126ms，加 `LIMIT 50` 后 ~0ms）。
- 不引 jieba-rs：多一个原生依赖，字级切分已够。

**落地策略**：默认按已装合集决定正文索引。不装全宋诗时正文总量仅 22MB，直接建 bigram 正文索引（82MB，全档位 <1ms）；装了全宋诗则正文索引额外 +175MB，改走 LIKE 兜底，并在数据管理页给一个"为正文建索引"开关，明示体积与耗时。这样默认体验是"全都亚毫秒"，只有真的装了 25 万首宋诗才降级。

### D7 释义（译文/注释）：接 aopao/chinese-gushiwen 注释包

上游正文自带释义实测仅 892 条，撑不起详情页，因此走外接注释包：

- 数据：`aopao/chinese-gushiwen`，约 14MB JSONL、1 万首，字段 `remark` / `translation` / `shangxi` / `audioUrl`。
- 存 `poetry.sqlite3` 的 `annotations` 表，主键 `uid`（与 D5 同一套内容哈希），按归一后的 `(title, writer)` 匹配正文。匹配不上的条目保留，供后续改进匹配规则。
- ⚠️ 合规：该数据爬自古诗文网，版权灰色。**做成独立可选包**——仅用户显式点击才下载、只写 `app_data_dir`、不进安装包、应用内不提供再分发入口、管理页可一键删除。UI 标注来源。
- `audioUrl` 是外链，一期只显示"有朗诵"标记，不代理不缓存音频。
- 无注释时详情页优雅隐藏区块，并回落展示上游 `notes/comment/prologue/abstract` 字段（原 D7-A 的做法降级为兜底表现）。
- 远期：用户自配 LLM 生成释义并缓存（与文库解耦，不在本期）。

### D8 详情页布局

- **一期只做桌面**：master-detail 双栏——左侧列表常驻，右侧详情区切换，保住浏览上下文。
- 移动端延后：路由结构按 `/library/$id` 设计好，移动单栏全屏详情等后续里程碑再补，一期在移动尺寸下不暴露入口（复用 `src/lib/platform.ts` 守卫，不在组件里自行判断）。
- 详情内容：题名、作者·朝代（可点击看作者小传 `desc`）、词牌（如有）、正文（保留 `paragraphs` 换行节奏）、平仄（如有，折叠）、注释/译文/赏析区块、收藏按钮、字号/行距调节。

### D9 「发现」页定位

后端占位已有 `poetry/discover/`，做成轻量发现页：每日一诗（按日期种子的确定性伪随机，同一天同一首）、随机浏览、各合集精选开篇。已确认做，并入 M2。

## 四、IPC 设计草案

命令加 `#[tauri::command] #[specta::specta]` 并进 `lib.rs` 的 `collect_commands![]`（漏第二步前端就没有该命令）；类型由 specta 生成，不手改 `bindings.ts`；前端调用只在 `src/lib/ipc.ts`。

```text
poetry_collections()                   -> Vec<PoetryCollectionStatus>  # 合集清单+安装状态+篇数+体积
poetry_sync_check()                    -> PoetrySyncPlan               # 比对上游 commit sha
poetry_sync_start(collection_ids)      -> ()                           # 下载 tar.gz → 解析 → 事务导入
poetry_sync_import_local(path, ids)    -> ()                           # 本地 tar.gz/目录导入（代理受限兜底）
poetry_sync_cancel()                   -> ()
poetry_collection_delete(id)           -> ()                           # 卸载合集（DELETE + VACUUM）
poetry_content_index_build(enable)     -> ()                           # 正文 bigram 索引开关（D6）
poetry_browse(req)                     -> PoetryPage                   # 游标分页浏览
poetry_poem(uid)                       -> PoemDetail                   # 详情（含作者小传 + 注释）
poetry_authors(req)                    -> Vec<AuthorSummary>           # 作者索引
poetry_search(req)                     -> PoetrySearchResult           # scopes/filters/highlight/snippet
poetry_daily()                         -> PoemDetail                   # 每日一诗（日期种子）
poetry_annotations_install()           -> ()                           # 注释包下载（用户显式触发）
poetry_annotations_delete()            -> ()
poetry_favorite_toggle(uid)            -> bool                         # Phase 5
poetry_favorites_list()                -> Vec<FavoritePoem>            # Phase 5
```

要点：

- 所有作品标识用 D5 的内容哈希 `uid`，不暴露 rowid。
- 解析/导入/下载都是重活，走 blocking 线程，不阻塞 async runtime；`poetry_sync_cancel` 要能中断并清理临时文件。
- 事件 `library://sync-progress`，payload `PoetrySyncProgress { collection_id, phase, bytes_done, bytes_total, imported, total }`。事件 payload 类型不经命令签名，必须在 `specta_builder()` 里显式 `.typ::<PoetrySyncProgress>()`；事件名常量进 `src/lib/events.ts`，禁止内联字面量。
- 后端文件都在 600 行红线内：`poetry/mod.rs`（命令层）/ `sync.rs`（下载）/ `parse.rs`（各合集 schema 适配）/ `index/`（FTS + 简繁归一）/ `discover/`（每日一诗）/ `storage/poetry.rs`（schema + 迁移 + 查询）。

## 五、前端设计清单

### 信息架构

- 首页入口：`src/features/home/entries.tsx` 新增「文库」`HomeEntry`（`category: "tools"`，图标 `BookMarked`），`toolId` 需同步加进 `src/store/settings.ts` 的 `TOOL_ROUTES`（漏了就丢"记住上次工具"），并按注释要求 bump persist `version` + 在 `migrate` 里保持旧值有效。一期加 `platforms` 限桌面。
- 路由（`src/routes/library/**` 只做薄壳，逻辑在 `src/features/poetry/`，照 `src/routes/tools/vault.tsx` 的写法）：
  - `/library` 发现/浏览主页（桌面双栏，右栏为详情占位）
  - `/library/$id` 详情（桌面走右栏，直接访问也要能整页渲染）
  - `/library/manage` 数据管理（下载/更新/删除/体积统计/注释包/正文索引开关）
  - `/library/favorites` 收藏（Phase 5）
  - 搜索不单开路由，主页内联（`?q=` 存 search param，便于返回与分享状态）

### 页面与组件拆分（遵守 ≤600 行）

```
src/features/poetry/
├── LibraryPage.tsx          # 主壳：搜索栏+分类导航+双栏容器（react-resizable-panels）
├── components/ PoemCard / PoemList(virtual) / SearchBar / FilterTabs /
│               CollectionChip / SyncManager / PoemDetail / AuthorSheet /
│               FavoriteButton / EmptyStates
├── hooks/ use-poetry-search.ts / use-poetry-sync.ts / use-favorites.ts
└── store/ poetry-store.ts (Zustand: 已装合集缓存、搜索历史、阅读偏好)
```

- 长列表一律 `@tanstack/react-virtual`（25 万首宋诗必须虚拟化）；游标分页，禁止一次拉全量。
- 双栏用已装的 `react-resizable-panels`（与 SSH/SFTP 页同一套）。
- 复用 shadcn：`sheet`/`dialog`/`tabs`/`scroll-area`/`tooltip`/`select`/`slider`/`badge`/`empty`/`prompt-dialog`。⚠️ 项目里**没有** `skeleton`、`card`、`progress` 三个组件，骨架屏与进度环要么按需 `shadcn add`，要么用 Tailwind + `tw-animate-css` 自己写两个小件，别在 feature 里散落实现。
- 所有可见文案走 Lingui；错误 toast（`sonner`）、`aria-label`、`title` 全覆盖。文案沿用已有 msgid 优先、新增用短句。

### 交互细节

- 搜索：输入 300ms 防抖即搜；scope 切换（全部/标题/作者/正文）+ 朝代/合集筛选 chips；命中关键词 `<mark>` 高亮（高亮基于**原文**位置，简繁归一只用于匹配，不能拿归一串去渲染）；空态给示例词（"明月""杜甫"）；搜索历史本地持久化。正文 scope 在未建索引时走 LIKE，UI 提示"正文搜索较慢，可在数据管理开启正文索引"。
- 浏览：分类导航（合集/朝代）记忆状态；列表卡片含首联摘句（截断）；滚动位置在进出详情后恢复。
- 数据管理：合集卡片展示版本/体积/篇数/更新按钮；下载中显示进度与速度；完成后 toast + 列表原地刷新；删除需二次确认（`prompt-dialog`）。同步失败要给"本地导入"入口。
- 阅读偏好：字号滑杆（`slider`）、行距持久化到 settings store。

### 动画清单（尊重 `prefers-reduced-motion`，统一走 `lib/motion.ts` 判定）

| 场景                 | 效果                                               | 参数基线            |
| -------------------- | -------------------------------------------------- | ------------------- |
| 页面进入             | 内容块 fade + 上移 8px                             | 180–220ms ease-out  |
| 列表首屏             | 卡片 stagger 入场（仅首屏 12 项）                  | 每项 30ms 递进      |
| 卡片 hover           | translateY(-2px) + 阴影增强                        | 120ms               |
| 详情切换（桌面右栏） | 内容交叉淡入                                       | 200–240ms，缓出曲线 |
| 收藏按钮             | 心形 scale pop（1→1.25→1）+ 微旋转                 | spring，180ms       |
| 搜索结果刷新         | 旧列表快速淡出→新结果淡入，高亮词一次性 soft pulse | 160ms               |
| 加载态               | 骨架屏 shimmer，禁用裸 spinner                     | 循环 1.2s           |
| 同步进度             | 进度环平滑补间，阶段文案切换淡入                   | rAF 补间            |

实现优先 CSS transition/keyframes（`tw-animate-css` 已装）；复杂编排用已装的 `gsap`；不新增动画依赖。虚拟列表内不要给每项挂 gsap 实例，stagger 只作用首屏。

## 六、里程碑

- **M1 数据管道**：后端 `storage/poetry.rs`（schema/迁移/导入）+ `poetry/parse.rs`（各合集 schema 适配）+ `poetry/sync.rs`（tar.gz 下载与本地导入）+ 简繁归一 + 单元测试（导入幂等、uid 稳定、FTS 建表与查询冒烟、1–2 字查询有结果）。用真实语料跑一遍，核对体积与第二节数字。
- **M2 浏览与详情**：collections/browse/poem/authors/daily 命令、`/library` 主页、虚拟列表、双栏详情、作者小传、发现页（D9）；i18n 提取编译。
- **M3 全文搜索**：search 命令 + 搜索 UI（防抖/高亮/筛选/历史）+ 正文索引开关；性能回归对齐第二节实测值。
- **M4 同步管理**：sync_check/start/cancel/import_local + 进度事件 + `/library/manage` UI + 注释包安装（D7）。
- **M5 收藏**：主库表 + 新 `ExportSection` + toggle/list 命令 + 收藏页 + 纳入 data_export/import（含合集缺失态渲染）。
- **M6 打磨**：动画全量过一遍、`pnpm build` + `cargo test --locked` 全绿、600 行红线复查；移动端适配单独排期，不在本期。

每个里程碑交付前：前端 `pnpm build`（含 `pnpm run extract && pnpm run compile`），后端 `cargo test --manifest-path src-tauri/Cargo.toml --locked`（顺带验证 `bindings.ts` 同步）。

## 七、风险

1. **全宋诗体量**：25 万篇 / 46.9MB 正文，导入耗时与磁盘占用都最大，且 codeload 不支持 Range，断了要重下。对策：默认不勾、UI 明示体积、下载写临时文件并可取消清理、导入分批事务提交。
2. **HTTP 客户端需显式声明**：`Cargo.toml` 里没有任何直接的 HTTP 依赖。`reqwest 0.13.4` 虽已在 `Cargo.lock`，但那是桌面端 `tauri-plugin-updater` 的传递依赖——Rust 不允许使用未声明的传递依赖，必须自己写一行。**决定：在现有的 desktop-only target 段（与 updater 同一段）加 `reqwest`**，流式写临时文件、报进度、可取消。因为它已被编译进桌面二进制，包体与编译时间几乎不变；移动端不启用该段，不受影响。不选 `tauri-plugin-http`（那是给前端 fetch 用的，90MB 过一遍 JS 内存不合适，还要配权限白名单）。`tar` + `flate2` 已在依赖里，解包不用新增。
3. **上游数据质量与 schema 漂移**：字段键三套、蒙学等是嵌套 dict、唐诗三百首藏在蒙学目录里，且上游随时可能改。对策：parser 按合集隔离 + 每合集一个解析测试样本；去重键用 uid；解析失败的条目计数上报而不是整批失败。
4. **网络可达性**：codeload / raw / jsDelivr 都可能不通（实测 raw 间歇 25s 超时）。对策：主通道失败给明确文案 + 本地导入入口；绝不阻塞应用其他功能。
5. **FTS5 行为差异**：bundled SQLite 版本变了可能影响 `contentless_delete`、短语查询。对策：M1 用测试钉住（建表/1 字/2 字/短语/高亮）。
6. **版权边界**：正文 MIT 无忧；注释包爬自古诗文网，按 D7 的独立可选包 + 不分发处理。任何"随包内置"的讨论只针对 MIT 正文。

## 八、待确认清单

- [x] D1 本地 SQLite 方案 ✅
- [x] D2 手动增量同步；一期直连上游 tar.gz + 本地导入，托管包延后 ✅
- [x] D3 全宋诗单独可选、不默认勾选；所有合集一律走下载，不随安装包内置 ✅
- [x] D4 唐诗/宋诗用 zhCN 简体镜像，蒙学暂留繁体，不引转换库 ✅
- [x] D5 单库 `poetry.sqlite3` + 收藏进主库并纳入 data_export，键用内容哈希 uid ✅
- [x] D6 标题/作者进 FTS、正文 LIKE 兜底；正文索引作为可开关升级项，用 bigram ✅
- [x] D7 接 aopao/chinese-gushiwen 注释包（独立可选、不分发）✅
- [x] D8 桌面 master-detail；一期只做桌面 ✅
- [x] D9 发现页做（每日一诗/随机），并入 M2 ✅
- [x] 下载用 `reqwest`，加在 desktop-only target 段 ✅

全部决策已定，可进入 M1。

支持识别bt下载或者在线播放
