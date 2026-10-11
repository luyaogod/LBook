# tests/unit/scripts

## 这个目录做什么

测**仓库自己的脚本**（`scripts/`），不是测应用。它们和主进程代码一样是纯 Node，所以放在同一条测试通道里。

它**不**测需要真实 Electron 的东西（那要另行起进程，见 `TEST.md` 第 7 节），也不测 `scripts/run.mjs` 这类只做打包转发的胶水。

## 关键文件

| 文件 | 说明 |
|---|---|
| `patchText.test.ts` | 文档补丁工具（`scripts/patch-text.mjs`），**从命令行测**：一个 job 文件里的**每个文件都被应用**（第一版只应用最后一个文件却报告成功，悄悄丢过两条词典条目）；内容按字面处理——引号、反引号、空行原样保留；锚点对不上时**那个文件一个字节都不动**并以非零码退出。给它写测试是因为它的失败方式是**静默**的，而它被用来改文档：文档丢字很难被发现 |

## 对外接口

无。

## 依赖方向

通过 `execFileSync(node scripts/patch-text.mjs …)` 调用，不 import 那个 `.mjs`（它是给命令行用的）。临时文件在 `os.tmpdir()` 下。不依赖 `electron`。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[`../../../scripts/README.md`](../../../scripts/README.md)、[`../../../AGENTS.md`](../../../AGENTS.md)（文档规约）
