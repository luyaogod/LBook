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
| A5 | **应用对书的内容只读**；没有 `dirty`、没有 Ctrl+S、没有未保存提示 | `PLAN.md` 第 3 节 |
| A6 | **IPC 形状尽量不变**：`book:*` 返回的渲染层数据结构保持现状，只换实现 | 让 Phase 1 的改动集中在主进程 |
| A7 | **`ocr.json` 逐字节原样**：不重排、不 pretty-print、不改键序 | 用户改过、别的工具格式化过，都不该由我们改写 |
| A8 | **页号 = `layoutParsingResults` 的数组下标** | PaddleOCR 元素里没有页号字段 |
| A9 | **PDF 走真实文件的区间读**，删掉 zip 区间读 | 实测快 1.7–10.6×，且少一层 yauzl 句柄缓存 |

### A10–A13（2026-10-11 问卷拍板）

| # | 决定 | 说明 |
|---|---|---|
| **A10** | **Markdown 与块各读自己那段，互不派生** | `markdown.text` 与 `parsing_res_list` 在**同一份 OCR JSON** 里，但两个视图各自读各自那段：Markdown 视图（与复制按钮）读 `markdown.text`，Blocks 视图读 `parsing_res_list`。**不做 `markdownFromBlocks`**。于是 `DESIGN.md` §5.5/§12 里"改块不反映到 Markdown 视图"从"限制"变成**有意为之**——想一致就自己在文件里把两边都改（这与"应用不提供编辑、用户自己改文件"是一套的） |
| **A11** | **书库是一份"路径台账"，删除只删条目** | 模仿 Obsidian 的 vault 列表：应用只记"哪些文件夹是书"，存 `%APPDATA%\LBook\library.json`。"删除"= **从台账里移除，永不动磁盘**；因此不需要 `_trash/`，也不需要"系统回收站"。书可以在任何盘、任何目录 |
| **A12** | **彻底放弃 `.lbook` 与"库目录扫描/导入"这一整套** | `.lbook` 只在迁移时读一次；`library:scan` / `library:import` / `library:createFromFiles` / `library:delete` 与 `importer.ts` / `legacy.ts` / `lbook/{reader,zipIndex,archiveCache,packer,reconstruct,validate,manifest}.ts` 全删（`ocr.ts` 留）。新增书籍 = **"打开一个书文件夹"**（选目录），即 Obsidian 的 Open folder as vault |
| **A13** | **迁移由我执行，先备份** | 先备份你本机那 5 本（原 `.lbook` 至少留一份），再跑迁移创建书本目录，逐本校验：PDF sha256、`ocr.json` 逐字节、页数、进度。默认建在 `文档\LBook Library\<书名>/` 并注册进台账 |

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
| B8 | 台账里的路径失效了（用户把文件夹移走/改名）怎么办？ | 列表里标"找不到" + 提供"移除条目"；"重新定位"（手选新路径）放 Phase 2 |
| B9 | 页元素里的 `outputImages` / `inputImage` 是过期的百度 BOS 签名 URL | 原样留着不读；将来"图片本地化"要重新下载，与本重构无关 |
| B10 | 用户在编辑器里格式化过 JSON（缩进/换行变了） | 扫描器不假设缩进，只按 `mtime` 失效重扫——`PLAN.md` 第 4.2 节 |

---

## 相关文档

- 父级：[README.md](./README.md)
- 同级：[`baseline.md`](./baseline.md)、[`01-phase1-folder-read.md`](./01-phase1-folder-read.md)
- 相关：[../../PLAN.md](../../PLAN.md)（产品视角；**冲突时以本目录为准**）
