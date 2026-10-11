# BUILD.md —— 开发、构建与发布

## 1. 环境要求

| 项 | 版本 | 说明 |
|---|---|---|
| Windows | 10 / 11 x64 | 仅支持 Windows |
| Node.js | ≥ 22（开发用 24） | 自带 npm |
| Python / Visual Studio | **不需要** | 见第 5 节 |
| 磁盘 | ≥ 2 GB | `node_modules` 含 Electron 二进制约 250MB |

项目**不需要** Python 或 C++ 编译工具链，也不含任何原生模块：装机包里只有 JS（索引曾经是 better-sqlite3，如今是三份 JSON）。读旧 `.lbook` 包的那个一次性迁移脚本也已经删掉了。

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

`npm install` 输出里的 `allow-scripts … not yet covered by allowScripts` 警告是同一件事的提示（现在是 `esbuild` 的 postinstall）。仓库里已经没有任何需要编译的包。

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

## 5. 原生模块：已经没有要排错的东西了

应用不再链接任何原生模块。索引曾经是 `better-sqlite3`（需要 `asarUnpack` + `npmRebuild` 两件套才能从包里 dlopen），如今书库台账、阅读进度、配置都是普通 JSON，因此 `electron-builder.yml` 里那两项已经删掉；读旧包的一次性迁移脚本也删掉了，连 `devDependencies` 里的 `better-sqlite3` / `yauzl` 一起。

`npm ls better-sqlite3 yauzl yazl` 应当是空的。要再跑一次迁移（例如从备份恢复），按 `scripts/README.md` 里那三行从 git 历史里取回代码与依赖。

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

### 手工发布（备用路径，0.0.1 实测走通）

`npm run release` 的**发布阶段**在网络不稳时不可靠（见第 9 节）。Release 里**必须同时有三个文件**，缺任何一个都等于没发布：

| 文件 | 缺了会怎样 |
|---|---|
| `LBook-Setup-<version>.exe` | 能查到新版本，下载 404 |
| `LBook-Setup-<version>.exe.blockmap` | 增量下载退化为全量下载（还能用，白费带宽） |
| `latest.yml` | 更新检查直接 404，表现为"永远是最新版" |

```bash
# 1. 先生成 latest.yml。它在「打包」阶段写出——publish 失败时不会留下，
#    所以这一步只打包、不发布。--prepackaged 复用已有的 win-unpacked。
npx electron-builder --win --publish never --prepackaged release/win-unpacked \
  --config.electronDist=node_modules/electron/dist

# 2. 大小文件分开传：小文件用 gh，122MB 的 exe 用 curl。
#    gh 在窄代理下会长时间没有字节流动，被 GitHub 按「不活跃」408 掐断；
#    curl 流式推送实测 598 KB/s、204 秒完成（同一条代理，gh 则直接挂死）。
export GH_TOKEN=$(gh auth token)
RID=$(gh api repos/luyaogod/LBook/releases --jq '.[0].id')   # 或先 gh release create
gh release upload v0.0.1 release/latest.yml release/LBook-Setup-0.0.1.exe.blockmap --clobber
curl -sS --http1.1 -X POST -H "Authorization: Bearer $GH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @release/LBook-Setup-0.0.1.exe -x http://127.0.0.1:10808 \
  "https://uploads.github.com/repos/luyaogod/LBook/releases/$RID/assets?name=LBook-Setup-0.0.1.exe"

# 3. 验收：三个文件都在，且 latest.yml 的 sha512/size 与 exe 对得上
gh api repos/luyaogod/LBook/releases --jq '.[] | [.assets[] | "\(.name) \(.state) \(.size)"][]'
node -e "const f=require('fs'),c=require('crypto');const b=f.readFileSync('release/LBook-Setup-0.0.1.exe');console.log(c.createHash('sha512').update(b).digest('base64'),b.length)"
```

**上传中的资产不会出现在 API 里**，要等传完才可见——别拿"资产列表为空"当失败判据。

### 手工安装与装后必查

NSIS 是**每用户安装**，静默装到指定目录：

```bash
# /D 必须是最后一个参数、不加引号；MSYS2_ARG_CONV_EXCL 是关键，见第 9 节
MSYS2_ARG_CONV_EXCL='*' ./release/LBook-Setup-0.0.1.exe /S '/D=D:\APPS\LBook'
```

