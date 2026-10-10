# LBook 设计文档

## 1. 项目概述

LBook 是一个 Windows 桌面应用，用来**管理、阅读和校对 PaddleOCR-VL 扫描出来的书籍**。

它本身**不做 OCR**。扫描与识别由外部的 PaddleOCR-VL / PP-StructureV3 完成，产出 JSON；LBook 负责把这份 JSON 与原始 PDF 组织成一本可读的书，提供 PDF 渲染、OCR 结果叠加、逐块编辑与阅读进度记录。

**目标形态**：一个 NSIS 安装包，装上即用，不依赖 Python、Node 或任何外部服务。

---

## 2. 从 Web 到桌面的架构演进

改造前是一个双进程 Web 应用，靠 `start.bat` 手工拉起两个黑窗口：

```
浏览器 ──HTTP──> Vite dev server (:5173)
       ──HTTP──> FastAPI (:8000) ──SQLAlchemy──> backend/lbook.db
                                 ──FileResponse──> backend/uploads/*.pdf
```

它有几个绕不过去的问题：

- 无法分发。用户要装 Python 3.11、uv、Node，再点脚本启动，自己开浏览器。
- 数据位置不合规范。SQLite 是相对路径 `sqlite:///./lbook.db`，`uploads/` 写死在源码目录，`pdf_documents.file_path` 存**绝对路径**——目录一挪或换台机器，全部断链。
- 没有工程化。零测试、零打包、零更新机制。

改造后：

```
Electron main (Node) ──better-sqlite3──> %APPDATA%\LBook\lbook.db
                     ──yauzl 字节区间读取──> <库目录>/*.lbook
                            ▲
                            │ IPC（结构化克隆）
                            │
Electron renderer (React + pdf.js) ──lbook:// 协议──> 封面与包内资源
```

后端整层被删除，15 个 REST 端点全部翻译成 IPC 通道（见第 7 节）。

---

## 3. 进程模型与安全边界

| 进程 | 职责 | 权限 |
|---|---|---|
| **main** | 数据库、文件系统、`.lbook` 读写、协议服务、更新 | 完整 Node |
| **preload** | 唯一桥梁。暴露**具名白名单**，绝不暴露泛化的 `invoke(channel, …)` | 沙箱内，只能 `contextBridge` / `ipcRenderer` / `webUtils` |
| **renderer** | React UI、pdf.js 渲染 | 与普通网页相同，无 Node |

窗口标志：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。

**应用菜单被整个移除**（`Menu.setApplicationMenu(null)`）。默认模板里的 File/Edit/View/Window 在本应用里要么没有对应命令，要么与渲染层已有的快捷键重复（保存是 `App.tsx` 自己处理的 `Ctrl+S`）。菜单角色在 Windows 上并不承担文本框的复制粘贴——那是 Blink 自己处理的——所以移除它不会影响输入。

**窗口也没有系统标题栏**（`titleBarStyle: "hidden"`）：标题栏只会把产品名重复一遍，而它下面紧挨着的就是应用自己的顶栏。最小化/最大化/关闭改成**应用自己画**（`layout/WindowControls.tsx` + `window:*` IPC），而不是交给 Windows 的 `titleBarOverlay`。

原因是 WCO 改不掉的两个毛病，两个都是肉眼可见的：

1. **它那条底的颜色与我们页头的颜色是两套。** WCO 把自己的区域刷成给定色，而页头是透明的 `--background`；两者只要不完全相同，右上角就露出一块色差（暗色主题下尤其明显）。
2. **它只肯给关闭按钮上色。** 悬停时关闭是系统红、另外两个是灰，没有 API 能统一；而且它总把高亮画成浮在顶栏中间的一小块，而不是像标题栏那样整条顶满。

自绘之后三条都按我们的意思办：底色就是页头、高亮整条顶满、关闭悬停用 `#E81123`（**这个红是刻意保留的**，见 `layout/README.md`——它是所有人读得懂的"这个按钮会关掉窗口"）。顺带解决了 WCO 的第三个麻烦：它那条不透明区域会盖住顶栏的 1px 下边线，右上角出现一截断线；当初的补丁是把 `titleBarOverlay.height` 设成比顶栏矮 2px（54 对 56）绕开它。自绘之后没有这条区域，边线自然连续，页头也不再需要为按钮预留 150px。

代价是两件事要自己保证：可点元素必须标 `no-drag`（否则点击被拖动区吞掉），以及最大化/还原的图标要订阅 `window:maximized`——双击拖动区、`Win+↑`、拖到屏幕边缘都会改变窗口状态，不只是点我们的按钮。拖动、双击最大化、贴边吸附仍由 `-webkit-app-region: drag` 提供；失去的是 Win11 悬停最大化按钮时的"贴靠布局"浮层。

