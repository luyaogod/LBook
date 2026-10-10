# PLAN.md —— 从单文件 `.lbook` 到 Obsidian 式文件夹书库

> **状态：计划，未实施。** 本文只写目标、取舍与阶段；当前实现仍在 `DESIGN.md` 里。第 11 节是等你拍板的决策清单，其余章节都已给出建议，**带数字的结论都是在真实数据上量出来的**（第 4.2 节）。

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
<库目录>/
  BPP Financial Accounting/        ← 一个文件夹 = 一本书；文件夹名只用于显示，不参与身份
    book.pdf                       ← 原样，不改（迁移时校验 sha256）
    bpp-financial-accounting.json   ← PaddleOCR 输出的那个大文件，原样（名字随便，meta 里记着）
    meta.json                      ← 我们附加的唯一必需文件：uid / 标题 / 作者 / 页数 / ocr 文件名 / 来源
    toc.json                       ← 可选：目录（沿用现有契约与 parseToc 校验）
    cover.jpg                      ← 可选
    imgs/…                         ← 可选：OCR 引用的图片（现在还是百度签名 URL，抓不下来）
  _legacy/…                        ← 迁移前的 .lbook 原包（只作备份，扫描忽略）
```

**这个文件夹 ≈ "PaddleOCR 的输出目录 + `book.pdf` + `meta.json`"**：用户完全可以拿 OCR 工具的输出目录直接当书文件夹用，只补两个文件；我们不做任何格式改写，也没有"拆页/拼回"这种自有变换。

### 4.2 决策 A：单个大 JSON + 字节偏移索引（实测决定）

**做法**：不解包、不拆页。启动读一本时，用一个小扫描器在**字节层面**走一遍 JSON，记下 `layoutParsingResults[]` 每个元素的 `[start, end)` 偏移；之后"取第 N 页"= 按偏移读那一段（约 20–70KB）再 `JSON.parse` 它。扫描器只跟踪花括号层级与字符串状态，**不解析内容、不假设缩进**（用户用编辑器重排过也照样成立）。

实测（本机，Node 24 / V8，与 Electron 主进程同一引擎）：

| 指标 | 真实文件：Oxford 3ed（15.6MB / 294 页） | 合成：BPP 形状（18.4MB / 665 页） |
|---|---|---|
| 整文件 `JSON.parse`（我们**不**走这条路） | 35.8 ms，峰值 RSS **121 MB** | 43.4 ms，峰值 RSS **142 MB** |
| 扫全文件建偏移索引 | 37.7 ms | 38.0 ms |
| 只扫到第 30 页（首屏付这个） | 6.4 ms | 3.8 ms |
| 按偏移取一页（切片 + parse） | **0.15–0.22 ms** | **0.04–0.14 ms** |
| 懒加载路径常驻 RSS | 103 MB（含 15.6MB 缓冲） | **74 MB**（与页数无关） |
| 逐页结果 vs 整文件 parse 深度比对 | **294/294 完全一致** | — |

结论：

- **按页取 0.1–0.2 ms**——比现在从 SQLite 取一页还快，而且不需要数据库。
- **内存与文件大小解耦**：稳态只需要"索引 + 当前页"（665 页的索引约 10KB）。读整个文件到 Buffer 只是 Phase 1 的简化写法（18MB 一次性读入 3.6ms）；真遇到超大 JSON，把扫描改成按 1MB 分块流式走一遍即可（状态机跨界续着走），之后每页用 `fs.read(fd, …, offset)` 读自己那一段，内存里永远不出现整个文件。
- **不需要索引缓存也能接受**：冷扫 18MB 只要 38ms，用户看不见。若以后遇到 100MB+ 的 JSON，再加"`%APPDATA%\LBook\index\<uid>.json`，键 = 文件 size + mtimeMs"这份缓存即可（失效就重扫 38ms）。
- **不需要格式假设**：格式化过的（两空格缩进 + CRLF，实测 59 万行，人能读能改）、压缩成一行的、用户重排过的，扫描器都认。文件被重写过 → `mtime` 变了 → 重扫，仅此而已。

**为什么不做"每页一个文件"**（我之前那版计划）：它带来的是 1872 个文件/本、100 本约 3.7 万个文件的量级风险（OneDrive 同步、Defender、列目录），而实测说明按偏移读单页已经和"读一个小文件"同价；而且拆页/拼回是**我们自己发明的变换**，多一处可能出错的地方，也让"直接拿 OCR 输出目录当书用"变得不可能。

**两个必须写下来的语义**：

1. **页号 = 数组下标**。PaddleOCR 的元素里没有页号字段。删掉/插入一个元素会把后面所有页错位 → 校验发现"页数 ≠ PDF 页数"时要明确报出来（第 6 节）。
2. `outputImages` / `inputImage`（每页约 600 字节）是**百度 BOS 的签名 URL，早已过期**。留着（原样 = 纯粹），但不要指望它能显示图片。

### 4.3 决策 B：`markdown.text` 留在文件里，但视图由块拼（建议）

页元素按 PaddleOCR 原样保存，所以什么都不丢；但**渲染时 Markdown 视图由块拼**（`markdownFromBlocks(blocks)`），这样"改块 → 两个视图一致"自然成立，磁盘上又留着 OCR 原文可对照。

依据是上一轮对真实库的实测（1872 页）：丢掉 `header` / `header_image` / `footer` / `footer_image` / `number` / `aside_text` 六类页眉页脚块后，按顺序拼接块内容与 `markdown_text` **逐字节相等 95.2%**、**仅差空白 99.4%**、**真正的文本差异只有 1 页 1 个字符**，另有 2 页"有 markdown、无块"（回退到文件里那份）。markdown 标记本来就在块内容里（`paragraph_title` 的内容就是 `"### 1 Nature…"`），所以拼接**不需要复刻 PaddleOCR 的排版器**。

### 4.4 决策 C：阅读进度不进书文件夹（建议）

进度是"这台机器读到哪"的状态，不是书的内容。放进书文件夹会让只读挂载、网络盘、`git status` 都变麻烦。建议放 `%APPDATA%\LBook\progress.json`（按 `uid` 索引），书文件夹整体可只读挂载。

---

## 5. 身份、扫描与外部改动

- **身份**：`meta.json` 的 `uid`（迁移时沿用现有 `uid`，所以**进度不丢**）。文件夹改名不改身份。
- **扫描**：只读每本书的 `meta.json`（一本书一个文件，**不碰 OCR JSON**），构造内存索引；页与目录按需读。
- **重复身份**：两个文件夹声明同一个 `uid`（用户复制了文件夹）→ 两个都列出来，其一标"重复"，让用户自己改名或删；**应用不自动改写文件**。
- **外部改动**：`fs.watch(libraryDir, { recursive: true })` + 去抖 300ms + 窗口聚焦时重扫；正在读的那页若变了就重读（保持页码与滚动位置）。网络盘上 watch 不可靠，另给显式的"重新扫描"按钮并做 30s 轮询兜底。
- **移出/删除**：扫描发现消失就从索引移除；进度留在 `progress.json`，书回来还能接着读。
- **坏书**：`meta.json` 缺 `uid`、PDF 不存在、OCR JSON 定位不到 `layoutParsingResults`、某页 JSON 坏、页数与 PDF 不符 → 书库照样列出，标"需要修复"，点开显示**文件 + 字节偏移 + 期望**。

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
| **Phase 0 定调**（0.5 天） | 第 11 节的决策拍板；量基线：扫 100 本 `meta.json` 耗时、扫描器在"你库内最大那个 OCR JSON"上的耗时（本次已量：18MB/38ms） | 数字确认"单文件 + 偏移索引"成立 |
| **Phase 1 读路径 + 迁移**（2–3 天） | 偏移扫描器 + `readPage(n)`；folder 存储层（list / readPage / readToc / readCover / readPdfRange）；协议改为真实文件范围读；迁移器 + 黄金测试；**同时下掉所有编辑入口**（UI 上明说"想改就改文件"），SQLite 暂时保留为 listing 缓存以便随时回退 | 迁移真实库后能列、能读、能翻页；外部改 `pages` 里某页的一个字（`meta.json` 里的页数不变），重开该页能看到；Flow 模式连滚 6 屏不卡 |
| **Phase 2 反应式与校验**（1–2 天） | watch + 聚焦重扫 + 手动刷新；校验 UI（坏书徽标 + 明细，含字节偏移）；"在资源管理器中打开 / 用系统默认程序打开该文件" | 外部改 `toc.json` 后切回窗口即生效；把 JSON 结构改坏 → 书库标红但不崩、别的书照常、报错带偏移 |
| **Phase 3 删索引与原生依赖**（1 天） | 删 db 层与 `better-sqlite3`（进度改 JSON）、删 `yauzl`/`yazl` 与打包配置、重写 `DESIGN.md` §5/§6/§12、`BUILD.md` §5、`TEST.md` 职责表 | `npm ls better-sqlite3 yauzl yazl` 为空；打包不再需要 `asarUnpack`；安装包体积下降 |
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

## 11. 需要你先定的 6 件事

1. **单个大 JSON vs 每页一个文件** —— 实测已定夺：**单个大 JSON + 偏移索引**（决策 A）。除非你有"一页一个文件、好逐个 diff/git"的**硬**理由，否则按实测走。
2. **Markdown 视图由块拼 vs 读文件里的 `markdown.text`** —— 建议由块拼，文件保留原文（决策 B）。
3. **阅读进度放 `%APPDATA%` vs 书文件夹内** —— 建议 `%APPDATA%`（决策 C）。
4. **是否保留"导入向导"**（应用创建新书文件夹）—— 建议保留一个最小的（选 PDF + OCR JSON → 建文件夹），因为纯扫描要求用户自己会摆目录结构；但**不保留任何后续编辑**。
5. **是否保留 `.lbook` 读取能力**（双格式并存）—— 建议不保留：一次性迁移 + 原包留底，代码里只留迁移器。
6. **接受"页号 = 数组下标"这个语义吗** —— 建议接受（PaddleOCR 输出里没有页号字段），靠校验兜底；若你更想显式化，可以在 `meta.json` 里放一份页号映射，但那是我们发明的第二份真相，不推荐。

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
- 相关：[src/main/lbook/README.md](./src/main/lbook/README.md)、[src/main/library/README.md](./src/main/library/README.md)、[src/main/db/README.md](./src/main/db/README.md)
