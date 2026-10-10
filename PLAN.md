# PLAN.md —— 从单文件 `.lbook` 到 Obsidian 式文件夹书库

> **状态：计划，未实施。** 本文只写目标、取舍与阶段；当前实现仍在 `DESIGN.md` 里。第 11 节是等你拍板的决策清单，其余章节都已给出建议。

---

## 1. 一句话

把"一本书 = 一个 `.lbook` 压缩包 + 一条 SQLite 记录"改成"**一本书 = 一个文件夹**"：PDF 与各类元数据都是普通文件，用户用任何编辑器改；应用只**读**，不再提供任何编辑入口；SQLite 从"数据库"退化为"可丢弃的缓存"，最终删掉。

---

## 2. 现状的代价（为什么值得动）

| 现状 | 代价 |
|---|---|
| 书的内容在 `.lbook` 压缩包里 | 改一个字必须过 UI；批量改只能自己解包写脚本 |
| 保存 = 全量重写整个包 | 190MB 的书 1–3 秒；Windows 上任何未 `await` 的 `close()` 都会 `EPERM`（`DESIGN.md` §12） |
| PDF 走 `book:readPdfRange` 区间读 zip 条目 | 需要 yauzl 句柄缓存、`dataStart` 局部文件头推算、STORE 强制、`requestDataRange` 的排他 `end`（§4.2 / §6.1 / §6.3） |
| SQLite 是真相、`.lbook` 是大块 | 两处真相：库目录一动，索引与磁盘就各自说各自的 |
| `better-sqlite3` 是唯一原生依赖 | 打包最脆的一环：`asarUnpack` + `npmRebuild` + esbuild `external` 三处配置，`BUILD.md` 第 5 节整节在讲它 |
| 编辑链路 | `dirty` 列、Ctrl+S、未保存圆点、EditDialog、UploadDialog、写回重打包 |
| 一页两份文本（`markdown` 与块） | 两个视图会不一致，而 markdown 那份用户改不动（上一轮实测：`markdown_text` **95.2% 逐字节等于**"块的拼接"） |

---

## 3. 目标与边界

**目标**

- 一本书 = 一个文件夹。文件名与字段自解释，`git init` 一下就能版本管理。
- 应用对**书的内容只读**。写入只允许三类：库配置（`config.json`）、阅读进度（应用数据目录）、以及"导入向导"显式创建新书（若保留，见第 11 节第 4 条）。
- 外部编辑应用内可感知：窗口聚焦或文件变动后自动重读，**不需要重启**。
- 坏文件**在书库里就要显眼地报出来**（哪个文件、哪一行、期望什么），而不是等打开时才崩。
- 为后期的 Monaco 按页编辑留好接缝：校验器与错误信息与将来的编辑器诊断**同源**。

**不变量（现有的好性质必须保住）**

- PDF 逐字节不变——迁移、打开、以后任何动作都不改它。
- 渲染层不碰 fs：仍然只有 `window.api` 白名单 + 自定义协议。
- `app.getPath()` 只在 `src/main/index.ts` 调一次，路径靠 `AppContext` 注入（`AGENTS.md` §3）。
- `src/shared/` 零依赖、纯函数，能在纯 Node 测试里 import。
- 已经手工验过的行为不受影响：翻页 / 缩放 / Fit Width / Flow 模式 / 划词翻译 / 主题 / 阅读字号。

---

## 4. 目标目录结构

```
<库目录>/
  BPP Financial Accounting/     ← 一个文件夹 = 一本书；文件夹名只用于显示，不参与身份
    book.pdf                    ← 原样，不改（迁移时校验 sha256）
    meta.json                   ← 我们自己的元数据：uid / 标题 / 作者 / 页数 / 来源 / 版本
    toc.json                    ← 目录（沿用现有契约与 parseToc 校验）
    cover.jpg                   ← 封面（可选）
    pages/0021.json             ← 一页一个文件：PaddleOCR 那一页的 layoutParsingResults[i] 原样
    assets/…                    ← 预留：OCR 图片本地化后的落点（现在还是百度签名 URL，抓不下来）
  _legacy/…                     ← 迁移前的 .lbook 原包（只作备份，扫描忽略）
```

### 决策 1：页级文件，而不是一个 20MB 的 `ocr.json`（建议）

