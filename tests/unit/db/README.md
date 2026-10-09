# tests/unit/db

## 这个目录做什么

数据层测试：schema、迁移、仓储。

## 关键文件

| 文件 | 说明 |
|---|---|
| `schema.test.ts` | 五张表与索引存在；`user_version` 正确；**`foreign_keys` 为 ON**；三处唯一约束生效 |
| `migrations.test.ts` | 全新库升级；重复执行幂等；升级保留既有数据；拒绝来自更高版本的库 |
| `repositories.test.ts` | 行→渲染层类型映射（含 `cover_url`）；排序；**级联删除带走页与块**；bbox 解析与容错；`is_html_content` 重算；阅读进度 upsert 与越界拒绝 |

## 对外接口

无。

## 依赖方向

引用 `src/main/db/**` 与 `tests/helpers/temp.ts`。每个用例用独立的临时数据库，`afterEach` 里关闭并删除。

`foreign_keys` 与级联删除这两条是被重点盯住的：SQLite 默认关闭外键，一旦这条 pragma 丢了，删一本书会静默留下几万个孤儿块。

## 相关文档

- 父级：[../README.md](../README.md)
