# BUILD.md —— 开发、构建与发布

## 1. 环境要求

| 项 | 版本 | 说明 |
|---|---|---|
| Windows | 10 / 11 x64 | 仅支持 Windows |
| Node.js | ≥ 22（开发用 24） | 自带 npm |
| Python / Visual Studio | **不需要** | 见第 5 节 |
| 磁盘 | ≥ 2 GB | `node_modules` 含 Electron 二进制约 250MB |

项目**不需要** Python 或 C++ 编译工具链——`better-sqlite3` 自带 N-API 预编译二进制，Node 与 Electron 通用。

---

## 2. 安装依赖

```bash
npm install
```

**如果 `npm install` 之后 Electron 启动不了**，多半是 npm 的安装脚本门禁拦住了二进制下载：

```bash
npx electron --version      # 报错或卡住即为此问题
ls node_modules/electron/dist/electron.exe   # 不存在即为此问题
```

确认后手工执行下载脚本（国内网络建议走镜像）：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
```

`npm install` 输出里的 `allow-scripts … not yet covered by allowScripts` 警告是同一件事的提示。`better-sqlite3` 也在这个列表里，但它**不需要**编译——包内 `prebuilds/win32-x64.node` 就是可直接加载的 N-API 二进制。

---

## 3. 开发模式

```bash
npm run dev
```

一条命令同时做三件事：

- 起 Vite dev server（:5173）
- esbuild 监听 `src/main` 与 `src/preload`，改动后**自动重启 Electron**
- 启动 Electron，加载 dev server

渲染层改动由 Vite 热更新，不需要重启。关掉窗口即整体退出。

只要渲染层时：

```bash
npm run dev:renderer
```

### 为什么不用 electron-vite

`electron-vite@5` 的 peer 是 `vite: ^5||^6||^7`，而本项目用的 `@vitejs/plugin-react@6` peer 是 `vite: ^8.0.0`，互斥，npm 会直接 `ERESOLVE` 失败。所以：**Vite 8 单独构建渲染层，esbuild 构建 main/preload**。不要用 `--legacy-peer-deps` 硬扛。

---

## 4. 生产构建

```bash
npm run build      # main + preload + renderer -> out/
npm run pack       # 再跑 electron-builder，产出 release/LBook-Setup-<version>.exe
```

其他：

```bash
npm run typecheck  # 三个 project 全量类型检查
npm run start      # 不打包，直接以生产模式跑（开发调试 app:// 路径）
```

`out/` 结构：

```
out/main/index.cjs       主进程（CJS）
out/preload/index.cjs    预加载（CJS，sandbox 要求）
out/renderer/            渲染层静态资源，经 app://bundle 提供
```

---

## 5. better-sqlite3 排错

这是打包环节最容易出问题的地方。四件事缺一不可，`electron-builder.yml` 里都已配好：

| 配置 | 作用 |
|---|---|
| 放在 `dependencies`（不是 `devDependencies`） | electron-builder 只打包生产依赖 |
| esbuild `external` | 原生模块绝不能被打包进 bundle |
| `npmRebuild: true` | 针对 Electron 的 ABI 重建 |
| `asarUnpack` 含 `bindings`、`file-uri-to-path` | `.node` 无法从 asar 内 dlopen |

**连续两次打包之间要清缓存**，否则可能出现 `prebuilds/` 被清掉后找不到二进制的情况：

```bash
rm -rf node_modules/.cache release
```

**逃生舱**：Electron 44 内置 Node ≥ 22，`node:sqlite` 是内置模块且 API 几乎一致（同样同步）。若 `better-sqlite3` 在某个 Electron 版本上彻底打不通，换它是可行的，代价是重写 `src/main/db/open.ts` 与仓储层的少量类型。

---

## 6. 版本号与发布

**`package.json` 的 `version` 是唯一来源。** electron-builder 把它写进 `app-update.yml` 与 NSIS 元数据；`electron-updater` 拿它与 GitHub release tag 比对。当前为 `0.0.1`。

### 发布目标

`electron-builder.yml` 的 `publish` 段已指向真实仓库，不需要再改：

```yaml
publish:
  provider: github
  owner: luyaogod
  repo: LBook
  releaseType: release
```

**版本号只能往前走。** `electron-updater` 按语义化版本比对，一旦某个版本被装到用户机器上，之后再发更小的版本号（例如把 `1.0.0` 退回 `0.0.1`）**永远不会触发更新**——它只认"比我新"。所以发布 0.0.1 之后不要再发 1.x 以下的倒退号，否则已装 1.0.0 的机器只能手工重装。

### 发布流程

```bash
# 1. 升版本号（package.json 的 version）
# 2. 提交并打 tag，tag 必须与版本号一致，前缀 v
npm version 0.1.0 --no-git-tag-version
git commit -am "chore: release 0.1.0"
git tag v0.1.0
git push origin main --tags

