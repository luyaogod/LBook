# PLAN.md —— 从单文件 `.lbook` 到 Obsidian 式文件夹书库

> **状态：计划，未实施。** 本文只写目标、取舍与阶段；当前实现仍在 `DESIGN.md` 里。
>
> **2026-10-11：第 11 节的待定项已全部拍板**（A10–A13），其中四条改了这里的写法：Markdown 与块**各读自己那段**（不做 `markdownFromBlocks`）；书库改成**路径台账**（删除只删条目，磁盘一律不碰）；`.lbook` 与"库目录扫描/导入"**整套放弃**；迁移由我执行（先备份）。

> **2026-10-11 进度：读路径这一半已经落地**（`.agents/plan/01-phase1-folder-read.md` 的 T1–T7、T9–T12）。现在应用就是本计划要的样子：一本书 = 一个文件夹、书库 = 一份路径台账、对书的内容只读（没有 `dirty`/Ctrl+S/编辑按钮）、`src/main/db/` 与 `.lbook` 的读写代码全部删除、打包不再需要原生模块。
>
> **2026-10-11 迁移已完成**：T8 迁移器写好并在真实的 5 本上跑过——先备份（`D:\LBook-backup-2026-10-11`，附 sha256 清单），dry run → `--apply`，再用独立脚本逐本复核 61 项（PDF sha256、`ocr.json` 逐字节、页数、进度、原包哈希不变）全部通过，重跑一次 5 本全部跳过。**Phase 1 到此结束，下一步是 Phase 2**（外部改动的反应式重读 + 坏书 UI）。
>
> 施工级的任务清单与决策台账在 [`.agents/plan/`](./.agents/plan/README.md)——**两者冲突时以那里为准**，改完代码记得回头把本文改一致。

---

## 1. 一句话

把"一本书 = 一个 `.lbook` 压缩包 + 一条 SQLite 记录"改成"**一本书 = 一个文件夹**"，而且文件夹里的东西**尽量就是 PaddleOCR 原样给出的**：`book.pdf` + 一份 OCR JSON + 一份 `meta.json`（再加可选的 `toc.json` / 封面）。渐进式阅读与性能靠**解析手段**（字节偏移索引 + 按页切片）实现，而不是靠把我们自己的格式塞进磁盘。应用只**读**，SQLite 退化为可丢弃的缓存并最终删掉。

---

## 2. 现状的代价（为什么值得动）

| 现状 | 代价 |
|---|---|
| 书的内容在 `.lbook` 压缩包里 | 改一个字必须过 UI；批量改只能自己解包写脚本 |
| 保存 = 全量重写整个包 | 190MB 的书 1–3 秒；Windows 上任何未 `await` 的 `close()` 都会 `EPERM`（`DESIGN.md` §12） |
| PDF 走 `book:readPdfRange` 区间读 zip 条目 | 需要 yauzl 句柄缓存、`dataStart` 局部文件头推算、STORE 强制、`requestDataRange` 的排他 `end`（§4.2 / §6.1 / §6.3） |
| OCR 数据被拆进两张表（`ocr_pages` / `ocr_blocks`） | 一页的文字存三遍；而且**丢掉了一部分原始输出**（`outputImages` / `inputImage` 没入库，`DESIGN.md` §12 已记为不可恢复） |
| `better-sqlite3` 是唯一原生依赖 | 打包最脆的一环：`asarUnpack` + `npmRebuild` + esbuild `external`，`BUILD.md` 第 5 节整节在讲它 |
| 编辑链路 | `dirty` 列、Ctrl+S、未保存圆点、EditDialog、UploadDialog、写回重打包 |
| 两个视图读两份文本 | 改动块不在 markdown 里体现（上一轮已实测 `markdown_text` 与"块的拼接"的关系） |

---

## 3. 目标与边界

**目标**

- 一本书 = 一个文件夹，**内容尽量是 OCR 工具的原样产物**，我们附加的只有 `meta.json`（+ 可选目录/封面）。
- 应用对**书的内容只读**；写入只允许三类：库配置（`config.json`）、阅读进度（应用数据目录）、"导入向导"显式创建新书（若保留，见第 11 节第 4 条）。
- **渐进式**：首屏不解析整个 OCR 文件；随机跳页与顺序阅读各走一条路径，代价都在毫秒级（第 4.2 节实测）。
- 外部编辑应用内可感知：窗口聚焦或文件变动后自动重读，不需要重启。
- 坏文件**在书库里就报出来**（哪个文件、哪个字节偏移、期望什么），不是等打开时才崩。
- 为后期 Monaco 留接缝：**读用同一份偏移索引，写只替换该页的字节区间**（第 9 节 Phase 4）。