| | 每页一个文件（建议） | 单个 `ocr.json` |
|---|---|---|
| 手改体验 | 打开的是"某一页"的小文件 | 打开 20MB 文件 |
| 后期 Monaco | 一页一个文档，天然合适 | 20MB 文档，编辑器会卡 |
| diff / git | 一页的改动就是一个小文件 | 改一个字，20MB 整段 diff |
| 与 PaddleOCR 输出对照 | `dataInfo` + 按页码排序即原数组，**无损** | 逐字节一致，最省心 |
| 文件数 | 1872 页/本 → 1872 个；100 本约 3.7 万 | 1 个/本 |

PaddleOCR 的输出本来就是 `layoutParsingResults[]` 一页一项，**拆成一页一个文件不是有损变换**；要给回原工具时，`dataInfo` + 有序页文件可以重新拼出原 JSON（Phase 2 可提供一个只读的"导出原始 `ocr.json`"）。

### 决策 2：`markdown.text` 留在文件里，但视图不再读它（建议）

页文件按 PaddleOCR 原样保存（`prunedResult` 与 `markdown` 都在），所以什么都不丢；但**渲染时 Markdown 视图由块拼**（`markdownFromBlocks(blocks)`）。这样"改块 → 两个视图一致"在新架构里自然成立，磁盘上又留着 OCR 原文可对照。

依据是上一轮对真实库的实测（1872 页）：丢掉 `header` / `header_image` / `footer` / `footer_image` / `number` / `aside_text` 六类页眉页脚块之后，按顺序拼接块内容与 `markdown_text` **逐字节相等 95.2%**、**仅差空白 99.4%**、**真正的文本差异只有 1 页 1 个字符**（`○` vs `O`），另有 2 页"有 markdown、无块"（回退到文件里那份）。markdown 标记本来就在块内容里（`paragraph_title` 的内容就是 `"### 1 Nature…"`），所以拼接**不需要复刻 PaddleOCR 的排版器**。

### 决策 3：阅读进度不进书文件夹（建议）

进度是"这台机器读到哪"的状态，不是书的内容。放进书文件夹会让只读挂载、网络盘、`git status` 都变麻烦。建议放 `%APPDATA%\LBook\progress.json`（按 `uid` 索引），书文件夹整体可只读挂载。

---

## 5. 身份、扫描与外部改动

- **身份**：`meta.json` 的 `uid`（迁移时沿用现有 `uid`，所以**进度不丢**）。文件夹改名不改身份。
- **扫描**：只读每本书的 `meta.json`（一本书一个文件，**不碰 `pages/`**），构造内存索引；页与目录按需读。
- **重复身份**：两个文件夹声明同一个 `uid`（用户复制了文件夹）→ 两个都列出来，其一标"重复"，让用户自己改名或删；**应用不自动改写文件**。
- **外部改动**：`fs.watch(libraryDir, { recursive: true })` + 去抖 300ms + 窗口聚焦时重扫；正在读的那页若变了就重读（保持页码与滚动位置）。网络盘上 watch 不可靠，另给一个显式的"重新扫描"按钮并做 30s 轮询兜底。
- **移出/删除**：扫描发现消失就从索引移除；进度留在 `progress.json`，书回来还能接着读。
- **坏书**：`meta.json` 缺 `uid`、PDF 不存在、页文件 JSON 坏、页号断号、页数与 PDF 不符 → 书库照样列出，标"需要修复"，点开显示**文件 + JSON 路径 + 期望**。

---

## 6. 校验（"用户自己改文件"的前提）

| 文件 | 校验什么 | 坏了的后果 |
|---|---|---|
| `meta.json` | `uid`（非空字符串）/ `title` / `pageCount` / `formatVersion`；**未知键保留不动**（我们不再写它，所以天然保留） | 标"不可识别"，不进书库正文 |
| `pages/NNNN.json` | `prunedResult.parsing_res_list` 是数组；每块 `block_bbox` 是 4 个数；`markdown.text` 是字符串或缺失；页号与文件名一致 | 该页标"需修复"，其余页仍可读 |
| `toc.json` | 现有契约（`parseToc`，已经有一整套单测） | 目录栏显示错误，正文不受影响 |
| 交叉 | 页文件数量 vs `meta.pageCount` vs PDF 真实页数；断号 | 标"页数不符"，仍可打开 |
| `book.pdf` | 文件头 `%PDF-`；打开失败要报"这个 PDF 坏了"而不是白屏 | 标"PDF 无法打开" |

