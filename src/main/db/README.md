# src/main/db

## 这个目录做什么

SQLite 数据层：连接、schema、版本迁移与仓储装配。它**不**懂 `.lbook`，也**不**懂 UI。

## 关键文件

| 文件 | 说明 |
|---|---|
| `open.ts` | `openDatabase()`：按序设置 pragma，其中 **`foreign_keys = ON` 是级联删除生效的前提** |
| `schema.ts` | `SCHEMA_V1`：五张表的 DDL 与索引 |
| `migrate.ts` | `PRAGMA user_version` 驱动的 append-only 迁移 |
| `index.ts` | `createRepositories()`、`openDatabaseWithRepositories()`、`nowIso()` |

## 对外接口

`Repositories`、`createRepositories(db)`、`openDatabaseWithRepositories(file)`、`nowIso()`、`Db`。

## 依赖方向

被 `src/main/library/` 与 `src/main/index.ts`（经 `context.ts`）使用。只依赖 `better-sqlite3` 与 Node 内置模块，**不依赖 `electron`**。仓储层写成闭包在 `Database` 句柄上的工厂函数，就是为了让它能在测试里直接实例化。

## 相关文档

- 父级：[../README.md](../README.md)
- 子目录：[repositories/README.md](./repositories/README.md)
- 相关：[../../../DESIGN.md](../../../DESIGN.md) 第 5 节