Electron 的 WCO 只在 Windows 上生效，且**用普通截屏工具验证时要注意 DPI 缩放会把窗口右侧裁掉**，看起来像按钮没画出来——用 `src/main` 里的 DPI 感知截屏脚本（`D:\我的项目\LBook-scratch\window-shot.ps1`）才准。

**应用图标**在 `resources/icon.svg`（同款 lucide `book-open`，黑字白底圆角），打包时由 `resources/icon.ico` 盖进 exe，见 `BUILD.md` 第 7 节。

**依赖注入是硬约束**：`app.getPath()` 全仓库只在 `src/main/index.ts` 出现一次，其余模块通过 `AppContext` 接收路径。这既是安全意识，也是让整个数据层与 `.lbook` 层能在纯 Node 下跑单元测试的前提。

---

## 4. 自定义协议

两个 scheme，都必须在 `app.whenReady()` 之前注册为 privileged：

| scheme | 地址 | 用途 |
|---|---|---|
| `app://bundle/…` | `app://bundle/index.html` | 生产环境加载渲染层 |
| `lbook://cover/<uid>` | 书籍封面 | `<img src>` |
| `lbook://asset/<uid>/<条目路径>` | 包内资源 | `<img src>` |

### 4.1 为什么不能从 `file://` 加载

`file://` 是不透明源，`new Worker(file://…)` 会被拒绝。pdf.js 检测到 worker 创建失败后会**静默退回主线程解析**（`_setupFakeWorker`），一本 189MB 的书会直接把 UI 冻死。走 `app://` 让页面、worker、资源同源，同时让 `fetch` 与 CSP 行为与普通 HTTP 一致。

### 4.2 PDF 为什么不走协议——这是全设计最反直觉的一点

直觉上 `lbook://pdf/<uid>` 配 HTTP Range 是最自然的做法。**它不成立**，因为 pdf.js 只对 http(s) 发范围请求：

`node_modules/pdfjs-dist/build/pdf.mjs`

```js
// :10084
this.isHttp = /^https?:/i.test(source.url);

// :10004-10020
function validateRangeRequestCapabilities({ getResponseHeader, isHttp, rangeChunkSize, disableRange }) {
  const returnValues = { allowRangeRequests: false, suggestedLength: undefined };
  const length = parseInt(responseHeaders.get("Content-Length"), 10);
  if (!Number.isInteger(length)) return returnValues;
  returnValues.suggestedLength = length;
  if (length <= 2 * rangeChunkSize) return returnValues;
  if (disableRange || !isHttp) return returnValues;      // ← 自定义 scheme 死在这里
  if (responseHeaders.get("Accept-Ranges") !== "bytes") return returnValues;
  …
}
```

对 `lbook://`，`isHttp` 为 `false`，`allowRangeRequests` 永远为 `false`，pdf.js 会退化成**把整个文件读进渲染进程内存**。

**结论：PDF 走 IPC，不走协议。** 使用 `PDFDataRangeTransport`（`pdf.mjs:11571`，由 `getDocument` 在 `:11360` 以 `instanceof` 消费），完全绕开上面的判断。

> 唯一能让 `isHttp === true` 的替代方案是起一个 loopback HTTP 服务——那等于把刚扔掉的服务器又捡回来，不做。

### 4.3 翻页与滚动的性能账（都是实测值）

优化前先把每一段量清楚。测量脚本在 `LBook-scratch`（`perf-suite.mjs` / `flip-dist.mjs` / `flow-check.mjs`），用 CDP 发**真实**点击与滚轮，并用 canvas 绘制调用界定"首绘"时刻（采样画布像素会被"先铺白底"骗到）。

**管道不是瓶颈**：`book.getPage`（整页 OCR + 全部块，来自 SQLite）中位 **0.8ms**，`readPdfRange` 64KB 中位 **0.5ms**、1MB 中位 **3.3ms**。所有场景主线程长任务（>50ms）都是 **0**——所以这不是"算得慢"，而是"在等一串异步步骤"。

| 场景（最重的书：178MB / 451 页扫描本） | 优化前 首绘 | 优化后 首绘 |
|---|---|---|
| 单页翻页（稳态 20 次） | 中位 60–90ms，p90 120ms | **中位 9ms**，p90 12ms |
| 流式跳页（目标页出现墨迹） | 204ms（另一次实测 858ms） | **34–43ms** |
| 流式回滚到看过的页 | — | **55ms**，且画布复用不重画 |
| 打开书本首绘 | 119–178ms | 138ms（持平） |
| 流式模式同时存在的 canvas 数 | 7–8 | **5** |

四条改动，每条都对着一项测量：