**不变量（现有的好性质必须保住）**

- PDF 逐字节不变。
- 渲染层不碰 fs：仍然只有 `window.api` 白名单 + 自定义协议。
- `app.getPath()` 只在 `src/main/index.ts` 调一次，路径靠 `AppContext` 注入（`AGENTS.md` §3）。
- `src/shared/` 零依赖、纯函数，能在纯 Node 测试里 import。
- 已手工验过的行为不受影响：翻页 / 缩放 / Fit Width / Flow 模式 / 划词翻译 / 主题 / 阅读字号。

---

## 4. 目标形态

### 4.1 目录结构

```
<书库台账> %APPDATA%\LBook\library.json      ← “哪些文件夹是书”，可以指向任何位置
  books: [ { path: "BPP Financial Accounting", uid: "…" }, … ]
       │  在“默认新建位置”之下时存相对路径（整体搬家不断链），之外存绝对路径
       ▼
<默认新建位置>（默认 文档\LBook Library，可在设置里改）
  BPP Financial Accounting/        ← 一个文件夹 = 一本书；文件夹名只用于显示，不参与身份
    book.pdf                       ← 原样，不改（迁移时校验 sha256）
    bpp-financial-accounting.json   ← PaddleOCR 输出的那个大文件，原样（名字随便，meta 里记着）
    meta.json                      ← 我们附加的唯一必需文件：uid / 标题 / 作者 / 页数 / ocr 文件名
    toc.json                       ← 可选：目录（沿用现有契约与 parseToc 校验）
    cover.jpg                      ← 可选
    imgs/…                         ← 可选：OCR 引用的图片（现在还是百度签名 URL，抓不下来）
```

**这个文件夹 ≈ "PaddleOCR 的输出目录 + `book.pdf` + `meta.json`"**：用户完全可以拿 OCR 工具的输出目录直接当书文件夹用，只补两个文件；我们不做任何格式改写，也没有"拆页/拼回"这种自有变换。**书可以在任何盘、任何目录**——台账记的是地址（模仿 Obsidian 的 vault 列表），不在“一个库目录”里也没关系。

### 4.2 决策 A：单个大 JSON + 字节偏移索引（实测决定）

**做法**：不解包、不拆页。启动读一本时，用一个小扫描器在**字节层面流式**走一遍 JSON，记下 `layoutParsingResults[]` 每个元素的 `[start, end)` 偏移；之后"取第 N 页"= 按偏移读那一段（约 20–70KB）再 `JSON.parse` 它。扫描器只跟踪花括号层级与字符串状态，**不解析内容、不假设缩进**（用户用编辑器重排过也照样成立），而且是**流式分块**的——内存里从不需要出现整个文件。

实测：`npm run probe:perf`（本机 Node 24 / V8，与 Electron 主进程同一引擎），两个都是真实文件：

| 指标 | 库内最大：BPP（ocr.json 7.9MB / 665 页） | 手上最大真实输出：Oxford 3ed（15.6MB / 294 页） |
|---|---|---|
| **自检**：扫描器切片 vs V8 整文件 parse 逐页深度比对 | **665/665 相等** | **294/294 相等** |
| 流式扫全文件建索引 | 22.7 ms（349 MB/s） | 35.7 ms（438 MB/s） |
| 首屏（只扫到第 30 页 + 取第 1 页） | **3.1 ms** | **6.9 ms** |
| 冷开书（连全扫一起算） | 23.0 ms | 36.3 ms |
| 顺序 / 随机取一页 p95 | 0.14 / 0.07 ms | 0.32 / 0.29 ms |
| 内存增量：懒加载（索引 + 读了 130 页） | **+4.2 MB** | **+4.7 MB** |
| 内存增量：整文件 `JSON.parse` | +46.6 MB | +48.1 MB |
| 对照：现在这条 SQLite 取一页 | 0.10 ms | — |
| 对照：PDF 64KB 区间读（`.lbook` zip / 普通文件） | 0.13 / **0.01** ms（快 10.6×） | — |
| 对照：PDF 2MB 区间读（zip / 普通文件） | 0.42 / **0.21** ms（快 2.0×） | — |
| 对照：书库扫描（101 本同层文件夹） | 7.3 ms（72 µs/本） | — |

结论（全部达标，现行阈值写在探针末尾）：

