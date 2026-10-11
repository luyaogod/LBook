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

## T2 新建一本书（上传 + 存放位置）⬜ 待做

- [ ] `library:create`：收 `{ pdfPath, ocrPath, coverPath?, tocPath?, title?, destination }`；校验（PDF 是不是 PDF、OCR 是不是 PaddleOCR 输出、目录能不能解析）、按标题 slug 定名并去重、建 `<destination>/<名字>/` → 拷 PDF → 写 `.lbook/` 里的元数据 → 登记台账。
- [ ] `library:checkFiles`（给对话框做预览）：返回将要使用的名字、页数、以及发现的问题，**让用户点确认之前就看到会发生什么**。
- [ ] 文件与目录选择器（主进程弹，路径只从对话框流向渲染层）：`dialog:pickFiles` / `dialog:pickFolder`。
- [ ] 渲染层：`AddBookDialog`（两个入口：**从文件新建** / **打开一个已有的书文件夹**）、存放位置控件（默认取设置里的"默认新建位置"）。
- [ ] 词典两条 + `npm run check:i18n` 通过。

## T3 维护一本书 ⬜ 待做

- [ ] `book:replaceFile`（role: ocr / cover / toc / pdf）与 `book:setTitle`；替换后让缓存失效。
- [ ] `EditBookDialog`：四个替换入口 + 标题输入 + "在文件管理器中显示"；换 PDF 时提示页数可能与 OCR 对不上。
- [ ] 单测：替换后读到的就是新内容、校验器跟着重算、坏文件被拒且原文件不动。

## 验收

- [ ] 5 本真书在新布局下能列、能翻页、目录/封面正常；进度仍在原处。
- [ ] 新建一本：选 PDF + OCR JSON + 存放位置 → 名字与页数在确认前就显示出来；建好后能打开、能翻页。
- [ ] 重名 → `-2`；坏 JSON / 非 PaddleOCR / 缺文件 → 明确拒绝且**不留下半成品文件夹**。
- [ ] 维护一本：换封面/目录立即可见；换 OCR 后页数随之更新；换 PDF 后提示页数问题。
- [ ] `npm run typecheck && npm run lint && npm run check:docs && npm run check:i18n && npm test && npm run probe:perf` 全绿。

---

## 相关文档

- 父级：[README.md](./README.md)
- 相关：[\`00-decisions.md\`](./00-decisions.md)（A16/A17）、[\`01-phase1-folder-read.md\`](./01-phase1-folder-read.md)、[\`../../DESIGN.md\`](../../DESIGN.md) 第 5 节