1. **流式按可见性渲染。** 原先加载窗口里**每一页**挂载即渲染，且按 DOM 顺序——读者正在看的那一页排在视口外几页的后面。现在 `paintedPages` 把"已加载"与"已绘制"分开：只有进入观察器外扩带（±900px）或直接被跳转指向的页才拥有 canvas，其余留**尺寸相同的纸白占位**。集合有上限（6 页），并按窗口裁剪，这同时就是位图缓存：看过的页只要还在窗口内就不重画。
2. **跳转改为瞬移，不再平滑滚动。** 平滑滚动到 20 页外会**扫过沿途每一页**，每一页都进入观察器外扩带并请求绘制，目标页因此排在几十个绘制任务之后（实测 858ms）。改成 `block: "start"` 瞬移后是 43ms，读者也更早看到目标页。跳转只先画目标页本身，邻居交给观察器晚一帧处理。
3. **`rangeChunkSize` 64KB → 512KB。** 每个分片是一次独立的异步往返，178MB 的书在 64KB 下是 ~2850 次；字节数一样，往返次数除以 8。
4. **单页模式预热邻居页**（`getPage(n±1).then(p => p.getOperatorList())`，在 `requestIdleCallback` 里做）。翻页首绘里大半是 pdf.js 构建操作符列表，把这一步挪出关键路径后，中位从 60–90ms 降到 **9ms**。

**`disableAutoFetch` 试过并否决。** 关掉自动续取看起来是显然的胜利（不再把整本 PDF 流进 worker），但实测在 178MB 的书上让稳态翻页**更慢**：首绘中位 90ms vs 60ms，p90 120ms vs 87ms——因为每次翻页都要等按需分片。所以保持默认开启，代价是整本驻留 worker；这也是"如果哪天抱怨内存"时第一个该回看的地方。（注意 `PDFDataTransportStream` 只接受 `disableRange`/`disableStream`，用自定义 range transport 时 `disableAutoFetch` 是在更里层的 worker `ChunkedStreamManager` 生效的。）

**没有做的**：渐进式画质（滚动中降 DPR）与单页预渲染位图——实测首绘已到 9ms，低于可感知阈值，不值得为它引入重绘与缓存失效的复杂度。

---

## 5. 数据层

### 5.1 位置

| 内容 | 位置 | 理由 |
|---|---|---|
| 配置 `config.json` | `%APPDATA%\LBook\` | 操作系统规范位置 |
| 索引 `lbook.db` | `%APPDATA%\LBook\` | **绝不放进库目录** |
| 书本 `*.lbook` | 用户可配置的库目录，默认 `文档\LBook Library` | 大文件，用户应能自己选盘 |

数据库与书本分离是刻意的：库目录可能放在移动硬盘或网络盘上，索引不能跟着一起失联。

### 5.2 表结构

与旧版 SQLAlchemy 模型 1:1（列名、约束全保留），仅新增四列：

| 列 | 作用 |
|---|---|
| `uid` | 跨导入稳定的身份，`lbook://` URL 用它；自增主键不可移植 |
| `relative_path` | 相对库目录的路径，使**库目录可迁移**而无需重写每一行 |
| `dirty` | 工作副本与磁盘上的 `.lbook` 是否有差异（Excel 模型的"未保存"） |
| `file_mtime` | 容器 mtime，让扫描能廉价判断外部改动，无需每次哈希 200MB |

`file_path` 保留为绝对路径缓存；`file_hash` 是**整个 `.lbook`** 的 SHA-256，保留原有的导入去重行为。

### 5.3 必须开启的 pragma

`src/main/db/open.ts` 按序执行：

- `journal_mode = WAL`
- **`foreign_keys = ON`** —— SQLite 默认**关闭**，而表结构依赖 `ON DELETE CASCADE`。不设这一条，删一本书会留下 38475 个孤儿 block。
- `synchronous = NORMAL`、`busy_timeout = 5000`

### 5.4 迁移

`PRAGMA user_version` 驱动，append-only 迁移数组，在开窗之前跑完（better-sqlite3 是同步的，这点数据量毫不犹豫）。已发布的迁移条目**永不修改**，只追加。

---

## 6. `.lbook` 格式规范

本质是一个 ZIP，**从不解压**。

```
manifest.json    格式版本 / uid / 标题 / 作者 / 创建时间 / 页数 / PDF 哈希 / 封面引用
book.pdf         必须 STORE（compressionMethod = 0），且排在包内首位
ocr.json         PaddleOCR-VL 原始输出，DEFLATE（可缺失）
toc.json         目录树，DEFLATE（可缺失）
cover.jpg        可选
assets/imgs/…    可选；本轮为空，格式预留
```

除 `book.pdf` 外全部条目都可缺失，读取端按缺失处理。新增可选条目**不**需要提升 `formatVersion`：老读取端忽略不认识的条目，新读取端把不认识的老包当作"没有这个条目"。

