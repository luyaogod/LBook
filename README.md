# LBook

一个 Windows 桌面应用，用来**管理、阅读和校对 PaddleOCR-VL 扫描出来的书籍**。

LBook 本身**不做 OCR**。扫描与识别由外部的 PaddleOCR-VL / PP-StructureV3 完成并产出 JSON，LBook 把这份 JSON 与原始 PDF 组织成一本可读的书：PDF 渲染、OCR 结果叠加、逐块校对、阅读进度记录。

**装上即用**——不依赖 Python、Node 或任何外部服务。

---

## 核心概念：`.lbook`

一本书就是一个 `.lbook` 文件。**它本质是一个 ZIP，从不解压**：

```
Book.lbook
├── manifest.json    格式版本 / uid / 标题 / 作者 / 页数 / 封面引用
├── book.pdf         书本体（必须 STORE 存储，可随机寻址）
├── ocr.json         PaddleOCR-VL 原始输出
├── cover.jpg        封面（可选）
└── assets/          OCR 引用的图片（格式预留）
```

文件本身**就是文档**，编辑后写回文件——和 Excel 处理 `.xlsx` 是同一个模型：运行时改动先落在工作副本里，显式保存（`Ctrl+S`）时才重写包。

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
| 索引 `lbook.db` | `%APPDATA%\LBook\` |
| 书本 `*.lbook` | 用户可配置的库目录，默认 `文档\LBook Library` |

数据库与书本刻意分开：库目录可以放在移动硬盘或网络盘上，而索引必须始终在本地，不能跟着一起失联。把 `.lbook` 文件手工拷进库目录，应用下次扫描就会自动发现。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Electron 44（`contextIsolation` + `sandbox`，无 Node 集成） |
| 主进程 | TypeScript，esbuild 打包为 CJS |
| 渲染层 | React 19 + Vite 8 + Tailwind v4，经 `app://` 自定义协议加载 |
| PDF | pdf.js 4.10，通过 IPC 的 `PDFDataRangeTransport` 按需取字节 |
| 数据库 | better-sqlite3（N-API 预编译二进制，无需 C++ 工具链） |
| 包格式 | 自研 `.lbook`（ZIP），读写分别用 `yauzl` / `yazl` |
| 测试 | Vitest，纯 Node 环境，不启动 Electron |
| 更新 | electron-updater + GitHub Releases |

---

## 文档

| 文档 | 内容 |
|---|---|
| [DESIGN.md](./DESIGN.md) | 架构、`.lbook` 格式规范、IPC 契约、安全模型、**已知限制** |
| [BUILD.md](./BUILD.md) | 开发、构建、发布、原生模块排错、常见错误速查 |
| [TEST.md](./TEST.md) | 测试范围、黄金回归用例、手工冒烟清单 |
| [PLAN.md](./PLAN.md) | **下一步怎么走**：从单文件 `.lbook` 改成 Obsidian 式文件夹书库的重构计划 |
| [AGENTS.md](./AGENTS.md) | 协约：目录 README 规则与文档索引规则 |

源码各目录的说明见其自身的 `README.md`，从下面两个入口进入：

- [src/main/README.md](./src/main/README.md) —— 主进程
- [src/renderer/README.md](./src/renderer/README.md) —— 渲染层

---

## 两个值得知道的设计决定

**PDF 不走自定义协议。** 直觉上 `lbook://pdf/…` 配 HTTP Range 最自然，但 pdf.js 只对 `http(s)` 发范围请求（`pdf.mjs` 里的 `isHttp = /^https?:/i.test(source.url)`），对自定义 scheme 会退化成把整个文件读进内存——最大的一本书有 189MB。所以 PDF 走 IPC。

**`.lbook` 里的 `book.pdf` 必须是 STORE（不压缩）。** 压缩条目的字节范围无法寻址，每读一块都要从字节 0 重新解压，读完整本书是 O(n²)。

两处的完整依据见 [DESIGN.md](./DESIGN.md)。
