# tests/unit

## 这个目录做什么

按被测模块分组的单元与集成测试。目录结构对应 `src/main` 的结构。

## 关键文件

| 目录 | 说明 |
|---|---|
| `db/` | schema、迁移、仓储 |
| `config/` | 配置读写与容错 |
| `lbook/` | 包索引、读取、校验、manifest |
| `library/` | 扫描、导入、保存回写 |
| `migration/` | 旧数据重建的黄金用例 |
| `renderer/` | 渲染层可纯函数化的部分（资源 URL 重写） |
| `shared/` | `src/shared/` 纯函数的契约（目录树解析与定位） |
| `tencent/` | 腾讯云 API 3.0 的签名（TC3-HMAC-SHA256） |
| `translate/` | 翻译服务层：供应商回退、缓存、语种判断、密钥只写不读 |

## 对外接口

无。

## 依赖方向

引用 `src/main/**`、`src/shared/**` 与 `tests/helpers/`。

各文件的具体职责见 `TEST.md` 第 3 节。

## 相关文档

- 父级：[../README.md](../README.md)
- 子目录：[shared/README.md](./shared/README.md)、[tencent/README.md](./tencent/README.md)、[translate/README.md](./translate/README.md)
- 相关：[../../TEST.md](../../TEST.md)