### 6.1 `book.pdf` 必须 STORE

这不是偏好，是硬约束，两条理由：

1. **可寻址。** DEFLATE 条目的字节范围只能对**压缩后**数据，无法 seek——每读一块都要从字节 0 重新解压，读完整本书是 O(n²)。
2. **可低成本保存。** STORE 让"保存"只需把 PDF 段**逐字节复制**过去，只重写尾部的可变条目，不重新压缩 189MB。

- 写入端硬断言，并有测试锁死。
- 读取端遇到外部来的 DEFLATE 包，`validate()` 报硬错误并置 `needsRepack`。

### 6.2 `toc.json`：目录就是文档的一部分

目录不是"应用的设置"，而是这本书的数据，所以它和 `ocr.json` 并排放在包里，而不是塞进 `lbook.db`。把 `.lbook` 拷到另一台机器，目录跟着走。

```json
{
  "version": 1,
  "source": "目录页转录；书本页号 + 3 = 扫描页号",
  "nodes": [
    { "title": "第一章 总论", "page": 4, "printedPage": 1,
      "children": [{ "title": "第一节 法律基础", "page": 6, "printedPage": 3 }] }
  ]
}
```

| 字段 | 含义 |
|---|---|
| `page` | **扫描页序号**（1 起，即 PDF 的第几页），跳转用的就是它 |
| `printedPage` | 纸面上印的页号，**仅供显示**；与 `page` 的差就是这本书的扫描偏移 |
| `children` | 子条目；允许任意深度（上限 6 层） |

**为什么两个页号都要有。** 扫描件前面常有几页没有页码的封面与目录，于是"书本第 3 页"落在"PDF 第 6 页"上，而且这个偏差在 PDF 里没有任何地方记录。只存一个数就必须让用户自己换算；只存印出来的页号则会让跳转偏掉整整一截。`page` 用于跳转，`printedPage` 用于让读者看到熟悉的编号。

解析规则集中在 `src/shared/toc.ts`（`parseToc`）：主进程用它拒绝一份写错的文件，渲染层用它把树摊平成可渲染的列表——两边同一份规则，不会各自理解。它刻意严格：`title` 不能空，`page` 必须是正整数，只当分组用的条目必须有 `children` 而不能是死节点，报错信息带 `nodes[1].children[0]` 这样的路径。手写 JSON 出错时，用户看到的应该是"哪个条目错了"，而不是一棵空树。

**目录在"建书/编辑"时就定下来**：`UploadDialog` 可以在建书时一并附上一份 `toc.json`，`EditDialog` 可以替换或移除它。写进去是立即的，不进"未保存"工作副本——它不像块编辑那样是逐条改动，而是一次性的文件选择，用户的意图本来就是"写进这本书"。阅读器里的目录树因此没有任何按钮，纯粹的阅读辅助。

**已入库的这些目录是怎么来的**（源文件在 `dev-data/*.toc.json`，用 `scripts/run.mjs apply-toc` 写进包）：

| 书 | 结构 | 扫描偏移 | 偏移是怎么确认的 |
|---|---|---|---|
| 经济法基础2024 | 8 章 / 37 节（45 条） | 印刷 + 3 | 目录页转录后逐条与正文标题核对 |
| 初级会计实务2024 | 10 章 / 42 节（52 条） | 印刷 + 3 | 同上 |
| BPP Financial Accounting | 26 章 + 5 技能检查点 + 前后附（229 条，章内编号小节做第二层） | 印刷 + 18 | **587 个页脚页码**（OCR 出的 `number` block）逐一吻合 |
| Oxford Picture Dictionary 3 ed | 11 单元 / 168 小节（182 条） | 印刷 + 7 | **275 个页脚页码**吻合 |
| Oxford Picture Dictionary（老版） | 85 个词条（单层） | 印刷 + 6 | **103 个页脚页码** + 26 个标题探针吻合 |

两条经验值得记住：

- **偏移量必须量，不能猜**。这些扫描件的正文页脚上印着页码，PaddleOCR 会把它们识别成 `number` 类型的块；把全书这种块抽出来做直方图，偏移量只有一个桶，比逐条猜标题可靠得多。
- **印刷页号只为显示，`page` 才用于跳转**。老版 OPD 的目录把跨页写成 `2-3`，而 `printedPage` 在契约里是单个正整数，所以只取起始页——跨页的提示写不下，也不该让"跳转"依赖它。

### 6.3 数据起始偏移必须读局部文件头

中央目录里的 `fileNameLength` / `extraFieldLength` **允许**与局部文件头不一致，只有局部头描述磁盘上真实的字节。所以：

```ts
const header = Buffer.alloc(30);
await handle.read(header, 0, 30, entry.relativeOffsetOfLocalHeader);
const dataStart = entry.relativeOffsetOfLocalHeader + 30
                + header.readUInt16LE(26) + header.readUInt16LE(28);
```

