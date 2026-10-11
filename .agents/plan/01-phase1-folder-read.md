# Phase 1 —— 读路径换成书文件夹 + 迁移 + 下掉全部编辑入口

**目标**：应用只认"书文件夹"，**书库是一份路径台账**（A11），旧 `.lbook` 只在迁移时读一次（A12），应用对书的内容只读（A5）。

**这一阶段是唯一"大爆炸"的一步**（编辑能力会消失，因为改文件的方式变了）。硬要求：**迁移幂等、原包不动、台账只增不删磁盘**——出问题就退回去。

---

## 与上一版的差别（因为问卷答案，A10–A13）

| 上一版 | 现在 |
|---|---|
| 扫描"库目录"，里面每个文件夹都是书 | **路径台账**：只认登记过的文件夹；书可以在任何位置（A11 / A12） |
| 删除 = 移到 `_trash/` | 删除 = **从台账移除条目**，磁盘一律不碰（A11） |
| Markdown 视图由块拼（`markdownFromBlocks`） | **不做**：两个视图各读自己那段（A10） |
| 保留最小导入向导 + 迁移器 | **没有导入向导**：新增书籍 = "打开一个书文件夹"（A12） |
| 迁移器扫描库目录里的 `.lbook` | 迁移器读**台账的初始状态**（库目录里发现的所有 `.lbook`，一次性），迁完写台账 |

---

## 现状盘点（改之前先认清要碰的东西）

| 现有 | 行数 | 处置 |
|---|---|---|
| `src/main/lbook/reader.ts` `zipIndex.ts` `archiveCache.ts` | ~600 | **删**（PDF 与 JSON 都从普通文件读） |
| `src/main/lbook/packer.ts` `reconstruct.ts` `validate.ts` `manifest.ts` | ~630 | **删**（不再打包/回写/校验包；`uid` 迁移时读一次） |
| `src/main/lbook/ocr.ts` | ~200 | **留**，改成"页 JSON → 渲染层形状"的映射 |
| `src/main/library/service.ts` `importer.ts` `legacy.ts` | 673 | **删**（扫描/导入/保存全部不需要了）；读半边变成"台账 + 读一本书" |
| `src/main/db/**` | 597 | Phase 3 才删；本阶段只把读切走，`reading_progress` 还要用来搬进度 |
| `src/renderer/components/home/{EditDialog,UploadDialog}.tsx` | 677 | **删** |
| `App.tsx` 的 dirty/save/Ctrl+S、`BlockCard` 的编辑按钮 | — | **删** |
| `settings:chooseLibraryDir` / `settings:revealLibraryDir` / `libraryDir` 设置项 | — | 改成"**默认新建位置**"（B7）+ "在资源管理器中打开" |

---

## 任务清单

### T1 偏移扫描器进仓 + 单测 ✅ 已完成（2026-10-11）

