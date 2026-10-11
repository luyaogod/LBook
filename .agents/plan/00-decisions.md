# 决策台账

动工前先看这里。**已定**的是结论，别再翻案；**待办**的是施工中冒出来、还没结论的。

---

## A. 已定

### A1–A9（Phase 0 性能验证那轮定的，未变）

| # | 决定 | 依据 |
|---|---|---|
| A1 | **一本书 = 一个文件夹**；文件夹名只用于显示，身份靠 `meta.json.uid` | `PLAN.md` 第 4.1 节 |
| A2 | **单个大 OCR JSON + 字节偏移索引**，不拆页、不做自有格式 | `baseline.md`：自检 665/665、294/294 全等；按页 0.04–0.13ms |
| A3 | **扫描器必须流式分块**，内存里不出现整个文件 | 第一版读整个文件进 Buffer，内存数字当场失真（+46MB vs +4MB） |
| A4 | **索引缓存先不做** | 冷扫 15.6MB 只要 36ms |
| A5 | **应用对书的内容只读**（读路径上）；没有 `dirty`、没有 Ctrl+S、没有未保存提示 → 2026-10-11 由 **A17** 收窄为"读的时候只读"：新建/维护/加成书时会写 | `PLAN.md` 第 3 节、A17 |
| A6 | **IPC 形状尽量不变**：`book:*` 返回的渲染层数据结构保持现状，只换实现 | 让 Phase 1 的改动集中在主进程 |
| A7 | **`ocr.json` 逐字节原样**：不重排、不 pretty-print、不改键序 | 用户改过、别的工具格式化过，都不该由我们改写 |
| A8 | **页号 = `layoutParsingResults` 的数组下标** | PaddleOCR 元素里没有页号字段 |
| A9 | **PDF 走真实文件的区间读**，删掉 zip 区间读 | 实测快 1.7–10.6×，且少一层 yauzl 句柄缓存 |

### A10–A13（2026-10-11 问卷拍板）

| # | 决定 | 说明 |
|---|---|---|
| **A10** | **Markdown 与块各读自己那段，互不派生** | `markdown.text` 与 `parsing_res_list` 在**同一份 OCR JSON** 里，但两个视图各自读各自那段：Markdown 视图（与复制按钮）读 `markdown.text`，Blocks 视图读 `parsing_res_list`。**不做 `markdownFromBlocks`**。于是 `DESIGN.md` §5.5/§12 里"改块不反映到 Markdown 视图"从"限制"变成**有意为之**——想一致就自己在文件里把两边都改（这与"应用不提供编辑、用户自己改文件"是一套的） |
| **A11** | **书库是一份"路径台账"，删除只删条目** | 模仿 Obsidian 的 vault 列表：应用只记"哪些文件夹是书"，存 `%APPDATA%\LBook\library.json`。"删除"= **从台账里移除，永不动磁盘**；因此不需要 `_trash/`，也不需要"系统回收站"。书可以在任何盘、任何目录 |
| **A12** | **彻底放弃旧 `\.lbook` 包与"库目录扫描/导入"这一整套**（"新增书籍"那一半由 A17 取代：上传新建回来了） | `.lbook` 只在迁移时读一次；`library:scan` / `library:import` / `library:createFromFiles` / `library:delete` 与 `importer.ts` / `legacy.ts` / `lbook/{reader,zipIndex,archiveCache,packer,reconstruct,validate,manifest}.ts` 全删（`ocr.ts` 留）。（"新增书籍"那一半由 **A17** 取代：上传新建回来了，见 06）|
| **A13** | **迁移由我执行，先备份** | 先备份你本机那 5 本（原 `.lbook` 至少留一份），再跑迁移创建书本目录，逐本校验：PDF sha256、`ocr.json` 逐字节、页数、进度。默认建在 `文档\LBook Library\<书名>/` 并注册进台账 |

### A14–A15（Phase 1 施工中拍板）

