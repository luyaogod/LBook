# Phase 1 —— 读路径换成文件夹 + 一次性迁移 + 下掉全部编辑入口

**目标**：库目录变成真相（一本书一个文件夹），应用只能读；旧的 `.lbook` 原包留着，随时能回退。

**规模**：这是四个阶段里唯一"大爆炸"的一步（编辑能力会暂时消失，因为改文件的方式变了）。所以它的验收里有一条硬要求：**迁移可重复执行、原包不删**——出问题就退回去。

---

## 现状盘点（改之前先认清要碰的东西）

| 现有 | 行数 | 处置 |
|---|---|---|
| `src/main/lbook/reader.ts` `zipIndex.ts` `archiveCache.ts` | ~600 | **删**（PDF 与 JSON 都从普通文件读了） |
| `src/main/lbook/packer.ts` `reconstruct.ts` `validate.ts` | ~550 | **删**（不再打包、不再回写、不再校验 `.lbook`） |
| `src/main/lbook/ocr.ts` | ~200 | **留**，改造成"页 JSON → 渲染层形状"的映射 |
| `src/main/lbook/manifest.ts` | ~80 | **删**（`meta.json` 取代它；`uid` 迁移时沿用） |
| `src/main/library/service.ts` `importer.ts` `legacy.ts` | 673 | 读半边**重写**成 `folder.ts`；写半边与 legacy 迁入**删** |
| `src/main/db/**` | 597 | Phase 3 才删；本阶段先把读切过去，只留 `progress` 与 `pdf_documents` 的旧路径兜底 |
| `src/renderer/components/home/{EditDialog,UploadDialog}.tsx` | 677 | **删** |
| `src/renderer/App.tsx` 的 dirty/save/Ctrl+S | — | **删** |
| `src/renderer/components/sidebar/BlockCard.tsx` 的编辑按钮 | — | **删** |

---

## 任务清单

### T1 偏移扫描器进仓 + 单测