- **按页取 0.04–0.13 ms 均值、p95 ≤ 0.32 ms**——比现在从 SQLite 取一页（0.10 ms）还快，而且不需要数据库。
- **内存与文件大小解耦**：两个文件差一倍（7.9MB vs 15.6MB），懒加载增量几乎一样（+4.2MB vs +4.7MB，差的那些是索引与 GC 噪声），而整文件 parse 的增量随文件涨（+46.6MB vs +48.1MB）。稳态只需要"索引 + 当前页"（665 页的索引约 10KB）。
- **自检比速度更重要**：探针会把扫描器给的每一页切片交给 V8 自己 parse，再与整文件 parse 的同一页逐一深度比对。两个文件上全等，所以上面那些"快"不是快在一个错索引上。
- **不需要索引缓存也能接受**：冷扫 15.6MB 只要 36ms，用户看不见（读回缓存只要 0.06–0.13ms，等真遇到 100MB+ 的 JSON 再加）。
- **迁移是纯拷贝**：解包一本 69MB 的 PDF + ocr.json 用时 54 ms（一次性）。

**为什么不做"每页一个文件"**（我之前那版计划）：它带来的是 1872 个文件/本、100 本约 3.7 万个文件的量级风险（OneDrive 同步、Defender、列目录），而实测说明按偏移读单页已经和"读一个小文件"同价；而且拆页/拼回是**我们自己发明的变换**，多一处可能出错的地方，也让"直接拿 OCR 输出目录当书用"变得不可能。

**两个必须写下来的语义**：

1. **页号 = 数组下标**。PaddleOCR 的元素里没有页号字段。删掉/插入一个元素会把后面所有页错位 → 校验发现"页数 ≠ PDF 页数"时要明确报出来（第 6 节）。
2. `outputImages` / `inputImage`（每页约 600 字节）是**百度 BOS 的签名 URL，早已过期**。留着（原样 = 纯粹），但不要指望它能显示图片。

### 4.3 决策 B：`markdown.text` 与块**各读自己那段**（2026-10-11 拍板）

两个视图互不派生：**Markdown 视图（与复制按钮）读文件里的 `markdown.text`，Blocks 视图读 `parsing_res_list`**。它们在同一份 OCR JSON 里（一份 JSON，不折不扣），但不是彼此的推算结果——想两边一致就自己在文件里把两边都改。

因此**不做 `markdownFromBlocks`**。`DESIGN.md` §5.5/§12 里"改块不会反映到 Markdown 视图"这一条从"已知限制"变成**有意为之**：它与"应用不提供编辑、用户自己改文件"是同一套取舍。

（上一版计划曾建议由块拼，理由是实测 95.2% 逐字节相等；被否掉的是"替用户决定哪个是真相"，不是那个数字。）

### 4.4 决策 C：阅读进度不进书文件夹（建议）

进度是"这台机器读到哪"的状态，不是书的内容。放进书文件夹会让只读挂载、网络盘、`git status` 都变麻烦。建议放 `%APPDATA%\LBook\progress.json`（按 `uid` 索引），书文件夹整体可只读挂载。

---

## 5. 身份、台账与外部改动

- **身份**：`meta.json` 的 `uid`（迁移时沿用现有 `uid`，所以**进度不丢**）。文件夹改名不改身份；书也可以整个搬到别的盘。
- **书库 = 一份路径台账**（A11）：`%APPDATA%\LBook\library.json` 只记“哪些文件夹是书”；列表 = 逐条读那些 `meta.json`（**不碰 OCR JSON**），页与目录按需读。**不在任何地方“扫描目录找书”**。
- **添加一本**：选一个文件夹（Obsidian 的 Open folder as vault）；**移除一本**：只删台账条目，**磁盘一律不碰**。
- **重复身份**：两条条目指向同一个 `uid` 或同一路径（用户复制了文件夹）→ 都列出来，其一标“重复”，让用户自己处理；**应用不自动改写文件**。
- **台账里的路径失效**（文件夹被移走/改名）→ 那一条标“找不到”（B8）；进度留在 `progress.json`，书回来还能接着读。
- **外部改动**：`fs.watch` 挂在**已登记的那几个文件夹**上 + 去抖 300ms + 窗口聚焦时重读；正在读的那页若变了就重读（保持页码与滚动位置）。网络盘上 watch 不可靠，另给显式的“刷新”按钮并做 30s 轮询兜底。
- **坏书**：`meta.json` 缺 `uid`、PDF 不存在、OCR JSON 定位不到 `layoutParsingResults`、某页 JSON 坏、页数与 PDF 不符 → 书库照样列出，标“需要修复”，点开显示**文件 + 字节偏移 + 期望**。

---

## 6. 校验（"用户自己改文件"的前提）

