# scripts

## 这个目录做什么

构建与维护脚本。不参与运行时，只在开发、迁移、发布时手工执行。

## 关键文件

| 文件 | 说明 |
|---|---|
| `build.mjs` | esbuild 构建 main 与 preload（CJS），支持 `--watch` |
| `dev.mjs` | 开发启动器：Vite + esbuild watch + Electron，主进程改动后自动重启 |
| `run.mjs` | 执行下面那些 TypeScript 脚本：先 esbuild 打包再用 Node 跑 |
| `perf-probe.ts` | 性能探针：量文件夹式书库的读路径（单个大 OCR JSON + 字节偏移索引 + 内存三进程对照），并**自检**索引与 V8 的解析结果是否逐页一致。见 `PLAN.md` 第 4.2 节 |
| `edit-probe.ts` | 量一次**内容修正**的代价：在真书上定位一个 `block_content` 的字节区间、拼接替换、原子写回，并核对**前后字节逐字节不变**。设计编辑功能的依据（最慢那本 7.9MB / 665 页：合计 7.5ms） |
| `check-edit.ts` | 在**真书**上端到端验证内容修正：拷一本到临时区（只读原书）→ 用真的 `writeField` 改一个块与这一页的 Markdown → 断言字段读回、**坐标未动**、解析后**只有那一个字段不同**、页数不变、665 页仍全部可解析、按旧文本发起的写入被拒。单测用夹具，这个用 PaddleOCR 真正产出的那几 MB |
| `check-i18n.mjs` |
| `check-launch.mjs` | 装完之后**它到底能不能开**：启动 `D:\APPS\LBook\LBook.exe`，等主进程自己打的 `[main] renderer loaded from app://bundle`（`did-finish-load` 才打这行），失败则按 `renderer failed to load` 判定，然后 `taskkill /T` 杀掉整棵树。**不要再用"进程还活着"当启动成功的证据**——窗口起不来的版本，进程照样活着（2026-10-11 就用这个弱检查发出去过一个打不开的构建）；也别只杀父进程，Windows 上渲染/GPU/工具进程会留下来 |
| `check-editor.ts` |
 在**真实 Electron**（`app://` + 生产 CSP，用的是应用同一份 `src/main/bundleHost.ts`）里验证源码编辑器（CodeMirror 6）：装得上、样式生效、行号在、**语言支持确实走懒块且到了**、值能读回、HTML 语言也能载入；同时收集 `securitypolicyviolation` 与 `console.error`，两者非空即失败。**十四项**断言里有五件是容易"看着对、其实不对"的：查找面板开着时 `Esc` 应当关面板而不是关编辑器（第一次 `Esc` 关面板且 `onCancel` 未被调用，第二次才关编辑器）；**编辑器填满它的容器**（容器 240px，编辑器就得是 240px——用 `max-height` 会得到一个矮编辑器加下面一片空白，正是用户截图里抱怨的样子）；以及**滚动条归编辑器**（200px 的盒子里放 200 行长文：编辑器内部 3140px 内容、自己滚，外面那个盒子的内容高度仍是 200px——外层一旦也滚，就是两条滚动条管一个文档）。这条检查里的盒子结构**照着 `SourceEditorField` 摆**（wrapper 是 flex column、编辑器盒 `flex-1`）：早先它把编辑器直接挂进一个定高 div，于是**应用完全滚不动时它照样通过**——那次是 `flex-1` 落在了普通块上。
以及**滚动条真的画出来了**（`scrollbar-width: thin` 生效——Windows 的覆盖式滚动条不滚就不画，"能滚"于是看起来像"不能滚"）。它验的是"打包后还能用"
——开发环境里好用的编辑器，在生产 CSP 下可能只是一只空盒子。`npm run check:editor` |
| `check-locate.ts` | 在**真台账**上验证"定位"：拷一份 `library.json` 与一本书的 `.lbook/`（meta + ocr）到临时目录，然后 ①**半拷的文件夹必须被拒**（并点名缺哪个文件）且**台账一字未动**——这条是本轮真机验证抓到的 bug（原来先改台账后读文件夹）；②完整文件夹定位成功：只改那一行的路径、书数不变、无重复行、能从新位置读回页；③**真的 `library.json` 一个字节都没动**。做这个检查是因为 `library.json` 是应用唯一的自有状态，改坏了就是丢书库 |
| `patch-text.mjs` |
 给文档打补丁的工具（`node scripts/patch-text.mjs <job-file>`）：补丁内容放在纯文本 job 文件里，**不需要任何转义**——中文文档里同时有 ASCII 引号与反引号（代码片段），写在 JS 字符串里总要转义其中一个，"忘一个引号"的代价是语法错误或把文档改坏（这个工具就是被这个坑逼出来的）。**每个文件要么全改要么不改**，锚点对不上就报出是哪个并无事退出（半应用的文档比没应用更糟）；`@=FILE=` / `@=OLD=` / `@=NEW=` 三个标记必须独占一行 |