| # | 决定 | 说明 |
|---|---|---|
| **A14** | **IPC 里书用 `uid` 称呼，不再有数字行号** | A6 说“形状尽量不变”，但身份必须变：行号是 SQLite 的 `rowid`，它随数据库一起消失；而 `uid` 本来就已经是身份（封面 URL 一直是 `lbook://cover/<uid>`）。于是 `pdfId: number` → `uid: string`，`PdfDocument` 去掉 `id`/`status`/`dirty`、保留 `uid`，并加了 `dir`（“在文件管理器中显示”要用）与 `problem`（坏书） |
| **A15** | **顺手删掉两个没人用的 IPC 形状**：`book:listPages` 与 `PdfDocumentDetail.pages` | 渲染层从来不读它们（总页数取自 `meta.pageCount`，页尺寸取自单页的 `usePdfPage`）。留着的话，`library:get` 得把**整份 OCR JSON 逐页解析**才能凑出那个数组——打开一本 665 页的书会因此多花一秒多。删掉之后，打开一本书只读一个 `meta.json` |

### A16–A17（2026-10-11 第二轮拍板）

| # | 决定 | 说明 |
|---|---|---|
| **A16** | **书文件夹 = `book.pdf` + 一个 `.lbook/` 目录**，元数据全在里面 | `meta.json` / `ocr.json` / `toc.json` / 封面 / 以后的 `imgs/` 都收进 `<书>/.lbook/`，**不再散在书文件夹根部**。命名与 Obsidian 的 `.obsidian` 同一套约定：点前缀、**不设 Windows 隐藏属性**（实测本机 3 个 vault 的 `.obsidian` 属性都只是 `Directory`；Obsidian 官方帮助也只让用户自己去 View → Show → Hidden items，其论坛 #81454 正是一条"给 Windows 加上隐藏属性"的 feature request 而未被采纳）。**不做任何向后兼容**：beta 期，"打开一个文件夹"会把散落的元数据**移动**进 `.lbook/`（保住原来 `meta.json` 里的 uid/标题），除此之外旧布局不被读取，校验器会直说"meta.json 躺在 book.pdf 旁边" |
| **A17** | **"上传新建 + 维护"回来，并带一个存放位置控件** | 撤销 A12 里"新增书籍只有打开文件夹"这一半：`新增` = 选 PDF + OCR JSON（+ 可选封面、目录）+ 选**存放位置**，由应用校验 JSON、决定文件夹名（标题 slug + 重名加 `-2`）并写盘；`维护` = 替换 `ocr.json` / 封面 / `toc.json` / `book.pdf`，或改标题。理由（用户原话）：**不能让用户自己去校验 JSON 以及管理命名**。A12 的另一半（应用不认识 `.lbook` 包）不变 |

**A5 收窄为"读的时候只读"**：翻页、设置、翻译都不写盘；写盘只发生在上面三种"用户明确要求"的动作里，而且不修改用户写的字节，只整文件替换或创建缺失的元数据。

### 按建议默认执行（低风险，随时可改）

| # | 默认 | 理由 |
|---|---|---|
| **B2** | 阅读进度放 `%APPDATA%\LBook\progress.json`（按 `uid`） | 它是"这台机器读到哪"，不是书的内容；放书里会让只读挂载/网络盘/git 都不舒服 |
| **B5** | 我们生成的 JSON 一律两空格缩进 + 键序固定 | 代价为零（`config.json` 已经这么写），收益是书文件夹可以 `git init` |
| **B7** | "默认新建位置" = `文档\LBook Library`，可在设置里改 | 取代原来的"库目录"设置项；台账里的路径在它之下时**存相对路径**（根目录整体搬家不断链），在它之外时存绝对路径 |

---

## B. 待办（施工中冒出来、还没结论）

| # | 问题 | 现状 |
|---|---|---|
| B8 | 台账里的路径失效了（用户把文件夹移走/改名）怎么办？ | 列表里标“找不到” + 提供“移除条目”，并给“在文件管理器中显示”。**已实现**（`problem` 字段 + 行上的徽标）；“重新定位”（手选新路径）放 Phase 2 |
| B9 | 页元素里的 `outputImages` / `inputImage` 是过期的百度 BOS 签名 URL | 原样留着不读；将来"图片本地化"要重新下载，与本重构无关 |
| B10 | 用户在编辑器里格式化过 JSON（缩进/换行变了） | 扫描器不假设缩进；**本轮还没做按 `mtime` 失效重扫**：索引在内存里缓存，重启应用才能看到外部改动。Phase 2 的事（`02-phase2-reactivity-validation.md`） |

---

## 相关文档

- 父级：[README.md](./README.md)
- 同级：[`baseline.md`](./baseline.md)、[`01-phase1-folder-read.md`](./01-phase1-folder-read.md)
- 相关：[../../PLAN.md](../../PLAN.md)（产品视角；**冲突时以本目录为准**）