**验证方式**：`readPdfRange(uid, 0, 8)` 必须以 `%PDF-` 开头。这一条过了，所有偏移就都是对的。

### 6.4 安全

- 条目名做 zip-slip 校验（拒绝绝对路径、`..`、反斜杠）。yauzl 3 在解析阶段就会拒绝 `../`，恶意包直接打不开（fail-closed）；`isSafeEntryName` 作为纵深防御保留。
- 因为**从不落盘解压**，经典解压漏洞在此结构上不成立。

### 6.5 重打包要把没改的条目读回来

`repackLbook()` 是从头重建整个压缩包：PDF 段逐字节复制，其余条目按传入的内容重新生成。**没被显式写回的条目就没了。**

所以 `library/service.ts` 的 `repackPackage()` 在关掉句柄之前，会把本次不打算改动的 `ocr.json`、`toc.json`、封面原样读出来再传下去。"保存书本"只改 OCR，却顺手删掉目录和封面——这正是加目录功能时暴露出来的两个既有缺陷，现在有测试锁住。

---

## 7. IPC 契约

完整类型定义见 `src/shared/ipc.ts`，preload 暴露面见 `src/shared/ipc.ts` 的 `LbookApi`。

| 原 REST 端点 | 新通道 |
|---|---|
| `GET /api/pdfs/` | `library:list` |
| `GET /api/pdfs/{id}` | `library:get` |
| `GET /api/pdfs/{id}/pages/{n}` | `book:getPage` |
| `GET /api/pdfs/{id}/file` | `book:readPdfRange`（IPC，**非**协议） |
| `GET /api/pdfs/{id}/cover` | `lbook://cover/<uid>`（协议） |
| `POST /api/pdfs/upload` | `library:createFromFiles` |
| `PATCH /api/pdfs/blocks/{id}` | `book:updateBlock` |
| `POST /api/pdfs/{id}/ocr` | `book:replaceOcr` |
| `POST /api/pdfs/{id}/cover` | `book:replaceCover` |
| —（新增） | `book:getToc` / `book:replaceToc` / `book:clearToc` |
| `GET`/`PUT /api/users/reading-progress/{id}` | `progress:get` / `progress:save` |

新增：`library:scan`、`library:import`、`library:delete`、`book:save`、`settings:*`、`dialog:pickFiles`、`updates:*`。

**文件上传的根本变化**：没有 HTTP 就没有 `FormData`。渲染层用 `webUtils.getPathForFile` 从 `File` 取出**绝对路径**，主进程自己去读——字节不跨越 IPC 边界，比把 200MB 序列化过桥快得多。

---

## 8. 翻译与语音：外部服务怎么接

LBook 本身离线可用，**翻译与语音朗读是唯一的联网功能**，走腾讯云。设计上只认一条原则：*换一家厂商不该动上层*。

### 8.1 三层，各管一件事

```
renderer  SelectionPopup / SettingsDialog     只认 IPC，不认识任何厂商
   │  translate:text / settings:*
main      translate/service.ts                选厂商、取凭据、查缓存、判语种
   │
          translate/providers/tencent.ts      只回答"怎么调这一家"
   │
          tencent/sign.ts + client.ts         TC3-HMAC-SHA256 与请求封装
```

- **厂商靠自述接入。** `TranslateProvider` 声明自己的 `fields`（含哪些是密钥）、支持的语言和 `translate()`。设置页的输入框是按这份声明渲染的——加一家厂商 = 加一个文件 + 在 `registry.ts` 加一行，UI 一行都不用改。
- **不用官方 SDK。** `tencentcloud-sdk-nodejs` 为两个接口引入几十 MB 生成代码，而本应用是离线安装包。签名算法固定且短，用官方文档的算例钉死在 `tests/unit/tencent/sign.test.ts` 里。

### 8.2 密钥的取舍

密钥**明文**存在 `%APPDATA%\LBook\config.json` 的 `translate.credentials.<provider>` 下，并且会随设置载荷回到渲染层。这是刻意的，也是经过一次修正后的结论：单用户桌面应用没有服务端可以托管密钥，而**用户看不见、复制不出的密钥等于修不了的密钥**。

最初的实现是"只写不读"（设置页只显示一个"已保存"占位），实测下来它只带来了困扰：用户无法核对密钥是否填错，也无法把它复制到别处。

现在的行为与常见工具一致：

1. 设置页的凭据输入框**预填已存的值**，密码框默认显示为点；点小眼睛切换明文，此时可选中复制；
2. 只有 `settings:get` 这一个载荷会带上凭据，划词卡片、翻译/朗读通道都拿不到；
3. 密钥不进日志、不进错误信息；
4. 用**只授翻译与语音合成权限的子账号密钥**，设置页的字段提示里就是这么写的；
5. **清空输入框并保存 = 移除该密钥**（表单预填后，空值只能是"要删掉"）。

