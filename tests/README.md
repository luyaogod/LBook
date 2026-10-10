# tests

## 这个目录做什么

Vitest 测试。全部以 `environment: 'node'` 运行，**不启动 Electron**。

## 关键文件

| 目录 | 说明 |
|---|---|
| `helpers/` | 夹具构造：临时目录、书文件夹、`.lbook` 包（只给迁移测试用） |
| `unit/` | 按被测模块分组的用例 |

## 对外接口

无。测试不被任何生产代码引用。

## 依赖方向

引用 `src/main/**` 与 `src/shared/**`。夹具一律在 `os.tmpdir()` 下生成，**绝不写真实的 `%APPDATA%\LBook` 或用户库目录**。

`unit/migration` 的黄金用例依赖于仓库外的真实 `.lbook` 包；这类用例一律用 `describe.skipIf(文件不在)` 包起来，缺失时整块跳过而不是失败。

## 相关文档

- 父级：[../README.md](../README.md)
- 子目录：[helpers/README.md](./helpers/README.md)、[unit/README.md](./unit/README.md)
- 相关：[../TEST.md](../TEST.md)