装完三件事都要核，缺一件就可能装了个永远不会更新的版本：

```bash
cat "D:\APPS\LBook\resources\app-update.yml"   # 应是真实 owner/repo，不是 YOUR_GITHUB_USER
powershell "(Get-Item 'D:\APPS\LBook\LBook.exe').VersionInfo.FileVersion"   # 应是新版本号
ls "$LOCALAPPDATA/Programs/LBook"               # 不该存在；存在即 /D= 没生效，装出了第二份
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
| 列表里某本书显示“需要修复” | 文件夹被移走/改名，或 `meta.json`/`ocr.json` 被删 | 鼠标悬停在徒标上看原因；把文件夹放回原处，或“从书库移除”（**不会删文件**） |
| 打开书报 `Bad end offset: N` | `requestDataRange` 的 `end` 语义搞错 | pdf.js 的 `end` 是**排他**的、IPC 的 `readPdfRange` 是**闭区间**，转换在 `usePdfDocumentProxy.ts` 里，别改动它 |
| 打开书报 `Invalid PDF structure` | 传给 range transport 的 `length` 不对 | 必须是 `book.pdf` 的精确字节数，即 `PdfDocument.file_size` |
| 翻到某一页显示“该页没有 OCR 文本” | OCR 数组比 `meta.json` 的 `pageCount` 短（OCR 漏页） | 看一眼控制台里那行 `[library] page N of …`；页数校验与坏书 UI 是 Phase 2 的事 |
| 更新检查 404 | Release 里缺 `latest.yml` | 用 `npm run release` 上传，不要手工只传 `.exe` |
| 打包后 exe 还是 Electron 默认图标 | `resources/icon.ico` 缺失或不是 256×256 起 | 按第 7 节重新生成 |
| `npm run pack` 报 `read ECONNRESET` / `connect ETIMEDOUT` 且卡在 `packaging` | electron-builder 每次打包都要从 GitHub 取 Electron 压缩包，网络被重置 | 用本地已有的那份，完全不联网：`npx electron-builder --win --publish never --config.electronDist=node_modules/electron/dist` |
| `npm run release` 在 `publishing` 阶段长时间无输出，最后 `HTTP 408: Upload body timed out due to inactivity` | `gh` 上传 122MB 资产走窄代理时会长时间没有字节流动，GitHub 的上传端点按"不活跃"掐断连接 | 大资产改用 `curl --data-binary @…` 直传（第 6 节手工发布），实测 598 KB/s、204 秒完成 |
| 发布报 `422 Unprocessable Entity`，`code: already_exists` / `field: tag_name`，日志里有两行 `creating GitHub release` | electron-builder 并发发起了两次 release 创建，且它先判定"release 不存在"再撞上已存在 | 删掉残缺 release 重发：`gh release delete v<version> --yes`（tag 会保留）；或直接走第 6 节的手工发布 |
| 发布失败后 `latest.yml` 不见了，或内容还是上一版 | `latest.yml` 在**打包阶段**写出，publish 挂掉时它还没生成 | 重跑打包再手工上传：`npx electron-builder --win --publish never --prepackaged release/win-unpacked --config.electronDist=node_modules/electron/dist` |
| Git Bash 里跑安装包，`/S` 静默失效、弹出图形界面一直等点击 | MSYS 参数转换把 `/S` 当路径改写成了 `C:/Program Files/Git/S` | 前面加 `MSYS2_ARG_CONV_EXCL='*'`；`/D=` 也一并写单引号：`MSYS2_ARG_CONV_EXCL='*' ./LBook-Setup-x.y.z.exe /S '/D=D:\APPS\LBook'` |
| 装完了版本没变，或更新检查永远说"已是最新版" | `resources/app-update.yml` 是**打包时**写进安装包的，占位符会让该版本的更新器永久失效 | 改 `electron-builder.yml` 的 `publish.owner` 后**重新打包并手工重装一次**；按第 6 节的"装后必查"核对 |

---

## 10. 相关文档

- 父级：[README.md](./README.md)
- 同级：[DESIGN.md](./DESIGN.md)、[TEST.md](./TEST.md)、[AGENTS.md](./AGENTS.md)
- 子目录：[scripts/README.md](./scripts/README.md)