语音合成与机器翻译**共用同一对密钥**（同一个腾讯云账号），所以朗读不需要第二次配置。朗读的音频只在主进程内存里缓存（最近 64 条），不落盘：它是可再生的，而缓存文件一旦损坏会让"点喇叭没声音"变成一个难查的问题。

### 8.3 花钱的地方就要记账

- **翻译有磁盘缓存**（`%APPDATA%\LBook\cache\translate-cache.json`），键含"厂商 + 源语言 + 目标语言 + 原文"。同一句划两次只付一次钱。
- **源语言 = 目标语言时不调用**：中文页面上划中文，调一次就是把钱退给腾讯云。
- **`auto` 是本地判的**：腾讯的 `LanguageDetect` 已随 TMT 文本接口一起下线，所以按 CJK 占比本地判断（`detect.ts`），零成本、不会失败。

### 8.4 时间线（会变，做决定前先复核）

| 事项 | 状态 |
|---|---|
| 语音合成 `TextToVoice` | 正常可用；免费资源包需在控制台**领取**（基础/精品音色 800 万字符、3 个月有效、每账号一次），用尽即停服 |
| 机器翻译 `TextTranslate` | **文档已在 2026-07-08 的发布里移除该接口**，但实测仍可调用；官方公告：QPS 自 2026-10-01 起逐月缩减，**2027-10-01 起归零**，免费资源包不再新发 |
| 替代品 | 腾讯"大模型文本翻译"（公告称近期上架，**无免费额度**） |

结论：翻译这一层必须当成"随时会换"的组件来做——这正是 8.1 那三层的目的。换供应商只涉及 `providers/` 下新增一个文件。

---

## 9. 主题（浅色 / 暗色）

调色板只有一处：`src/renderer/index.css` 的 `:root` 与 `.dark` 两段 CSS 变量（shadcn 的做法），组件一律引用语义类（`bg-card`、`text-muted-foreground`…），不写死颜色。

**谁来决定挂哪个类**：两个输入合成——显式的 `light`/`dark` 直接生效；`system` 才去看 `prefers-color-scheme`。而这个媒体查询报的已经是**用户选的那个**主题，因为主进程把它写进了 `nativeTheme.themeSource`（`src/main/theme.ts`）。于是设置还没取回来时（`theme` 暂为 `system`）判断也是对的，**首帧不会闪浅色**；挂类用 `useLayoutEffect`，在首次绘制之前完成。更早的那一帧（JS 还没跑）由窗口自身的 `backgroundColor` 兜底。

三处容易漏掉的地方，都在代码里留了注释：

