# 书文件夹改成 `book.pdf + .lbook/`，并把"上传新建/维护"请回来

**目标**：书文件夹里除了 PDF 只剩一个 `.lbook/` 目录（元数据收进去，不暴露在外）；同时新增与维护书籍恢复成"上传文件"，由应用负责校验 JSON、决定文件夹名，并让用户选存放位置。**不做向后兼容**（beta）。

**依据**：A16 / A17（见 `00-decisions.md`），用户 2026-10-11 拍板。

---

## T1 布局：`book.pdf` + `.lbook/` ✅ 已完成

- [x] 名字集中在 `src/shared/bookFile.ts`：`LBOOK_DIR`、`BOOK_FILES`、`COVER_NAMES`，`BOOK_FORMAT_VERSION` 1 → 2。
- [x] `src/main/library/book.ts`：`openBook()` 的全部路径由这一处约定推出（加了 `dataDir` 与 `dataDirOf()`）；`readTocText()`、`coverPath()` 跟着走。
- [x] `library.ts`：`adopt()` 改成"把文件夹带进这一套布局"——创建 `.lbook/`、**移动**散落的 json 与封面、按需写 `meta.json`（能读到旧 `meta.json` 时沿用它的 uid/标题）；`resolveFile()`、`describe()` 跟着走。
- [x] `inspect.ts` / `validateBook.ts`：从 `.lbook/` 读；新增 `looseMeta` 一条，**旧布局会被指名道姓说出来**（"meta.json 躺在 book.pdf 旁边"）。
- [x] `lbookProtocol.ts`：封面与内容图片都在 `.lbook/` 里解析。
- [x] **watcher 修了一个真 bug**：`fs.watch` 不递归，元数据又搬进子目录了，所以现在每本书挂**两层**（书文件夹 + `.lbook/`），指纹也指向新路径。
- [x] 真实 5 本已搬进新布局（临时脚本：逐文件哈希校验、PDF 原地不动、uid/页数/进度不变）。
- [x] 探针与 `check:inspect` 跟着更新；`npm run probe:perf` 7 项判定全绿。

## T2 新建一本书（上传 + 存放位置）✅ 已完成

- [x] `library:createBook`（`src/main/library/create.ts`）：收 `{ pdfPath, ocrPath, coverPath?, tocPath?, title?, destination }` → 校验（PDF 文件头、OCR 流式扫出 `foundArray` 与页数、目录过 `parseToc`、封面扩展名）→ 按标题 slug 定名并**大小写不敏感地**查重（Windows 上 `Laws` 与 `laws` 是同一个文件夹）→ 建在 `.creating-<uid8>` 暂存目录 → `copyFile` 拷 PDF 与 `ocr.json`（逐字节）→ 写 `meta.json` → **改名就位** → 登记台账。失败删暂存目录，**不留半个书**。
- [x] `previewBook()`（经 `library:previewBook`）：只校验、不写盘，返回书名、**将要创建的文件夹名**、页数、OCR 大小与提醒。对话框拿它显示"将创建…"，所以命名与校验都是应用的事（A17）。
- [x] 文件与目录选择器回到主进程：`dialog:pickFiles`（按 `FileKind` 过滤：pdf / ocr / toc / cover）与 `dialog:pickFolder`（默认落在"默认新建位置"）。
- [x] 渲染层：`AddBookDialog`（两个标签页：**从文件新建** / **已有的书文件夹**）、书名输入（留空则取自 PDF 文件名）、**存放位置控件**（输入框 + 浏览按钮，默认值取设置里的"默认新建位置"）、以及“将创建…”预览与拒绝原因。文件名变化后 250ms 去抖重算预览。
- [x] 两本词典各加 27 条（`addBook.*` / `editBook.*`）；`npm run check:i18n` 通过（47 个文件）。

## T3 维护一本书 ✅ 已完成

- [x] `replaceBookFile(library, uid, role, value)`（role: `ocr` / `cover` / `toc` / `pdf` / `title`）：每个 role 用与新建时**同一套**校验；拷贝落在目标同目录的 `.incoming` 再改名覆盖（跨盘也能原子替换，且失败时旧文件不动）。换 OCR 时页数跟着更新，换封面时删掉旧的其他 `cover.*`（否则查找顺序会让替换看起来没生效），换标题**不改磁盘上的文件夹名**。替换后 `library.refresh()` 让缓存失效，主进程再广播一次 `book:changed`，所以打开着的那本书也会立刻重读。
- [x] `EditBookDialog`：标题输入 + 保存、四行替换（各配"在文件管理器中显示"）、成功/失败就地反馈；页目行提示换 PDF 后要注意页数是否仍与 OCR 对得上。
- [x] 单测 `tests/unit/library/create.test.ts`（20 条）：预览不写盘、名字 slug 与重名 `-2`、四种坏输入各自被拒、创建后的布局与逐字节 OCR、目标目录按需创建、**复制失败不留半个文件夹**、替换 OCR 后页数跟着变且立刻可读、坏替换被拒**且旧文件字节不变**、换封面删旧封面、换目录/PDF/标题、空标题与非 PDF 被拒、不在书库里的书被拒。

## 验收（T1–T3 已实现，手工核对项）（T1–T3 已实现，手工核对项）

- [x] 5 本真书在新布局下能列、能翻页、目录/封面正常；进度仍在原处（探针 7/7、`check:inspect` 与启动实测都过）。
- [ ] 新建一本（要有真 PDF 与 OCR JSON 文件才点得动）：名字与页数在确认前就该显示；建好后能打开、能翻页——**留给手工验收**。
- [x] 重名 → `-2`；坏 JSON / 非 PaddleOCR / 缺文件 → 明确拒绝且**不留下半成品文件夹**（都有单测）。
- [ ] 维护一本：换封面/目录立即可见、换 OCR 后页数随之更新、换 PDF 后的页数提醒——**留给手工验收**（逻辑已有单测）。
- [ ] `npm run typecheck && npm run lint && npm run check:docs && npm run check:i18n && npm test && npm run probe:perf` 全绿。

---

## 相关文档

- 父级：[README.md](./README.md)
- 相关：[\`00-decisions.md\`](./00-decisions.md)（A16/A17）、[\`01-phase1-folder-read.md\`](./01-phase1-folder-read.md)、[\`../../DESIGN.md\`](../../DESIGN.md) 第 5 节