| `check-i18n.mjs` |
 守门：扫渲染层的 JSX 文本（**只扫 `.tsx`**——`.ts` 里没有 JSX，那个模式会把 `=> Promise<T>` 读成文案）与可见属性（`title`/`placeholder`/`aria-label`/`alt`），**有任何一条没走 `t()` 就失败**。品牌名与 `console.*` 诊断在白名单里。这次的全面覆盖就是靠它锁住的 |
| `check-inspect.ts` | 把一本真书的 `ocr.json` 拷到临时区并**故意弄坏两处**（页与页之间少一个逗号、某一页内部少一个花括号），验证校验器能报出来：损坏页的**字节偏移**、页码移位警告、而且第 1 页仍能读。只动副本，不碰你的库 |
| `tencent-probe.ts` | 腾讯云连通性探针：用真实密钥各打一次语音合成与机器翻译，原样打印 RequestId 与错误码 |

已删掉的脚本：`apply-toc.ts`、`migrate-legacy.ts`、`seed-library.ts`、`verify-package.ts` 都围绕"写 `.lbook` 包"与"扫描库目录"，而应用既不再写包、也不再扫目录（目录就是书文件夹里的 `toc.json`，拿编辑器改；造测试数据用 `tests/helpers/bookFolder.ts`）。

**`migrate-folders.ts`（一次性迁移）也删掉了**：它的活儿在 2026-10-11 干完了——5 本真书各自变成一个书文件夹，逐本复核 61 项、原包原封不动、重跑幂等。如今应用与仓库都不再认识旧格式，`better-sqlite3`/`yauzl` 也随之从 `devDependencies` 里消失。真要再迁一次（比如从旧备份里恢复），代码在 git 历史里：

```bash
git checkout d35a9e6 -- src/main/migrate scripts/migrate-folders.ts tests/helpers/lbookPackage.ts
npm i better-sqlite3 yauzl @types/better-sqlite3 @types/yauzl -D
npm run migrate:folders -- --root <旧库目录>        # 加 --apply 才写
```

## 对外接口

`build.mjs` 导出 `buildAll({ watch, onRebuild })` 供 `dev.mjs` 复用。其余为可执行脚本。

## 依赖方向

被 `package.json` 的 scripts 调用。它们引用 `src/main/lbook/`、`src/main/library/`、`src/main/migrate/`、`src/main/tencent/`，因此**这些模块必须保持不依赖 `electron`**，否则脚本跑不起来。

`tencent-probe.ts` 是个例外：它**会联网**，且需要真实密钥（见文件头的三种提供方式）。它是唯一会发起外部请求的脚本，其余脚本只碰本地文件。

`perf-probe.ts` 默认从 `%APPDATA%\LBook\library.json` 台账里按 `ocr.json` 大小挑一本真书来量，也可以用 `--dir <书文件夹>` 指定一本、或 `--ocr <文件>` 直接量一个裸的 OCR JSON（会在 `%TEMP%\lbook-perf` 里给它造一个最小书文件夹）。它**只读**，`--keep` 保留临时区，否则跑完自删。

`migrate-folders.ts` 是唯一读旧格式的脚本：它以 readonly 打开 `%APPDATA%\LBook\lbook.db`（只为搬运阅读进度），并读库目录里的 `*.lbook`；**原始包一个字节都不动**。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../BUILD.md](../BUILD.md)、[`../.agents/plan/01-phase1-folder-read.md`](../.agents/plan/01-phase1-folder-read.md)（T8）