| 对象 | 校验什么 | 坏了的后果 |
|---|---|---|
| `meta.json` | `uid`（非空字符串）/ `title` / `pageCount` / `ocrFile` / `formatVersion`；**未知键保留不动** | 标"不可识别"，不进书库正文 |
| OCR JSON | 能找到 `layoutParsingResults` 且它是数组；每页元素是对象且含 `prunedResult.parsing_res_list`；`block_bbox` 是 4 个数；`markdown.text` 是字符串或缺失 | 定位到**字节偏移**报错；定位得到的前后页仍可读 |
| 页号语义 | 页数 vs `meta.pageCount` vs PDF 真实页数；**删/插元素会整体错位** | 标"页数不符"，仍可打开，提示"页码可能整体移位" |
| `toc.json` | 现有契约（`parseToc`，已有一整套单测） | 目录栏显示错误，正文不受影响 |
| `book.pdf` | 文件头 `%PDF-`；打开失败要报"这个 PDF 坏了"而不是白屏 | 标"PDF 无法打开" |

校验器与 UI 同源：同一套消息将来直接喂给 Monaco 的 diagnostics，所以不写第二套。

---

## 7. 删除清单（这次重构真正的收益）

| 层 | 规模 | 处置 |
|---|---|---|
| `src/main/lbook/`：`reader.ts` `zipIndex.ts` `packer.ts` `validate.ts` `reconstruct.ts` `archiveCache.ts` | 共 1158 行，其中 `ocr.ts`（解析 PaddleOCR JSON）留下并改为配合偏移索引 | 删约 800 行 |
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
- **步骤**：建文件夹（`slugify` + 重名加序号）→ 解包 `book.pdf`（**校验 sha256 与包内一致**）→ **`ocr.json` 原样写出去，一个字节都不改**（因此也不再需要 `pages/` 拆分与拼回）→ `toc.json` 与封面原样拷 → 写 `meta.json`（`uid` 沿用库里那个，记下 OCR 文件名）→ 进度从 DB 抄进 `progress.json`。
- **原包一律保留**（不移动、不删除），扫描忽略 `.lbook`。
- **验收（沿用 `TEST.md` §4 黄金用例的路子）**：迁移真实库的 5 本后逐项比对——PDF 逐字节相同、OCR JSON 与包内那份逐字节相同、页数相同、索引扫出的页数与 `layoutParsingResults.length` 相同、目录条目数相同、进度页码相同；且**迁移可重复执行**（第二次什么都不做，幂等）。

---

## 9. 阶段（每段可独立验收、可停）

| 阶段 | 内容 | 验收 |
|---|---|---|
| **Phase 0 定调** | **已完成**（即本次性能验证）：`npm run probe:perf` 把两个真实文件都过了——索引自检 665/665 与 294/294 全等；首屏 3.1–6.9ms、按页 0.04–0.13ms；懒加载内存增 4.2–4.7MB 且不随文件大小变（整文件 parse 是 46–48MB）；101 本书库扫描 7.3ms；解包一本 69MB 的书 54ms。剩下要拍的是第 11 节那几条 | 数字全部达标，见第 4.2 节 |
| **Phase 1 读路径 + 迁移**（2–3 天） | 把探针里那个扫描器搬进 `src/main/lbook/` 并补单测；folder 存储层（list / readPage / readToc / readCover / readPdfRange）；协议改为真实文件范围读；迁移器 + 黄金测试；**同时下掉所有编辑入口** | **✅ 已完成**（2026-10-11，T1–T12；SQLite 比计划提前删掉，不保留缓存）。真实 5 本已迁移并逐本复核；应用能列、能读、能翻页；外部改某页的一个字、重启后能看到 |
| **Phase 2 反应式与校验**（1–2 天） | watch + 聚焦重扫 + 手动刷新；校验 UI（坏书徽标 + 明细，含字节偏移）；"在资源管理器中打开 / 用系统默认程序打开该文件" | **✅ 已完成**（2026-10-11）：机制是"每次读都比对 mtime"，watch 只是加速器；校验器一套规则两处用（列表用便宜半边，Check 按钮跑深度检查）；实测把真书的 `ocr.json` 改坏两处，都能报出字节偏移且第 1 页仍可读 |
| **Phase 3 删索引与原生依赖**（1 天） | 删 db 层与 `better-sqlite3`（进度改 JSON）、删 `yauzl`/`yazl` 与打包配置、重写 `DESIGN.md` §5/§6/§12、`BUILD.md` §5、`TEST.md` 职责表 | **大部分已随 Phase 1 完成**（db 层已删、`yazl` 已移、`asarUnpack`/`npmRebuild` 已删、四份文档已重写）；剩“迁移跑完→删迁移器与两个 devDependency”与打包体积实测 |
| **Phase 4 后期：Monaco 按页编辑**（独立立项） | **读用同一份偏移索引**：把该页的字节区间取出来给 Monaco；保存时把该页重新序列化后**替换那一段字节**（区间拼接，其余字节原样不动），保存后失效索引并按 watch 回读；JSON Schema 生成 Monaco markers | 改坏一个字段 → 当场标红并拒绝保存；保存合法的修改 → 文件其余部分逐字节不变、两个视图同步更新 |