- **窗口自身的颜色**（`backgroundColor`）不属于 CSS，必须跟着设置重画，否则暗色窗口在首帧与缩放时会闪出一块浅色。它取的必须是 `--background`（浅 `#ffffff` / 暗 `#0a0a0a`），不能取 `--card` 那种次级底色——那会让窗口边缘比内容亮一档。
- **原生控件**（`<select>` 弹出层、滚动条、光标）只认 `color-scheme`，所以 `ThemeProvider` 会同步设置它。
- **滚动条的宽度交给平台，颜色用 `scrollbar-color`。** 这一条是踩过坑才写下的：Windows 11 上 Chromium 用原生方式绘制滚动条，`::-webkit-scrollbar-thumb` 的 `background-color` **完全不生效**（实测：注入 `!important` 的红色规则后渲染仍是系统原生的 `#8B8B8B`），只有它预留的**布局宽度**受 CSS 控制。所以宽度写死 10px 时用户看到的仍是细条——真正要改的是颜色：把 `::-webkit-scrollbar*` 规则全部删掉（只要还剩一条，`scrollbar-color` 就会被忽略），改用标准属性 `scrollbar-width: auto` + `scrollbar-color`，并把它做成 `--scrollbar-thumb` 令牌分主题取值（浅色 `oklch(85%)` ≈ `#CECECE`、暗色 `oklch(36%)` ≈ `#3D3D3D`，都比系统原生淡）。代价：标准属性没有悬停态，原生的悬停高亮没有了。
- **阅读区的取值是从 Obsidian 自己身上读的，不是猜的。** 暗色下 `--foreground` 是 `oklch(0.985)` ≈ `#fafafa`：对按钮、页头、对话框是对的，但正文要连读几十分钟，纯白在夜里刺眼——而这是个阅读器，那块面板夜里几乎就是整个窗口。所以阅读区改用 `--reading-foreground`（暗色 `oklch(0.833)` ≈ `#c8c8c8`，在 `--card` 的 `#171717` 上约 10.7:1；浅色等于 `--foreground`，浅色主题一字未改）。作用点只有 `.markdown-body` 一处，Markdown 视图与块视图（`OcrSidebar`、`BlockCard`）同时生效。**正文刻意比 Obsidian 的 `#dadada` 暗一档**：它的页面底是 `#1C1C1C`，我们的是 `#171717`，同一个字在更黑的底上只会更冲——照抄 `#dadada` 我们就是 12.8:1，比 Obsidian 自己的 11.4:1 还狠。这几个数不是估的：本机 Obsidian 1.14.4 的 `app.css` 可以直接解出来读（`node -e "require('@electron/asar').extractFile('D:/APPS/Obsidian/resources/obsidian.asar','app.css')"`，`@electron/asar` 已在 `node_modules` 里），`--text-normal: #dadada`、`--background-primary: #1C1C1C`、`--color-base-70: #b3b3b3` 都在里面。**改这里的配色前先复核它，不要照着截图调。**
- **阅读区里不放比正文更亮的东西。** Obsidian 的 `--h1-color`…`--h6-color`、`--bold-color`、`--blockquote-color` 全是 `inherit`：标题、加粗、引用都跟正文同色，层级只靠字号、字重和引用那条竖线。所以这里**没有标题令牌**——标题比自己的段落还亮，正是要消掉的那种刺眼；引用块在暗色下也回到正文色（只留 3px 左边框），浅色仍用 `--muted-foreground`，白纸上的灰是有用的。**唯一的例外是链接**：Obsidian 暗色的 `--link-color: var(--text-accent)` 是柔和紫 `#a68af9`（`oklch(0.7058 0.1593 293.51)`，约 6.9:1），要显眼的东西在夜里用色相比用亮度稳。
- **次要文字跟着提到 `#b3b3b3`**（暗色全局 `--muted-foreground`，`oklch(0.767)`；原是 `oklch(0.708)` ≈ `#a1a1a1`，现对齐 Obsidian 的 `--color-base-70`）。这一条**超出了阅读区**：目录、按钮说明、图标会一起亮一档。
- **阅读区字号是用户设置，所以那一套尺寸必须是相对的。** `--reading-font-size`（默认 14px、范围 12–24px，存在 `config.json` 的 `readingFontSize`，**两头都夹**：写入时在 `context.updateSettings`、读文件时在 `config.coerce`）由设置里的 Font 滑块改，值最终落在 `<html>` 的这个自定义属性上（`renderer/lib/readingFont.ts` 是唯一知道变量名的地方）。因此 `.markdown-body` 里**所有字号写成 `em`**：标题若留在 `rem`，正文调到 20px 时 `1.25rem` 的 h1（20px）会与正文一样大甚至更小，层级当场失效——比例就是原来的 rem 值除以 14px，所以默认观感不变。`code`/`pre` 那几档要额外写一条 `pre code { font-size: 1em }` 阻断 `em` 的嵌套相乘。滑块**拖动过程不写盘**：一边拖一边 IPC 会让 `config.json` 在几秒内被原子重写几十次，而且每次回来的载荷都重渲染整个应用；所以拖动只改本地值 + CSS 变量（面板跟着指针动），松手才落盘一次（Base UI 的 `onValueCommitted`）。
- **PDF 页面保持纸白，不反色。** 这是刻意的：书里的表格与图一旦被滤镜反色就不可信，而这是个要拿来对账、看图的阅读器。想要夜里护眼的话，正确的做法是加一个"调暗页面"的开关（半透明蒙层），而不是反色——目前没做。
- **页面周围的"桌面"跟着 `--background` 走**（浅色 `#f8fafc` 是刻意的桌面灰，暗色直接取 `--background` 的纯黑，与页头同色）。
- **面板之间的分隔条不占宽度，只在悬浮/拖动时浮出来。** 原先它是 6px 的真实元素，刷成桌面色（想让把手与桌面连成一片）；这在暗色下看不出来（把手、桌面、工具条都是 `#0a0a0a`），但**浅色下会露馅**：面板是 `--card` 的 `#ffffff`、桌面是 `#f8fafc`，那 6px 就成了两片白之间的灰带，读起来像"本该无缝的地方有一道缝"。教训是：**占住宽度的元素必须被涂成一种颜色，而它两侧邻居不同色时，涂哪个都不对**——所以改成 `layout/PaneSash.tsx`：布局宽度 0（两栏直接相接），一个左右各探进 3px 的透明命中区骑在边界上，默认什么也不画，只有悬浮时画 6px 的 `#0090f1` **实色**带（`absolute` 覆盖层，不动布局一个像素；不用半透明，是因为半透明会吃到底色，同一条令牌在两侧面板上会读成两种颜色，而且实色之后原先那条 2px 实线就没东西可加了——悬浮与拖动因此长一样，VS Code 的 sash 也是这样）。3px 是刻意的小：面板贴边处是它自己的滚动条（约 15px），命中区不能再往里抢。顺带解决的是"断头线"——PDF 工具栏的 `border-b` 现在能直接顶到两侧面板，不必再在把手顶上补一段 `h-12 border-b` 的同高同盒模型元素。

