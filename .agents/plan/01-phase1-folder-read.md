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

### T1 偏移扫描器进仓 + 单测

- [ ] 把 `scripts/perf-probe.ts` 里的 `scanOffsets` / `scanBytes` / `findArrayStart` 搬到 `src/main/lbook/offsetIndex.ts`，连同 `readPageSlice(fd, start, end)`。
- [ ] 单测 `tests/unit/lbook/offsetIndex.test.ts`：
  - [ ] **跨块**：构造 > `CHUNK`（1MB）的 JSON，元素边界落在块内/块首/块尾/跨两块——最易错的地方。
  - [ ] 字符串里出现 `{ } [ ] " \` 与转义引号：不能被当结构。
  - [ ] 多字节 UTF-8（中文、emoji）在字符串里：纯字节状态机不受影响。
  - [ ] `limit` 早退：取 30 页时不会扫完整个文件。
  - [ ] 缺 `layoutParsingResults`、空数组、文件被截断 → 返回已有结果而不抛异常。
  - [ ] 真实 fixture（`dev-data/Oxford Picture Dictionary 3 ed.ocr.json`）：全部页与 `JSON.parse` 逐页深度相等（探针验过，固化成单测）。
- [ ] 注释写清"为什么流式、为什么不需要跨块残留"（`PLAN.md` 4.2）。

### T2 `meta.json` 契约（`src/shared/bookFile.ts`）

- [ ] `BookMeta`：`formatVersion` / `uid` / `title` / `author?` / `pageCount` / `ocrFile` / `createdAt?` / `source?`。
- [ ] `parseBookMeta(raw): { meta } | { error }`——纯函数、零依赖、**校验而不抛**（坏书也要能列出来）。
- [ ] `writeBookMeta(meta): string`——两空格缩进、键序固定（B5），只此一处负责格式。
- [ ] 单测：缺 `uid`、`pageCount` 非数字、`ocrFile` 空、未知键保留不报错。

### T3 书库台账（`src/main/library/ledger.ts` + `src/shared/ledger.ts`）

- [ ] `library.json`（`%APPDATA%\LBook\`）：`{ version, books: [{ path, uid, addedAt }] }`；`path` 在默认新建位置之下时**存相对路径**（B7）。
- [ ] `list()` / `add(folder)` / `remove(path)`——`remove` **只动台账**（A11），磁盘一律不碰。
- [ ] 解析/写出的纯函数放 `src/shared/ledger.ts`：坏台账（手改坏了）→ 能列出能读到的条目，并给一条 issue，**不能崩**。
- [ ] 原子写（temp + rename，照抄 `src/main/config/config.ts` 的 `writeConfig`）。
- [ ] 单测：相对/绝对路径的换算、去重（同一个 `uid` 或同一路径加两次）、坏条目、`remove` 不碰磁盘（用临时目录断言文件还在）。

### T4 读一本书（`src/main/library/book.ts`）

- [ ] `openBook(dir)`：读 `meta.json` → 定位 `ocr.json` → 懒扫偏移（第一次用到才扫）→ 返回句柄。
- [ ] `readPage(dir, pageNum)`：形状与现在 `book:getPage` **完全一致**（A6）。
- [ ] `readToc` / `readCover` / `pdfPath` / `pdfSize`。
- [ ] 一律 `fs.promises` + 用完即关的 `fd`（Windows 上句柄没放会挡住用户改名/移动——现状踩过的坑）。
- [ ] 单测：临时目录造 2~3 本假书，覆盖"meta 坏""ocr.json 缺""页号越界""空文件"。

### T5 PDF 区间读改真实文件

- [ ] `book:readPdfRange` 改成 `fs.read` 普通文件；**保持 `end` 排他**的语义（这条契约写在 `usePdfDocumentProxy.ts` 的注释里）。
- [ ] 删掉 `zipIndex.ts` / `archiveCache.ts` 的引用；`closeBook` 那类"未 await 就 EPERM"的坑随之消失。

### T6 页 → 渲染层形状

- [ ] `parsing_res_list` → `OcrBlock[]`：`bbox` 现在是数组，不必再 `JSON.parse` 字符串；`is_html_content` 现算。
- [ ] `markdownText` = `markdown.text`（A10：就是它本身，不派生）。
- [ ] `page_width` / `page_height` 从 `prunedResult.width/height` 取，缺失时按 bbox 推（逻辑照搬 `ocr.ts`）。

### T7 进度改 JSON

- [ ] `src/main/progress.ts`：`%APPDATA%\LBook\progress.json`，`{ "<uid>": { lastPageNum, updatedAt } }`；原子写，失败不抛。
- [ ] `progress:get` / `progress:save` 的 IPC 不变。
- [ ] 迁移时把 `reading_progress` 表里的进度搬过去（**必须在 DB 还在时做**，所以属于本阶段）。

### T8 迁移器（`src/main/migrate/lbookToFolder.ts` + `scripts/migrate-folders.ts`）

> `src/main/migrate/` 是**新目录**：按 `AGENTS.md` §1.1 必须同时加 `README.md`（五个固定小节）。

- [ ] 输入：库目录里发现的 `.lbook`（一次性清单）；输出：书文件夹 + 台账条目 + 进度条目。
- [ ] 逐本：建文件夹（`slugify(title)`，重名加 `-2`）→ 解包 `book.pdf`（**边写边算 sha256 与包内比**，用流式拷贝，不要整块进内存）→ `ocr.json` **逐字节写出** → `toc.json`/封面原样拷 → `writeBookMeta`（`uid` 沿用包内 manifest）→ `ledger.add`。
- [ ] **幂等**：目标文件夹已存在且 `meta.json.uid` 相同 → 跳过（但仍确保它在台账里）。
- [ ] **失败隔离**：一本失败只报那一本，继续；原包**不移动、不删除**。
- [ ] `npm run migrate:folders [-- --dry-run] [--book <片段>] [--root <目录>]`。
- [ ] 黄金测试 `tests/unit/migrate/lbookToFolder.test.ts`：用 `tests/helpers/lbook.ts` 造的小包跑一遍，断言 PDF 字节相同、`ocr.json` 字节相同、页数相同、进度相同、台账多一条、**再跑一次什么都不做**。

### T9 打开一个书文件夹（替代导入向导，A12）

- [ ] `library:open`（新通道）：`dialog.showOpenDialog({ properties: ["openDirectory"] })` → 校验该目录（`meta.json` 在不在、`ocr.json` 能不能定位、`book.pdf` 在不在）→ 合法则 `ledger.add` 并返回摘要；不合法返回**具体的缺什么**。
- [ ] 目录里**没有** `meta.json` 时不自动猜：如果同一个目录里有 `book.pdf` + 恰好一个 `*.json`，可以提供"用这些建 meta.json"（写它**是创建**，不是编辑），但要让用户看清将写入什么。
- [ ] `dialog:pickFiles` 的 `FileKind` 加 `folder`（或在渲染层直接调 `library:open`）。
- [ ] 首页空态与"添加书籍"按钮改成这个流程；文案写明"书可以放在任何位置，应用只记住路径"。

### T10 下掉渲染层编辑入口

- [ ] 删 `EditDialog.tsx` / `UploadDialog.tsx` 及其引用。
- [ ] `BlockCard.tsx`：删编辑按钮与 `onEdited` 链路（整张卡片变成纯展示）。
- [ ] `App.tsx` / `AppHeader.tsx`：删 `dirty` / `docDirty` / Ctrl+S / `savePdf` / 未保存圆点。
- [ ] `HomePage`：删 `Unsaved` 徽标；卡片上的操作改成"打开"+"在资源管理器中显示"+"从书库移除"（最后一项只删台账条目，文案要写明"不会删除文件"）。
- [ ] `src/renderer/api/pdfs.ts` 的写函数删掉。
- [ ] 设置页：`libraryDir` 那一段改成"默认新建位置"（B7）；"在资源管理器中打开"保留。

### T11 删主进程写路径与 IPC

- [ ] 删通道：`book:updateBlock`、`book:save`、`book:replaceOcr`、`book:replaceCover`、`book:replaceToc`、`book:clearToc`、`library:scan`、`library:import`、`library:createFromFiles`、`library:delete`、`settings:chooseLibraryDir`、`settings:revealLibraryDir`。
- [ ] 保留：`library:list`（改读台账）、`library:get`、`library:open`（新）、`book:listPages/getPage/readPdfRange/getToc`、`progress:*`、`settings:get/set`、`dialog:*`、`updates:*`、`window:*`、`translate:*`、`app:hello`。
- [ ] 删 `packer.ts` / `reconstruct.ts` / `validate.ts` / `manifest.ts` / `importer.ts` / `legacy.ts` 与 `service.ts`。
- [ ] grep 自检：`grep -rn "book:save\|updateBlock\|replaceOcr\|library:scan\|repack" src/` 为空。
- [ ] **删除相关的文案一律写清"只从书库移除，文件不动"**——这是 A11 的对外承诺。

### T12 测试与文档同步

- [ ] 删：`tests/unit/lbook/{reader,validate,zipIndex,manifest}.test.ts`、`tests/unit/library/service.test.ts`（`tests/unit/db/**` 留到 Phase 3）。
- [ ] 加：`offsetIndex`、`bookFile`、`ledger`、`book`、`migrate` 五个测试文件；相应目录的 `README.md` 同步。
- [ ] `TEST.md`：第 3 节职责表、第 4 节黄金用例（改成"迁移保真"）、第 6 节手工清单（"编辑与保存"整节换成"书文件夹"）。
- [ ] `DESIGN.md`：§5 数据层、§6 `.lbook` 格式规范（改成"文件夹布局 + `.lbook` 只作迁移输入"）、§5.5 的那条限制改成"有意为之"（A10）。
- [ ] 目录 README：`src/main/lbook/`、`src/main/library/` 重写；`src/main/migrate/README.md` 新增；`src/renderer/components/home/` 更新。
- [ ] `.agents/plan/README.md` 状态表改成 ✅。

---

## 验收

**必须全绿：**

```bash
npm run typecheck && npm run lint && npm run check:docs && npm test
npm run probe:perf
```

**迁移（A13：先备份，可重复执行）：**

- [ ] 备份：库目录（或至少 5 个 `.lbook`）复制到库目录之外，记下大小与数量。
- [ ] `npm run migrate:folders -- --dry-run` 看计划 → 真跑 → **再跑一次应什么都不做**。
- [ ] 逐本核对：PDF sha256 与包内一致；`ocr.json` 与包内**逐字节相同**；页数一致；进度一致。
- [ ] 原 `.lbook` 仍在原处，**没被动过**。
- [ ] `library.json` 里 5 条路径都对；把其中一条的文件夹改名 → 列表显示"找不到"，点"从书库移除"后条目消失、**磁盘上的文件夹仍在**。

**手工过一遍（`TEST.md` 第 6 节"基本链路"）：**

- [ ] 打开一本大书：能列、能翻页、能缩放、Fit Width、Flow 连滚 6 屏不卡、没有白页。
- [ ] 目录跳转、当前页跟随、划词翻译、主题切换、阅读字号滑块都还在。
- [ ] 编辑入口全部消失（界面 + `grep -rn "book:save\|updateBlock" src/` 为空）。
- [ ] 外部改文件：把 `ocr.json` 里某页的一个字改掉（页数不变），**重启应用**后该页能看到（自动重读是 Phase 2）。
- [ ] 把某本 `meta.json` 删掉 → 列表里那本显示"需要修复"，应用不崩，其他书照常。

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