- [ ] 把 `scripts/perf-probe.ts` 里的 `scanOffsets` / `scanBytes` / `findArrayStart` 搬到 `src/main/lbook/offsetIndex.ts`，连同 `readPageSlice(fd, start, end)`。
- [ ] 单测 `tests/unit/lbook/offsetIndex.test.ts`：
  - [ ] **跨块**：构造 > `CHUNK`（1MB）的 JSON，元素边界分别落在块内、块首、块尾、跨两块——这是最容易错的地方。
  - [ ] 字符串里出现 `{ } [ ] " \` 与转义引号：不该被当成结构。
  - [ ] 多字节 UTF-8（中文、emoji）在字符串里：字节状态机不受影响。
  - [ ] `limit` 早退：取 30 页时只读到第一个元素之后不远处。
  - [ ] 缺 `layoutParsingResults`、数组是空的、文件被截断（半截元素）→ 返回已有结果而不是抛异常。
  - [ ] 真实 fixture（`dev-data/Oxford Picture Dictionary 3 ed.ocr.json`）：全部页与 `JSON.parse` 的结果逐页深度相等（探针已经这么验过，把它固化成单测）。
- [ ] 注释里写清"为什么流式、为什么不需要跨块残留"（`PLAN.md` 4.2 的结论）。

### T2 `meta.json` 契约（`src/shared/bookFile.ts`）

- [ ] 定义 `BookMeta`：`formatVersion` / `uid` / `title` / `author?` / `pageCount` / `ocrFile` / `createdAt?` / `source?`。
- [ ] `parseBookMeta(raw: unknown): { meta: BookMeta } | { error: string }`——纯函数、零依赖，**校验而不是抛异常**（坏书要能列出来）。
- [ ] 单测：缺 `uid`、`pageCount` 非数字、`ocrFile` 指向不存在的文件、未知键**保留不报错**。
- [ ] 写出格式：两空格缩进、键序固定（`PLAN.md` 决策 B5）——写一个小函数统一，别在各处手写 `JSON.stringify`。

### T3 folder 存储层（`src/main/library/folder.ts`）

- [ ] `listBooks(libraryDir): Promise<BookSummary[]>`——`readdir` + 每本读 `meta.json`；`meta.json` 坏的书也返回，带 `problem` 字段。
- [ ] `openBook(dir)`：定位 `ocr.json`、扫偏移（懒，第一次用到才扫）、拿 `pageCount`。
- [ ] `readPage(dir, pageNum): Promise<{ page, blocks }>`——形状与现在 `book:getPage` 完全一致（A6）。
- [ ] `readToc` / `readCover` / `pdfPath` / `pdfSize`。
- [ ] 用 `fs.promises` + 一次性 `fd`（读完就关，别留句柄——Windows 上句柄没放会挡住用户改名/移动，这是现状里踩过的坑）。
- [ ] 单测 `tests/unit/library/folder.test.ts`：用临时目录造 2~3 本假书（小 JSON），覆盖"meta 坏""ocr.json 缺""页号越界""空目录"。

### T4 PDF 区间读改真实文件

- [ ] `book:readPdfRange` 的实现改成 `fs.read` 到普通文件（保持"`end` 排他"的语义——现在这条契约写在 `usePdfDocumentProxy.ts` 的注释里，别改坏）。
- [ ] 删掉 `zipIndex.ts` / `archiveCache.ts` 的引用；确认没有 `closeBook` 之类需要 await 的收尾（这正是 `EPERM` 那条已知坑的来源，删掉它等于根治）。

### T5 页 → 渲染层形状

- [ ] `parsing_res_list` → `OcrBlock[]`：`bbox` 现在是**数组**，不需要再 `JSON.parse` 字符串；`is_html_content` 现在要现算（现状是入库时算好的，现改成读时算）。
- [ ] `markdownText` 来自 `markdown.text`（T7 决定视图是否改用它）。
- [ ] `page_width` / `page_height` 从 `prunedResult.width/height` 取（缺失时按 bbox 推，逻辑现在在 `ocr.ts` 里，照搬）。

### T6 进度改 JSON（待 B2 拍板，默认 `%APPDATA%`）

- [ ] `src/main/progress.ts`：`%APPDATA%\LBook\progress.json`，形如 `{ "<uid>": { lastPageNum, updatedAt } }`；原子写（temp + rename），失败不抛。
- [ ] `progress:get` / `progress:save` 的 IPC 不变。
- [ ] 迁移时把 `reading_progress` 表里的进度搬过去（**必须在 DB 还在的时候做**，所以属于本阶段而不是 Phase 3）。

### T7 Markdown 视图由块拼（待 B1）

- [ ] `src/shared/markdown.ts`：`markdownFromBlocks(blocks)`——丢掉 `header` / `header_image` / `footer` / `footer_image` / `number` / `aside_text` 六类，其余按 `block_index` 顺序用空行拼接（**不 trim**，块内容自带尾随换行）。
- [ ] 单测：用真实 fixture 断言"拼出来的与 `markdown.text` 的关系"（逐字节/忽略空白两种口径都写下来，避免以后有人以为它们必须全等）。
- [ ] 该页**没有块**时回退到 `markdown.text`（实测有 2 页这种情况）。
- [ ] `OcrSidebar` 与复制按钮改用它；`BlockCard` 不受影响（它本来就逐块渲染）。

### T8 迁移器（`src/main/migrate/lbookToFolder.ts` + `scripts/migrate-folders.ts`）

> `src/main/migrate/` 是**新目录**：按 `AGENTS.md` §1.1 必须同时加 `README.md`（五个固定小节）。

- [ ] 逐本：建文件夹（`slugify(title)`，重名加 `-2`）→ 解包 `book.pdf`（**边写边算 sha256，与包内比**）→ `ocr.json` **逐字节写出** → `toc.json`/封面原样拷 → 写 `meta.json`（`uid` 沿用包内 manifest，进度从 DB 搬）→ 写 `progress.json` 条目。
- [ ] **幂等**：目标文件夹已存在且 `meta.json.uid` 相同 → 跳过。
- [ ] **失败隔离**：一本失败只报那一本，继续下一本；原包**不移动、不删除**。
- [ ] `npm run migrate:folders [-- --book <片段>] [--dry-run]`；`--dry-run` 只打印计划。
- [ ] 黄金测试 `tests/unit/migrate/lbookToFolder.test.ts`：用 `tests/helpers/lbook.ts` 造的小包跑一遍，断言 PDF 字节相同、`ocr.json` 字节相同、页数相同、进度相同、再跑一次什么都不做。

### T9 最小导入向导（待 B3，可延到 Phase 2）

- [ ] 选 PDF + OCR JSON → 建文件夹 + 写 `meta.json`；**不提供任何后续编辑**。
- [ ] 若延后：Phase 1 的起手方式是"用户自己摆文件夹"，文档里要写清楚目录结构与字段。

### T10 下掉渲染层编辑入口

- [ ] 删 `EditDialog.tsx`、`UploadDialog.tsx` 与它们的引用（`HomePage` 的按钮、`App.tsx` 的 state）。
- [ ] `BlockCard.tsx`：删编辑按钮与 `onEdited` 链路。
- [ ] `App.tsx`：删 `dirty` / `docDirty` / Ctrl+S / `savePdf` / 未保存圆点（`AppHeader` 的 `dirty` 属性一并删）。
- [ ] `HomePage` 的 `Unsaved` 徽标删掉。
- [ ] `src/renderer/api/pdfs.ts` 里的写函数删掉。
- [ ] UI 上明说"想改就改文件"：书库里给一行提示（在资源管理器中打开所在的文件夹入口放这里，Phase 2 做完整）。

### T11 删主进程写路径与 IPC 通道

- [ ] 删通道：`book:updateBlock`、`book:save`、`book:replaceOcr`、`book:replaceCover`、`book:replaceToc`、`book:clearToc`、`library:createFromFiles`、`library:import`（保留 `library:list/get/scan`、`book:listPages/getPage/readPdfRange/getToc`、`progress:*`、`settings:*`、`dialog:pickFiles`）。
- [ ] 删 `packer.ts` / `reconstruct.ts` / `validate.ts` / `importer.ts` 与 `service.ts` 里的保存链路。
- [ ] ⚠️ **B6 待拍板**：`library:delete` 怎么办？现在它是"删包 + 删索引行"。建议：**移到 `_trash/`**（可撤销），而不是直接 `rm -rf` 用户的文件夹。
- [ ] 删完 grep 一遍：`grep -rn "book:save\|updateBlock\|replaceOcr\|repack" src/` 应为空。

### T12 测试与文档同步

- [ ] 删：`tests/unit/db/**`（若本阶段还留着 db 就留到 Phase 3）、`tests/unit/lbook/{reader,validate,zipIndex,manifest}.test.ts`、`tests/unit/library/service.test.ts`。
- [ ] 加：`offsetIndex`、`bookFile`、`folder`、`markdown`、`migrate` 五个测试文件（都要有 `tests/unit/**/README.md` 的对应更新）。
- [ ] `TEST.md`：第 3 节职责表、第 4 节黄金用例（改成"迁移保真"）、第 6 节手工清单（把"编辑与保存"整节换成"文件夹式书库"）。
- [ ] `DESIGN.md`：§5 数据层、§6 `.lbook` 格式规范（本阶段先加一段"文件夹布局"并标注 `.lbook` 只作迁移输入）。
- [ ] 目录 README：`src/main/lbook/`、`src/main/library/` 重写；`src/main/migrate/README.md` 新增；`src/renderer/components/home/` 删掉对话框后要更新。
- [ ] `AGENTS.md` §2 不需要改；`.agents/plan/README.md` 的状态表改成 ✅。

---

## 验收（跑这些，把结果追加到 `baseline.md`）

**必须全绿：**

```bash
npm run typecheck && npm run lint && npm run check:docs && npm test
npm run probe:perf
```

**迁移（可重复执行是硬要求）：**

```bash
npm run migrate:folders -- --dry-run     # 先看计划
npm run migrate:folders                  # 真跑
npm run migrate:folders                  # 再跑一次：应当什么都不做（幂等）
```

- [ ] 5 本全部迁完；逐本 PDF sha256 与包内一致；`ocr.json` 与包内**逐字节相同**；页数一致；进度一致。
- [ ] 原 `.lbook` 仍在库目录里（**没有被动过**）。
- [ ] 库目录结构：每本一个文件夹，里面 `book.pdf` / `*.json` / `meta.json`（+ 可选 `toc.json` / 封面）。

**手工过一遍（`TEST.md` 第 6 节的"基本链路"那一节）：**

- [ ] 打开一本大书：能列、能翻页、能缩放、Fit Width、Flow 连滚 6 屏不卡、没有白页。
- [ ] 目录跳转、当前页跟随、划词翻译、主题切换、阅读字号滑块都还在工作。
- [ ] 编辑入口全部消失：界面上找不到任何"改内容"的按钮；`grep -rn "book:save\|updateBlock" src/` 为空。
- [ ] 外部改文件：用编辑器把 `ocr.json` 里某一页的一个字改掉（页数不变），**重启应用**后该页能看到改动（自动重读是 Phase 2）。
- [ ] 把某本的 `meta.json` 改名/删掉 → 书库里那本显示为"需要修复"，**应用不崩**，其他书照常。

---

## 风险与注意

| 风险 | 注意什么 |
|---|---|
| **迁移把用户的库搞坏** | 原包不删 + 逐本失败隔离 + 幂等 + `--dry-run`；迁移前先让用户备份库目录（文档里写） |
| `ocr.json` 很大，迁移时内存 | 用流式拷贝（`fs.createReadStream` → `WriteStream`），别 `readEntry` 整块进内存——现状 `readEntry` 是整块读，迁移时要用流式版本 |
| 页号语义（A8） | 页 = 数组下标；迁移后校验"页数 = meta.pageCount = PDF 页数"，不符要在书库里标出来 |
| 句柄与 Windows | 所有 `fd` 用完即关；迁移写文件时 `await` 流结束；这是现状里 `EPERM` 那条坑的根源 |
| 渲染层结构被"顺便改了" | A6：`book:getPage` 等的返回形状**保持不变**，只换实现；一旦要改形状，单独一次提交 + 同步改 `src/shared/types.ts` |
| 编辑能力消失导致的落差 | 这是这一阶段的主要代价，尽量在 T9（导入向导）与 Phase 2（打开所在文件夹）里补一点手感 |

---

## 相关文档

- 父级：[README.md](./README.md)
- 同级：[`00-decisions.md`](./00-decisions.md)、[`baseline.md`](./baseline.md)、[`02-phase2-reactivity-validation.md`](./02-phase2-reactivity-validation.md)
- 相关：[../../PLAN.md](../../PLAN.md) 第 4、7、8 节