# 3. 构建并上传到 GitHub Release
export GH_TOKEN=<你的 GitHub token>
npm run release
```

`npm run release` 会构建、打包并把 `.exe`、`latest.yml`、`.blockmap` 上传到对应 tag 的 Release。用户端下次启动后 10 秒即会检查到。

**本机自用的更新是个例外。** 已经装好的旧版本，其 `resources/app-update.yml` 是**打包时**写死的——如果那一版指向了错误或占位的仓库，它永远找不到后续更新，只能手工跑一次新的安装包；手工装上去之后，自动更新才会接上。`D:\APPS\LBook` 里那个早期版本就是这个情况。

**国内网络**：`npm run release` 要从 GitHub 取 Electron 包并上传 120MB 的产物，容易 `ECONNRESET`。给 Git 和 electron-builder 都指上本地代理即可（本机常见的是 10808）：

```bash
git -c http.proxy=http://127.0.0.1:10808 push origin main --tags
HTTPS_PROXY=http://127.0.0.1:10808 npm run release
```

---

## 7. 应用图标

`resources/icon.ico`（7 个尺寸：16/24/32/48/64/128/256，32 位 DIB 条目）由 `resources/icon.svg` 生成，`electron-builder` 通过 `directories.buildResources: resources` 自动取用——它会被 stamp 进 `LBook.exe`，安装包、桌面与开始菜单快捷方式、任务栏、Alt-Tab 全都跟着它走。窗口没有系统标题栏，所以界面上不会再出现第二个图标。

`icon.svg` 里是应用顶栏同款的 lucide `book-open` 字形：黑字、白底圆角方块（和 DeepSeek Harness 的图标一个路子）。要改图标就改这个 SVG，再按下面的步骤重生成 `.ico`——**不要**直接手改 `.ico`。

```bash
# 1. 起一个能连 DevTools 的实例（矢量光栅化借的就是 Chromium）
npm run build:main
LBOOK_USE_BUNDLE=1 npx electron . --remote-debugging-port=9260

# 2. 把 SVG 光栅化成各尺寸 PNG（透明底，脚本见会话产物；核心是用
#    Emulation.setDefaultBackgroundColorOverride 拿透明背景，
#    再用 Page.captureScreenshot 按 clip 截每一档尺寸）

# 3. PNG -> ICO：写成经典 32 位 DIB 条目（BITMAPINFOHEADER + BGRA + AND 掩码），
#    因为给 exe 盖章的工具只认这种老格式

# 4. 重新打包，图标才会进 exe
npm run pack
```

**验收**：`[System.Drawing.Icon]::ExtractAssociatedIcon("release\win-unpacked\LBook.exe")` 取出来的图标应该是这本书，而不是 Electron 默认图标。

---

## 8. 产物与安装包说明

`release/` 下会有：

- `LBook-Setup-<version>.exe` —— NSIS 安装包
- `LBook-Setup-<version>.exe.blockmap` —— 增量更新差分
- `latest.yml` —— 更新清单，**必须与安装包一起上传**，否则更新检查会 404

NSIS 配置为**每用户安装**（不需要管理员）、**可修改安装目录**、创建桌面与开始菜单快捷方式。

**SmartScreen**：安装包未做代码签名，首次运行会弹出"Windows 已保护你的电脑"。点"更多信息 → 仍要运行"即可。要去掉这个警告需要购买代码签名证书，属于后续可选项。

---

## 9. 常见错误速查

| 现象 | 原因 | 处理 |
|---|---|---|
| `npm run dev` 报 `Port 5173 is already in use` | 上次的 Vite 进程没退干净 | `netstat -ano \| findstr :5173` 找到 PID 后 `taskkill /F /PID <pid>` |
| Electron 窗口打不开、`npx electron --version` 卡住 | 二进制没下载 | 见第 2 节的镜像命令 |
| `Cannot find module 'better-sqlite3'` | 打包时被 esbuild 打进去了 | 确认它在 `scripts/build.mjs` 的 `external` 列表里 |
| 打包后启动报 `.node` 加载失败 | asar 未解包 | 确认 `electron-builder.yml` 的 `asarUnpack` |
| 保存书本报 `EPERM: operation not permitted, rename` | 有文件句柄未释放 | 检查是否所有 `closeBook` / `archive.close()` 都被 `await` 了 |
| 打开书本报 `Bad end offset: N` | `requestDataRange` 的 `end` 语义搞错 | `end` 是**排他**的，见 `usePdfDocumentProxy.ts` 注释 |
| 打开书本报 `Invalid PDF structure` | 传给 range transport 的 `length` 不对 | 必须是 `book.pdf` 的 `uncompressedSize`，即 `PdfDocument.file_size` |
| 更新检查 404 | Release 里缺 `latest.yml` | 用 `npm run release` 上传，不要手工只传 `.exe` |
| 打包后 exe 还是 Electron 默认图标 | `resources/icon.ico` 缺失或不是 256×256 起 | 按第 7 节重新生成 |
| `npm run pack` 报 `read ECONNRESET` / `connect ETIMEDOUT` 且卡在 `packaging` | electron-builder 每次打包都要从 GitHub 取 Electron 压缩包，网络被重置 | 用本地已有的那份，完全不联网：`npx electron-builder --win --publish never --config.electronDist=node_modules/electron/dist` |

---

## 10. 相关文档

- 父级：[README.md](./README.md)
- 同级：[DESIGN.md](./DESIGN.md)、[TEST.md](./TEST.md)、[AGENTS.md](./AGENTS.md)
- 子目录：[scripts/README.md](./scripts/README.md)
