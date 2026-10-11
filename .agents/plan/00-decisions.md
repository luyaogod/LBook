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

### A18–A20（2026-10-11 第三轮拍板：内容修正）

| # | 决定 | 说明 |
|---|---|---|
| **A18** | **改块不会同步改 Markdown，反之亦然**；界面必须写明编辑对象 | A10 的自然结论：两份读法是同一页的两种独立读法。同步要复刻 PaddleOCR 的拼接规则，已经否过。代价是两边可能不一致——所以编辑器标题写“块 3 的内容”/“这一页的 Markdown” |
| **A19** | ~~Markdown 编辑直接用 Monaco~~ → **实测后改为也用 textarea**（2026-10-11 晚） | 原判据是"长文本，行号/查找/高亮值得那 ~2MB 与 worker"。真做一遍才知道代价不止一块 bundle，见下面的 **A19 修订** |

**A19 修订（2026-10-11，实测后推翻）**：Monaco 确实能在 `app://` 与生产 CSP 下跑，懒加载也成立——入口 chunk 1353KB **一点没涨**，Monaco 2640KB、worker 296KB、markdown 定义 3KB 各自是独立的懒块。但代价是三样，而它要换来的只是 3–13KB 的页级 Markdown：

1. **一块 2.6MB 的懒 chunk**（进安装包），外加一条 worker 路径要维护；
2. **rolldown 会把"app 与 Monaco 都用到的模块"提进入口 chunk**——这里是它自己的 `__exportAll` 辅助函数。于是 Monaco chunk 反过来 `import` 入口 chunk，vite 会在执行 Monaco 之前**预载并执行整个 app**。在应用里无害（入口早跑过了），但任何想单独验证 Monaco 的页面都会被它拖起整个界面；要验就必须给探针**单独一份 vite 构建**；
3. 于是"先验一下再接线"这件事本身膨胀成了：共享 `app://` 处理器与 CSP 的模块、第二个 vite 配置、一个 Electron 探针脚本——而它们每一个都要维护。

判据本身没变（原则 4：**编辑的就是源码**），而 textarea 同样满足它，并且与块编辑是**同一套交互**（Ctrl+Enter 保存 / Esc 取消 / 失焦不保存 / 保存后就地撤销一次）。所以 T4 用 textarea 收掉；**Monaco 留作已验证的加分项**，哪天真觉得不够（长文、查找、行号）再接——上面三条代价已经摸清，届时只差一个组件。

这是**唯一**一条先拍板、后被实测推翻的决定，记在这里而不是悄悄改掉：原来的判断没错，错在把"2MB 与 worker"当成了全部代价。
| **A20** | **每次保存立即写盘**，不留未保存状态 | 实测一次编辑 7.5–8.5ms（`npm run probe:edit`），也不引入脏标记/Ctrl+S/离开提醒那一套。写失败就报错，原文件不动 |

编辑的三条原则（用户 2026-10-11 定，写进 `04-phase4-content-edit.md`）：**坐标不改**（OCR 的产物，只写 `block_content` 与 `markdown.text` 两个字符串字段）、**只在翻页模式**（页是文件的单位）、**一次一个字段**。

### A21（2026-10-11 第四轮：书库模型就按 Obsidian 的 vault 来做）

用户的指令是**"Obsidian 怎么做，我就怎么做"**。查了官方文档（`Manage vaults`、`How Obsidian stores data`、`Configuration folder`）之后逐条对齐：

| Obsidian | 我们的对应 | 状态 |
|---|---|---|
| vault 就是一个文件夹（含子文件夹），里面的笔记是普通文件 | 一本书就是一个文件夹，里面是 PaddleOCR 原样的文件 | ✅ 已是（Phase 1） |
| 每个 vault 自带一个 `.obsidian/` 配置文件夹，放在 vault 根下 | 每本书自带 `.lbook/`，放在书文件夹根下 | ✅ 已是（`1a6f91f`） |
| vault 的**身份**是它自己带的配置，不是一个数据库 id | 书的身份是 `.lbook/meta.json` 里的 `uid` | ✅ 已是 |
| 全局配置 `%APPDATA%\obsidian\obsidian.json` 只记 `vaults: { id → { path, ts, open } }`——**现在在哪** | `library.json` 记 `{ path, uid, addedAt }` | ✅ 同构 |
| **Remove vault：只从列表里移除**，磁盘一个字节不动 | "删除" = 从台账去掉一条（A11） | ✅ 已一致 |
| **vault 文件夹被搬走**：官方修法是 "Open folder as vault" 再指到新位置（`Manage vaults` 的 *Move vault to a different folder*），列表条目跟着走 | **原来没做到**：`ledger.add()` 遇到已有 uid 直接返回 null、**不更新路径**，所以走"添加 → 已有文件夹 → 选新位置"也修不好 | ✅ **本轮补上**：`add()` 返回 `added`/`known`/`repointed`，同一 uid 换位置就**改写那一条的 path**；`library.relocate(uid, dir)` + 行上的"定位…" |
| vault 重命名 = 重命名文件夹（"the name of a vault and the underlying folder are the same"） | 书名在 `meta.json` 的 `title` 里，**和文件夹名可以不同** | ⚠️ 未对齐，见 B14 |
| 应用自己提供 "Move vault"（挪文件夹） | 没做：用户自己在资源管理器里搬，再用"定位…"告诉应用 | ⚠️ 故意不做，见下 |
| 外部改文件名 → 链接断掉（要靠插件补救） | 我们的"链接"是 `uid`，与路径无关，所以**搬动/改名不会丢进度** | ✅ 比 Obsidian 结实 |

**定位的安全性**：不能"选哪个文件夹就认哪个"。`relocate` 要求那个文件夹里的 `.lbook/meta.json` **uid 与要定位的书一致**，否则拒绝并在提示里点名"那里是另一本书（书名）"。这条 Obsidian 没有（它的列表本来就可以随便指），我们需要它是因为一个库里有多本书，选错就等于把两本书对调。

**故意不跟的两条**（不是漏掉，是判断）：

1. **不做应用内的"移动文件夹"**。Obsidian 只在系统允许时提供它，其余情况仍要用户自己搬——而搬这件事用户在自己熟悉的资源管理器里做更快，代价是搬完告诉应用一声（"定位…"）。少写一条会跨盘失败的复制/删除路径，也少一次"搬一半断电"的风险。
2. **改名仍只改 `meta.json` 的 `title`**（`EditBookDialog`），不动文件夹名。书文件夹名是**用户文件系统里的东西**，可能已被他们的备份/同步/脚本依赖；Obsidian 之所以"改名即改文件夹"，是因为它没有元数据文件可改。要不要跟，记在 B14。

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
| B10 | 用户在编辑器里格式化过 JSON（缩进/换行变了） | 扫描器不假设缩进，按 `mtime+size` 失效重扫，Phase 2 已做 |

| B11 | ~~改块时是否同步 Markdown？~~ | 已定：**不同步**（A18） |
| B12 | ~~Markdown 编辑用 textarea 还是 Monaco？~~ | 已定：**都用 textarea**；Monaco 是已验证的加分项（A19 修订） |
| B13 | ~~每次立即写盘还是攒批？~~ | 已定：**立即写盘**（A20） |

---

## 相关文档

- 父级：[README.md](./README.md)
- 同级：[`baseline.md`](./baseline.md)、[`01-phase1-folder-read.md`](./01-phase1-folder-read.md)
- 相关：[../../PLAN.md](../../PLAN.md)（产品视角；**冲突时以本目录为准**）