Phase 4 是唯一重新引入"写"的阶段，而且写的是**用户自己的 JSON 文件里的一个字节区间**，不是数据库——所以它不影响 Phase 1–3 的只读基线。

---

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| **手改导致 JSON 局部损坏**（少个引号/逗号） | 逐页解析意味着**远处的坏不影响当前页**；扫描器遇到结构断裂要能重同步到下一个 `},{` 边界，并报出**字节偏移**。诚实地说：如果坏在数组结构上，定位可能整体错位——所以校验要同时报"扫到 N 页 vs `meta.pageCount` 不符" |
| **删/插页元素导致页码整体移位** | 页号 = 数组下标是必须写下来的语义；校验发现页数与 PDF 不符就提示"页码可能整体移位"，而不是默默显示错页 |
| `outputImages` / `inputImage` 是过期签名 URL | 原样保留但不读；将来"图片本地化"要重新下载，与本次重构无关 |
| 迁移不可逆 | 原包保留 + PDF 逐字节校验 + OCR JSON 逐字节校验 + 幂等 + 逐本失败隔离 |
| 失去"单文件便携" | 若这是真需求，Phase 4 之后加"导出为只读归档"（`yazl` 那时才需要回来，且只用于导出） |
| `fs.watch` 在 Windows 上会重复/丢事件 | 去抖 + 轮询兜底，不迷信 watch |
| 已装的 0.0.1 用户升级后书库要能自动迁移且不丢进度 | Phase 1 的黄金测试必须包含"从真实 0.0.1 库迁移"这一条 |

---

## 11. 已拍板的决定（2026-10-11）

第 11 节原本是"需要你先定的 6 件事"，现已全部答完，**施工细节见 [`.agents/plan/00-decisions.md`](./.agents/plan/00-decisions.md)**（A10–A13）。要点：

| 问题 | 结论 |
|---|---|
| 单个大 JSON vs 每页一个文件 | **单个大 JSON + 字节偏移索引**（实测：按页 0.04–0.13ms，索引自检全等） |
| Markdown 视图数据源 | **各读自己那段**：Markdown 读 `markdown.text`，Blocks 读 `parsing_res_list`；**不做** `markdownFromBlocks` |
| 阅读进度放哪 | `%APPDATA%\LBook\progress.json`（按 `uid`） |
| 导入向导 | **不做**：新增书籍 = "打开一个书文件夹" |
| `.lbook` 读取能力 | **不保留**：只在迁移时读一次，之后代码里没有读包的路径 |
| 页号语义 | **页 = 数组下标**，靠"页数与 PDF 不符"的校验兜底 |
| 删除一本书 | **只从路径台账里移除条目**，磁盘一律不碰（模仿 Obsidian 的 vault 列表） |
| 迁移怎么执行 | **先备份，再由我跑完整迁移**并逐本校验（PDF sha256、`ocr.json` 逐字节、页数、进度） |

---

## 12. 本计划**不做**

- 不做云同步、多端、多用户并发写。
- 不做 OCR 本身（仍然由外部 PaddleOCR 产出）。
- 不做全文检索（要做得单独立项，见 `DESIGN.md` 的已知限制）。
- 不把 PDF 放进 git（库目录可版本管理，但要配 `.gitignore` 忽略 `book.pdf`）。
- 不为了这次重构顺手改渲染层外观（主题、字号、分隔条保持现状）。

---

## 13. 相关文档

- 父级：[README.md](./README.md)
- 同级：[DESIGN.md](./DESIGN.md)、[BUILD.md](./BUILD.md)、[TEST.md](./TEST.md)、[AGENTS.md](./AGENTS.md)
- 施工计划（逐阶段任务清单与决策台账）：[.agents/plan/README.md](./.agents/plan/README.md)
- 相关：[src/main/lbook/README.md](./src/main/lbook/README.md)、[src/main/library/README.md](./src/main/library/README.md)、[src/main/db/README.md](./src/main/db/README.md)
