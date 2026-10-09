# scripts

## 这个目录做什么

构建与维护脚本。不参与运行时，只在开发、迁移、发布时手工执行。

## 关键文件

| 文件 | 说明 |
|---|---|
| `build.mjs` | esbuild 构建 main 与 preload（CJS），支持 `--watch` |
| `dev.mjs` | 开发启动器：Vite + esbuild watch + Electron，主进程改动后自动重启 |
| `run.mjs` | 执行下面那些 TypeScript 脚本：先 esbuild 打包再用 Node 跑 |
| `migrate-legacy.ts` | **一次性迁移**：旧 `backend/lbook.db` + uploads → `.lbook` 包，并灌入新库 |
| `seed-library.ts` | 开发用：把一对 PDF + OCR JSON 打包进库目录，方便起手 |
| `apply-toc.ts` | 把一份 `toc.json` 写进（或从）`.lbook` 里移除，用于批量预备书库 |
| `tencent-probe.ts` | 腾讯云连通性探针：用真实密钥各打一次语音合成与机器翻译，原样打印 RequestId 与错误码 |
| `verify-package.ts` | 校验一个 `.lbook`，并比对其 PDF 字节与原始文件是否逐字节相同 |

## 对外接口

`build.mjs` 导出 `buildAll({ watch, onRebuild })` 供 `dev.mjs` 复用。其余为可执行脚本。

## 依赖方向

被 `package.json` 的 scripts 调用。它们引用 `src/main/lbook/`、`src/main/library/`、`src/main/db/`、`src/main/tencent/`，因此**这些模块必须保持不依赖 `electron`**，否则脚本跑不起来。

`tencent-probe.ts` 是个例外：它**会联网**，且需要真实密钥（见文件头的三种提供方式）。它是唯一会发起外部请求的脚本，其余脚本只碰本地文件。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../BUILD.md](../BUILD.md)