- [x] 扫描器已搬到 `src/main/lbook/offsetIndex.ts`：`scanPageSpans()`（流式，前缀就地扫、不重读）、`readSpanAt()`、`readSpan()`。
- [x] 单测 `tests/unit/lbook/offsetIndex.test.ts`（9 个用例）：
  - [x] **跨块**：`chunkBytes` 取 7 / 13 / 64 / 4096 四种尺寸，故意把引号、逗号、转义序列劈开。
  - [x] 字符串里的 `{ } [ ] " \` 与转义引号、以反斜杠结尾的字符串。
  - [x] 多字节 UTF-8（中文 + emoji）被 5 字节分块劈开。
  - [x] `limit` 早退（文件 2MB+，只读“前缀 + 一块”）。
  - [x] 缺 `layoutParsingResults` / 空数组 / 被截断的第三页：都不抛，且已拿到的页仍可单独解析。
  - [x] 真实 fixture：**294 页逐页与整文件 `JSON.parse` 深度相等**（`describe.skipIf(文件不在)`）。
- [x] `scripts/perf-probe.ts` 里那份重复实现已删，改成引用本模块（**探针必须量真要上线的代码**）；换过之后自检仍 665/665、首屏 3.3ms。
- [x] 文档同步：`src/main/lbook/README.md`、`tests/unit/lbook/README.md`、`TEST.md` 职责表。

> 施工中发现的真 bug：第一版把“找数组左括号”的前缀读了一遍、循环里又从磁盘重读——`scannedBytes` 因此账不实（比文件还大）。改成前缀就地扫掉，顺带少一次 IO。

### T2 `meta.json` 契约（`src/shared/bookFile.ts`）✅ 已完成

- [x] `BookMeta`、`BOOK_FORMAT_VERSION`、`parseBookMeta()`（**只报错不抛**）、`writeBookMeta()`（固定键序 + 两空格 + 末尾换行）、`isSafeBookFileName()`。
- [x] 单测 `tests/unit/shared/bookFile.test.ts`（10 个用例）：完整文件、缺 title 不当错、未知键忽略、更高 formatVersion 拒绝、必需字段逐一拒绝、**`ocrFile` 不得跳出文件夹**（`../`、子目录、盘符、绝对路径、`..`）、垃圾输入只报错；写出键序不受插入顺序影响、可往返。

### T3 书库台账（`src/shared/ledger.ts` + `src/main/library/ledger.ts`）✅ 已完成

- [x] 纯函数半边 `src/shared/ledger.ts`（形状 + 解析/序列化，零依赖）；文件半边 `src/main/library/ledger.ts`（`list/add/remove/resolve` + 原子写）。
- [x] 路径语义：在默认新建位置之内存相对路径（**整库改名不断链**），之外存绝对路径；`add()` 按 uid 或解析后的路径去重。
- [x] `remove()` 只动台账（A11），并有单测断言文件夹与其中文件仍在磁盘上。
- [x] 单测 `tests/unit/library/ledger.test.ts`（8 个用例）：空启动、相对/绝对、改名后仍可解析、不重复登记、只删条目、手改坏的台账保住好条目并给 issues、非 JSON 不崩、跨实例持久化 + 原子写。

### T4 读一本书（`src/main/library/book.ts`）✅ 已完成

- [x] `openBook(dir)`：读 `meta.json` → 校验 `ocrFile` 存在且不跳出文件夹 → **懒扫偏移索引**（按需增长：要第 n 页就扫到 2n，顺序阅读收敛为每次翻倍一次），不持有文件句柄（Windows 上句柄会挡住用户改名/移动；每页 open+close 只要 0.01–0.05ms）。
- [x] `readPage(n)`（1-based，对应数组下标 n-1，A8）、`pageCount()`（**以 OCR 文件为准**，与 `meta.pageCount` 的出入留给 Phase 2 的校验器）、`hasPdf`、`readTocText()`、`coverPath()`。
- [x] 单测 `tests/unit/library/book.test.ts`（12 个用例）：页号与下标、跨块不变、越界/非整数报错、页数以文件为准、PDF 缺失仍可读、meta 缺失/非 JSON/缺 uid 报错、**`ocrFile` 跳出文件夹被拒**、封面探测、`toc.json` 读取。

### T5 PDF 区间读改真实文件 ✅ 已完成（2026-10-11）

- [x] `book:readPdfRange` 改成 `fs.read` 普通文件；**保持 `end` 排他**的语义（这条契约写在 `usePdfDocumentProxy.ts` 的注释里）。
- [x] 删掉 `zipIndex.ts` / `archiveCache.ts` 的引用；`closeBook` 那类"未 await 就 EPERM"的坑随之消失。

### T6 页 → 渲染层形状 ✅ 已完成

- [x] `parsing_res_list` → `OcrBlock[]`：`bbox` 现在是数组，不必再 `JSON.parse` 字符串；`is_html_content` 现算。
- [x] `markdownText` = `markdown.text`（A10：就是它本身，不派生）。
- [x] `page_width` / `page_height` 从 `prunedResult.width/height` 取，缺失时按 bbox 推（逻辑照搬 `ocr.ts`）。

### T7 进度改 JSON ✅ 已完成

- [x] `src/main/progress.ts`：`%APPDATA%\LBook\progress.json`，`{ "<uid>": { lastPageNum, updatedAt } }`；原子写，失败不抛。
- [x] `progress:get` / `progress:save` 的 IPC 不变。
- [x] 迁移时把 `reading_progress` 表里的进度搬过去（**必须在 DB 还在时做**，所以属于本阶段）。

### T8 迁移器（`src/main/migrate/lbookToFolder.ts` + `scripts/migrate-folders.ts`）✅ 已完成（2026-10-11，已在真实库上跑过）

> **这些代码在 Phase 3 已经删除**（迁移做完了）：`src/main/migrate/`、`scripts/migrate-folders.ts`、`tests/unit/migrate/`、`tests/helpers/lbookPackage.ts` 与两个依赖都不在了。要再迁一次，见 `03-phase3-drop-sqlite.md` 里那三行 `git checkout` 恢复法。

> `src/main/migrate/` 是**新目录**：按 `AGENTS.md` §1.1 必须同时加 `README.md`（五个固定小节）。

- [x] 输入：库目录里发现的 `.lbook`（一次性清单）；输出：书文件夹 + 台账条目 + 进度条目。
- [x] 逐本：建文件夹（`slugify(title)`，重名加 `-2`）→ 解包 `book.pdf`（**边写边算 sha256 与包内比**，用流式拷贝，不要整块进内存）→ `ocr.json` **逐字节写出** → `toc.json`/封面原样拷 → `writeBookMeta`（`uid` 沿用包内 manifest）→ `ledger.add`。
- [x] **幂等**：目标文件夹已存在且 `meta.json.uid` 相同 → 跳过（但仍确保它在台账里）。
- [x] **失败隔离**：一本失败只报那一本，继续；原包**不移动、不删除**。
- [x] `npm run migrate:folders [--dry-run] [--apply] [--book <片段>] [--root <目录>]`（**默认 dry run**，加 `--apply` 才写）。
- [x] 黄金测试 `tests/unit/migrate/lbookToFolder.test.ts`（11 条）：用 `tests/helpers/lbookPackage.ts` 造的小包跑一遍，断言 PDF 字节相同且 sha256 相符、`ocr.json` 逐字节相同、页数取自 OCR 文件、`toc.json`/封面搬齐、失败时不留半个文件夹、**再跑一次什么都不做**（有台账与没台账两种）。

### T9 打开一个书文件夹（替代导入向导，A12） ✅ 已完成

- [x] `library:open`（新通道）：`dialog.showOpenDialog({ properties: ["openDirectory"] })` → 校验该目录（`meta.json` 在不在、`ocr.json` 能不能定位、`book.pdf` 在不在）→ 合法则 `ledger.add` 并返回摘要；不合法返回**具体的缺什么**。
- [x] 目录里**没有** `meta.json` 时不自动猜：如果同一个目录里有 `book.pdf` + 恰好一个 `*.json`，可以提供"用这些建 meta.json"（写它**是创建**，不是编辑），但要让用户看清将写入什么。
- [x] `dialog:pickFiles` 的 `FileKind` 加 `folder`（或在渲染层直接调 `library:open`）。
- [x] 首页空态与"添加书籍"按钮改成这个流程；文案写明"书可以放在任何位置，应用只记住路径"。

### T10 下掉渲染层编辑入口 ✅ 已完成

- [x] 删 `EditDialog.tsx` / `UploadDialog.tsx` 及其引用。
- [x] `BlockCard.tsx`：删编辑按钮与 `onEdited` 链路（整张卡片变成纯展示）。
- [x] `App.tsx` / `AppHeader.tsx`：删 `dirty` / `docDirty` / Ctrl+S / `savePdf` / 未保存圆点。
- [x] `HomePage`：删 `Unsaved` 徽标；卡片上的操作改成"打开"+"在资源管理器中显示"+"从书库移除"（最后一项只删台账条目，文案要写明"不会删除文件"）。
- [x] `src/renderer/api/pdfs.ts` 的写函数删掉。
- [x] 设置页：`libraryDir` 那一段改成"默认新建位置"（B7）；"在资源管理器中打开"保留。

### T11 删主进程写路径与 IPC ✅ 已完成

- [x] 删通道：`book:updateBlock`、`book:save`、`book:replaceOcr`、`book:replaceCover`、`book:replaceToc`、`book:clearToc`、`library:scan`、`library:import`、`library:createFromFiles`、`library:delete`、`settings:chooseLibraryDir`、`settings:revealLibraryDir`。
- [x] 保留：`library:list`（改读台账）、`library:get`、`library:open`（新）、`book:listPages/getPage/readPdfRange/getToc`、`progress:*`、`settings:get/set`、`dialog:*`、`updates:*`、`window:*`、`translate:*`、`app:hello`。
- [x] 删 `packer.ts` / `reconstruct.ts` / `validate.ts` / `manifest.ts` / `importer.ts` / `legacy.ts` 与 `service.ts`。
- [x] grep 自检：`grep -rn "book:save\|updateBlock\|replaceOcr\|library:scan\|repack" src/` 为空。
- [x] **删除相关的文案一律写清"只从书库移除，文件不动"**——这是 A11 的对外承诺。

### T12 测试与文档同步 ✅ 已完成

- [x] 删：`tests/unit/lbook/{reader,validate,zipIndex,manifest}.test.ts`、`tests/unit/library/service.test.ts`（`tests/unit/db/**` 留到 Phase 3）。
- [x] 加：`offsetIndex`、`bookFile`、`ledger`、`book`、`migrate` 五个测试文件；相应目录的 `README.md` 同步。
- [x] `TEST.md`：第 3 节职责表、第 4 节黄金用例（改成"迁移保真"）、第 6 节手工清单（"编辑与保存"整节换成"书文件夹"）。
- [x] `DESIGN.md`：§5 数据层、§6 `.lbook` 格式规范（改成"文件夹布局 + `.lbook` 只作迁移输入"）、§5.5 的那条限制改成"有意为之"（A10）。
- [x] 目录 README：`src/main/lbook/`、`src/main/library/` 重写；`src/main/migrate/README.md` 新增；`src/renderer/components/home/` 更新。
- [x] `.agents/plan/README.md` 状态表改成 ✅。

---

## 验收

**必须全绿：**

```bash
npm run typecheck && npm run lint && npm run check:docs && npm test
npm run probe:perf
```

**迁移（A13：先备份，可重复执行）——2026-10-11 已在真实的 5 本上完成：**

- [x] 备份：5 个 `.lbook` + `lbook.db` + `config.json` 复制到 `D:\LBook-backup-2026-10-11`（610MB，附 `SHA256SUMS.txt`）；原件的 sha256 与备份记录逐项相同。
- [x] `npm run migrate:folders` 看计划 → `--apply` 真跑（5 本共 ~800ms）→ **再跑一次 5 本全部跳过**（幂等）。
- [x] 逐本核对（**用独立脚本读包**，不复用迁移器自己的断言）：uid/标题与包一致；PDF sha256 等于**包内自报**的 `pdfSha256`；`ocr.json` 与包内条目**逐字节相同**；页数 = OCR 数组长度 = 包内 `pageCount`；`toc.json` 存在性一致；进度搬齐——共 61 项全过。
- [x] 原 `.lbook` 仍在原处，哈希与备份一致，**没被动过**。
- [ ] `library.json` 里 5 条路径都对（已核对）；把其中一条的文件夹改名 → 列表显示“需要修复”，点“从书库移除”后条目消失、**磁盘上的文件夹仍在**（装好新版应用后手工点一遍）。

**手工过一遍（`TEST.md` 第 6 节“基本链路”）——待装好新版应用后逐条走：**

- [ ] 打开一本大书（先拿 665 页的 BPP）：能列、能翻页、能缩放、Fit Width、Flow 连滚 6 屏不卡、没有白页。
- [ ] 目录跳转、当前页跟随、划词翻译、主题切换、阅读字号滑块、语言切换都还在。
- [ ] 阅读进度回到了迁移前的位置（BPP 22、OPD 3ed 5、OPD 1、初级会计 238、经济法 98）。
- [x] ~~编辑入口全部消失（界面 + `grep -rn "book:save\|updateBlock" src/` 为空）—— grep 已经为空。~~ → **Phase 1 当时确实清干净了写路径**，但这条后来被推翻了：A17 把"新建/维护"请了回来，Phase 4 又加回了**内容修正**（改一个块或一页的 Markdown，写进 `ocr.json`）。所以现在"编辑入口"有两个，且**只在翻页模式下**（A18/A22、`04-phase4-content-edit.md`）。留着这条是因为它记录了一个真实的历史状态，而不是它现在还对。

- [ ] 外部改文件：把 `ocr.json` 里某页的一个字改掉（页数不变），**重启应用**后该页能看到（自动重读是 Phase 2）。
- [ ] 把某本 `meta.json` 删掉 → 列表里那本显示“需要修复”，应用不崩，其他书照常。

---

## 风险与注意

| 风险 | 注意什么 |
|---|---|
| **迁移把用户的库搞坏** | 先备份（A13）+ 原包不删 + 逐本失败隔离 + 幂等 + `--dry-run` |
| `ocr.json` 很大，迁移时内存 | 流式拷贝（`createReadStream` → `WriteStream`），别用 `readEntry` 整块读 |
| 页号语义（A8） | 页 = 数组下标；迁移后校验"页数 = meta.pageCount = PDF 页数"，不符要在书库标出来 |
| 句柄与 Windows | 所有 `fd` 用完即关；写文件 `await` 流结束 |
| 渲染层形状被"顺便改了" | A6：`book:getPage` 等返回形状**不变**；要改就单独一次提交并同步 `src/shared/types.ts` |
| **"删除"的语义容易被误解** | 只在台账里删条目（A11），UI 文案必须写"文件不会被删除"；发现用户找不到文件时给"在资源管理器中显示" |
| 编辑能力消失的落差 | 这一阶段的主要代价；靠 T9 的"打开文件夹"+ "在资源管理器中显示"补手感 |

---

## 相关文档

- 父级：[README.md](./README.md)
- 同级：[`00-decisions.md`](./00-decisions.md)、[`baseline.md`](./baseline.md)、[`02-phase2-reactivity-validation.md`](./02-phase2-reactivity-validation.md)
- 相关：[../../PLAN.md](../../PLAN.md) 第 4、7、8 节
