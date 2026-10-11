# LBook

一个 Windows 桌面应用，用来**管理、阅读和校对 PaddleOCR-VL 扫描出来的书籍**。

LBook 本身**不做 OCR**。扫描与识别由外部的 PaddleOCR-VL / PP-StructureV3 完成并产出 JSON，LBook 把这份 JSON 与原始 PDF 组织成一本可读的书：PDF 渲染、OCR 结果叠加、逐块校对、阅读进度记录。

**装上即用**——不依赖 Python、Node 或任何外部服务。

---

## 核心概念：一本书就是一个文件夹

```
经济法基础2024/
├── book.pdf      书本体——文件夹里唯一的“可见”文件
└── .lbook/       应用要的一切都收在这里（与 Obsidian 的 .obsidian 同一套约定）
    ├── meta.json 身份(uid)、标题、页数、ocrFile
    ├── ocr.json  PaddleOCR-VL 原始输出（几 MB 到几十 MB，逐字节原样）
    ├── toc.json 可选：目录树
    └── cover.png 可选：封面
```

**书就是磁盘上一堆属于你的普通文件**：应用只记住路径（书库是一份台账，书可以在任何盘、任何目录）。读的时候它不碰书——要改 OCR 文本或目录，就在你自己的编辑器里改，改完切回应用就看到了。新建、维护、以及把一个现成文件夹加成书时才写盘，而且只写 `.lbook/` 里那些元数据。

**整个应用会写的只有三个文件**，都在 `%APPDATA%\LBook\`：`config.json`（设置）、`library.json`（书库台账）、`progress.json`（读到哪）。唯一会写进书文件夹的是 `meta.json`，而且只在你把“一个还没有 `meta.json` 的文件夹”加成书时创建一次。

---

## 快速开始

```bash
npm install
npm run dev
```

`npm run dev` 一条命令同时起 Vite、监听主进程改动、启动 Electron。渲染层改动热更新，主进程改动自动重启。

打包成安装包：

```bash
npm run pack      # 产出 release/LBook-Setup-<version>.exe
```

遇到问题先看 [BUILD.md](./BUILD.md) 的"常见错误速查"。

---

## 数据放在哪

| 内容 | 位置 |
|---|---|
| 配置 `config.json` | `%APPDATA%\LBook\` |
| 书库台账 `library.json` | `%APPDATA%\LBook\` |
| 阅读进度 `progress.json` | `%APPDATA%\LBook\` |
| 书 | **你自己挑的文件夹**（默认 `文档\LBook Library`，但可以在任何地方） |

台账与书刻意分开：书可以放在移动硬盘或网络盘上，而“哪些文件夹是书”这份列表始终在本地，不会跟着一起失联。想让应用认识一本书，就把它的文件夹加进来（Add book）；应用不会去扫描任何目录。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Electron 44（`contextIsolation` + `sandbox`，无 Node 集成） |
| 主进程 | TypeScript，esbuild 打包为 CJS |
| 渲染层 | React 19 + Vite 8 + Tailwind v4，经 `app://` 自定义协议加载 |
| PDF | pdf.js 4.10，通过 IPC 的 `PDFDataRangeTransport` 按需取字节 |
| 索引 | 无数据库：书库台账、阅读进度、配置都是 JSON（`%APPDATA%\LBook\`） |
| 书的格式 | 一个文件夹 + PaddleOCR 自己的 JSON；应用对内容只读，OCR 按**字节偏移**按页读取 |
| 测试 | Vitest，纯 Node 环境，不启动 Electron |
| 更新 | electron-updater + GitHub Releases |

---

## 文档

| 文档 | 内容 |
|---|---|
| [DESIGN.md](./DESIGN.md) | 架构、`.lbook` 格式规范、IPC 契约、安全模型、**已知限制** |
| [BUILD.md](./BUILD.md) | 开发、构建、发布、原生模块排错、常见错误速查 |
| [TEST.md](./TEST.md) | 测试范围、黄金回归用例、手工冒烟清单 |
| [PLAN.md](./PLAN.md) | **下一步怎么走**：文件夹式书库落地之后还剩什么（外部改动反应式重读、坏书 UI、旧 `.lbook` 迁移） |
| [AGENTS.md](./AGENTS.md) | 协约：目录 README 规则与文档索引规则 |

源码各目录的说明见其自身的 `README.md`，从下面两个入口进入：

- [src/main/README.md](./src/main/README.md) —— 主进程
- [src/renderer/README.md](./src/renderer/README.md) —— 渲染层

施工中的计划、决策台账与实测记录在 [.agents/plan/README.md](./.agents/plan/README.md)（代理工作区，不是产品文档）。

---

## 两个值得知道的设计决定

**PDF 不走自定义协议。** 直觉上 `lbook://pdf/…` 配 HTTP Range 最自然，但 pdf.js 只对 `http(s)` 发范围请求（`pdf.mjs` 里的 `isHttp = /^https?:/i.test(source.url)`），对自定义 scheme 会退化成把整个文件读进内存——最大的一本书有 189MB。所以 PDF 走 IPC。

**一页的 OCR 是按字节偏移从那个大 JSON 里直接读出来的**，而不是整套 `JSON.parse`：15.6MB 的文件整份解析要 36ms 且常驻内存涨 46MB，按偏移读一页只要 0.1–0.3ms，内存与文件大小无关。

两处的完整依据见 [DESIGN.md](./DESIGN.md)。
