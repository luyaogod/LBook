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
| `check-inspect.ts` | 把一本真书的 `ocr.json` 拷到临时区并**故意弄坏两处**（页与页之间少一个逗号、某一页内部少一个花括号），验证校验器能报出来：损坏页的**字节偏移**、页码移位警告、而且第 1 页仍能读。只动副本，不碰你的库 |
| `tencent-probe.ts` | 腾讯云连通性探针：用真实密钥各打一次语音合成与机器翻译，原样打印 RequestId 与错误码 |
| `migrate-folders.ts` | **一次性迁移**：旧 `.lbook` 包 → 书文件夹 + 台账条目 + 进度条目，幂等、失败隔离、可 `--dry-run` |

`migrate-folders.ts` **默认是 dry run**，只有加 `--apply` 才写盘；它读旧包（只读）、写书文件夹与台账，并在最后把旧库里的阅读进度搬过来。

已删掉的四个脚本（`apply-toc.ts`、`migrate-legacy.ts`、`seed-library.ts`、`verify-package.ts`）都围绕"写 `.lbook` 包"与"扫描库目录"，而应用既不再写包、也不再扫目录：目录就是书文件夹里的 `toc.json`（拿编辑器改），造测试数据用 `tests/helpers/bookFolder.ts`。

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
