# src

## 这个目录做什么

全部源代码，按进程边界分层。它**不**包含构建产物（在 `out/`）与文档。

## 关键文件

本目录不直接包含文件，只有子目录。

## 对外接口

无对外导出。

## 依赖方向

被 `scripts/` 与 `tests/` 引用。子目录之间有严格的方向：`shared` ← `main`/`preload`/`renderer`。**只有 `main` 允许 import `electron`**。

## 相关文档

- 父级：[../README.md](../README.md)
- 子目录：[main/README.md](./main/README.md)、[preload/README.md](./preload/README.md)、[renderer/README.md](./renderer/README.md)、[shared/README.md](./shared/README.md)