校验器与 UI 同源：同一套消息将来直接喂给 Monaco 的 diagnostics，所以第 7 节不做第二套。

---

## 7. 删除清单（这次重构真正的收益）

| 层 | 规模 | 处置 |
|---|---|---|
| `src/main/lbook/`：`reader.ts` `zipIndex.ts` `packer.ts` `validate.ts` `reconstruct.ts` `archiveCache.ts` | 共 1158 行，其中 `ocr.ts`（解析 PaddleOCR JSON）留下 | 删约 800 行 |
| `src/main/db/**`（含 `repositories/`） | 597 行 | 全删（进度换成约 50 行的 JSON 存储） |
| `src/main/library/`：`service.ts` 的保存链路、`importer.ts` 的写入链路 | 共 673 行 | 删/重写约 250 行 |
| `src/renderer/components/home/EditDialog.tsx`、`UploadDialog.tsx` | 677 行 | 全删（导入向导若保留则重写，规模远小于原 `UploadDialog`） |
| IPC：`book:updateBlock` `book:save` `bookReplaceOcr` `bookReplaceCover` `bookReplaceToc` `bookClearToc` `library:createFromFiles` `library:import` | — | 删；渲染层从此没有任何写通道 |
| `dirty` 模型：`dirty` 列、Ctrl+S、未保存圆点、`Unsaved` 徽标 | — | 删 |
| 依赖：`better-sqlite3`（`node_modules` 27MB）、`yauzl`、`yazl` | — | 删 |
| `electron-builder.yml` 的 `asarUnpack`/`npmRebuild`、`scripts/build.mjs` 的 `external`、`BUILD.md` §5 整节、`DESIGN.md` §4.2/§5/§6/§12 相关条目 | — | 删/重写 |

粗算：**净删 2500–3000 行**（`src` + `tests` 现为 13374 行，约 20%），外加三个依赖与一节打包排错文档。顺带消失两个已知坑：Windows 上未 `await` 的 `close()` 导致 `rename EPERM`，以及"保存全量重写 190MB"。

---

## 8. 迁移（`.lbook` → 文件夹）

- **触发**：首次启动发现库目录里只有 `.lbook`（或用户在设置里点"迁移书库"）。逐本迁移，失败只影响那一本。
- **步骤**：建文件夹（`slugify` + 重名加序号）→ 解包 `book.pdf`（**校验 sha256 与包内一致**）→ `ocr.json` 的 `layoutParsingResults[i]` 拆成 `pages/NNNN.json`（保留全部键）→ `toc.json` 与封面原样拷 → 写 `meta.json`（`uid` 沿用库里那个）→ 进度从 DB 抄进 `progress.json`。
- **原包一律保留**（不移动、不删除），新建 `_legacy/` 或原地留着，扫描忽略 `.lbook`。
- **验收（沿用 `TEST.md` §4 黄金用例的路子）**：迁移真实库的 5 本后逐项比对——PDF 逐字节相同、页数相同、每页 `prunedResult` 与 `markdown` **JSON 深度相等**、目录条目数相同、进度页码相同；且**迁移可重复执行**（第二次什么都不做，幂等）。

---

## 9. 阶段（每段可独立验收、可停）