---

## 10. 打包与更新

- `electron-builder` + NSIS（每用户安装、可改安装目录）。
- `asar: true`；`better-sqlite3`、`bindings`、`file-uri-to-path` 必须 `asarUnpack`——`.node` 文件无法从 asar 内 dlopen，而 `bindings` 会直接读文件系统。
- `npmRebuild: true` 针对 Electron ABI 重建原生模块。
- `package.json` 的 `version` 是唯一来源，`electron-updater` 拿它与 GitHub release tag（`vX.Y.Z`）比对。

更新行为：启动 10 秒后静默检查；后台下载；**就绪后不打断用户**，只出非模态提示条，并设 `autoInstallOnAppQuit`，退出时自动安装。所有错误吞掉只记日志——断网绝不能影响启动。

---

## 11. 安全模型

生产环境 CSP：

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self' data:; img-src 'self' data: lbook:; media-src 'self' blob:;
connect-src 'self' lbook:; worker-src 'self'
```

三处刻意为之：

- **`script-src` 不给 `'unsafe-inline'`。** OCR 内容经 `rehype-raw` 与 `dangerouslySetInnerHTML` 渲染（`BlockCard.tsx`）。`<script>` 走 innerHTML 不会执行，但 `<img src=x onerror=…>` 会——禁掉内联脚本正好掐死这条路。
- **`img-src` 不给 `https:`。** 防止恶意 `.lbook` 向外发请求（当前 OCR 图片本就是远程签名 URL，而本轮不处理图片）。
- **`media-src` 给 `blob:`。** 朗读音频由主进程返回字节、在渲染层用 Blob URL 播放；`default-src 'none'` 会把它一起挡掉，而 `<audio>` 只会报一句"找不到可用源"，极难定位。仍然不给 `https:`——音频不可能来自外网。

两个 scheme 都不授予 `bypassCSP`。

---

## 12. 已知限制与权衡

| 限制 | 说明 |
|---|---|
| **迁移丢失三个字段** | 顶层 `preprocessedImages`、每页 `outputImages` / `inputImage` 未入库，无法恢复。当前 UI 不读取。doc #1 可从 `dev-data` 的原始 JSON 补回，其余 4 本无法。 |
| **OCR 图片不显示** | OCR 里的图片是百度云签名 URL（4227 个），本地没有图片文件。本轮不处理，`assets/` 目录格式已预留，`resolveAssetUrls` 已实现并测试。 |
| **`manifest.pageCount` 可能与 PDF 真实页数不符** | 页数在创建时取自 OCR JSON 的条目数。数据库中的 `page_count` 也来自 OCR。若 OCR 漏页，两者会与 PDF 真实页数不一致。 |
| **保存是全量重写** | 保存时重写 `.lbook` 的尾部条目。因为 PDF 是 STORE 且排在首位，PDF 段是逐字节复制而非重新压缩；但整包仍会被完整写出一次（190MB 约 1–3 秒）。 |
| **无并发写保护** | 单用户桌面应用，未做多实例互斥。同时开两个 LBook 实例写同一个库，结果未定义。 |
| **未签名** | NSIS 包未做代码签名，首次安装会触发 SmartScreen 警告。 |
| **云厂商密钥明文存于 `config.json`** | 单用户桌面应用没有服务端可托管密钥，且用户看不见的密钥等于修不了的密钥。缓解：只经 `settings:get` 回传、不进日志、建议用子账号密钥。见第 8.2 节。 |
| **翻译依赖一个已宣布下线的接口** | 腾讯云 `TextTranslate` 已从文档移除，QPS 自 2026-10-01 起逐月缩减、2027-10-01 归零。供应商层就是为此准备的（第 8.1 节），但届时必须真的换一家。 |
| **翻译与朗读需要联网** | 这是全应用唯一的联网功能。离线时划词报网络错误，其余功能不受影响。 |
| **朗读音色暂不可选** | `TextToVoice` 的音色由接口默认值决定。设置页加一个音色下拉是下一步——`provider.fields` 已经能承载它，不需要改结构。 |

---

## 13. 相关文档

- 父级：[README.md](./README.md)
- 同级：[BUILD.md](./BUILD.md)、[TEST.md](./TEST.md)、[AGENTS.md](./AGENTS.md)
- 子目录：[src/main/README.md](./src/main/README.md)、[src/renderer/README.md](./src/renderer/README.md)