| 阶段 | 内容 | 验收 |
|---|---|---|
| **Phase 0 定调**（0.5 天） | 第 11 节的 6 个决策拍板；量基线：扫 100 本的 `meta.json` 耗时、列 1872 个页文件的耗时、打开 190MB 书的现存内存与首帧 | 拿到数字，写下"页级文件"是否成立（否则改分片，见 §10） |
| **Phase 1 读路径 + 迁移**（2–3 天） | 新增 folder 存储层（list / readPage / readToc / readCover / readPdfRange）；协议改为真实文件范围读；迁移器 + 黄金测试；**同时下掉所有编辑入口**（UI 上明说"想改就改文件"），SQLite 暂时保留为 listing 缓存以便随时回退 | 真实库迁移后书库能列、能读、能翻页；改了 `pages/0021.json` 里的一个字，重开该页能看到 |
| **Phase 2 反应式与校验**（1–2 天） | watch + 聚焦重扫 + 手动刷新；校验 UI（坏书徽标 + 明细）；"在资源管理器中打开 / 用系统默认程序打开该文件" | 外部改 `toc.json` 后切回窗口即生效；把 `meta.json` 改坏 → 书库标红但**不崩**、其他书照常 |
| **Phase 3 删索引与原生依赖**（1 天） | 删 db 层与 `better-sqlite3`（进度改 JSON）、删 `yauzl`/`yazl` 与打包配置、重写 `DESIGN.md` §5/§6/§12、`BUILD.md` §5、`TEST.md` 职责表 | `npm ls better-sqlite3 yauzl yazl` 为空；打包不再需要 `asarUnpack`；安装包体积下降（按 `node_modules` 里 27MB 粗估） |
| **Phase 4 后期：Monaco 按页编辑**（独立立项） | 只写 `pages/NNNN.json` 与 `meta.json`；保存前跑 **Phase 2 那同一个校验器**，保存后靠 watch 回读；用 JSON Schema 生成 Monaco markers | 改坏一个字段 → 编辑器里当场标红并拒绝保存；保存合法的修改 → 两个视图同步更新 |

Phase 4 是唯一重新引入"写"的阶段，而且写的是**文件**，不是数据库——所以它不影响 Phase 1–3 的只读基线。

---

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| **每页一个文件的数量**（1872 页/本，100 本约 3.7 万文件）：OneDrive/网盘同步风暴、Defender 扫描、列目录变慢 | Phase 0 先量。不达标就把页文件改成分片（`pages/0001-0050.json`）——这是**一个配置点**，不影响其余设计 |
| 迁移不可逆 | 原包保留 + PDF 逐字节校验 + 幂等 + 逐本失败隔离 |
| 失去"单文件便携" | 若这是真需求，Phase 4 之后加"导出为只读归档"（`yazl` 那时才需要回来，且只用于导出） |
| 用户手改出语法错误 | 校验器只报错不抛异常；**绝不能因为一本书坏而挡住整个书库** |
| `fs.watch` 在 Windows 上会重复/丢事件 | 去抖 + 轮询兜底，不迷信 watch |
| 已装的 0.0.1 用户升级后书库要能自动迁移且不丢进度 | Phase 1 的黄金测试必须包含"从真实 0.0.1 库迁移"这一条 |

---

## 11. 需要你先定的 6 件事

1. **页级文件 vs 单个 `ocr.json`** —— 建议页级（决策 1）。
2. **Markdown 视图由块拼 vs 读文件里的 `markdown.text`** —— 建议由块拼，文件保留原文（决策 2）。
3. **阅读进度放 `%APPDATA%` vs 书文件夹内** —— 建议 `%APPDATA%`（决策 3）。
4. **是否保留"导入向导"**（应用创建新书文件夹）—— 建议保留一个最小的（选 PDF + OCR JSON → 建文件夹），因为纯扫描要求用户自己会拼目录结构；但**不保留任何后续编辑**。
5. **是否保留 `.lbook` 读取能力**（双格式并存）—— 建议不保留：一次性迁移 + 原包留底，代码里只留迁移器。
6. **是否要 git 友好**（决定 JSON 是否 pretty-print、字段顺序是否稳定）—— 建议要：所有我们生成的 JSON 一律两空格缩进、键顺序固定，页文件保持 PaddleOCR 原样（不重排）。

---

## 12. 本计划**不做**

- 不做云同步、多端、多用户并发写。
- 不做 OCR 本身（仍然由外部 PaddleOCR 产出）。
- 不做全文检索（要做得单独立项，见 `DESIGN.md` 的已知限制）。
- 不把 PDF 放进 git（库目录可版本管理，但要配 `.gitignore` 忽略 `book.pdf`）。
- 不为了这次重构顺手改渲染层外观（主题、字号、分隔条都保持现状）。

---

## 13. 相关文档

- 父级：[README.md](./README.md)
- 同级：[DESIGN.md](./DESIGN.md)、[BUILD.md](./BUILD.md)、[TEST.md](./TEST.md)、[AGENTS.md](./AGENTS.md)
- 相关：[src/main/lbook/README.md](./src/main/lbook/README.md)、[src/main/library/README.md](./src/main/library/README.md)、[src/main/db/README.md](./src/main/db/README.md)
