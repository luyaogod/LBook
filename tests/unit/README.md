# tests/unit

## 这个目录做什么

按被测模块分组的单元与集成测试。目录结构对应 `src/main` 的结构。

## 关键文件

| 目录 | 说明 |
|---|---|
| `config/` | 配置读写与容错（含 `locale` 的取值校验） |
| `lbook/` | OCR JSON 的字节偏移索引与页映射 |
| `library/` | 台账、读一本书、登记一个文件夹、进度 |
| `progress/` | 阅读进度文件的读写与容错 |
| `renderer/` | 渲染层可纯函数化的部分（资源 URL 重写） |
| `shared/` | `src/shared/` 纯函数的契约（`meta.json`、台账、目录树） |
| `tencent/` | 腾讯云 API 3.0 的签名（TC3-HMAC-SHA256）与 TTS 错误码翻译 |
| `translate/` | 翻译服务层：供应商回退、缓存、语种判断、密钥只写不读 |

## 对外接口

无。

## 依赖方向

引用 `src/main/**`、`src/shared/**` 与 `tests/helpers/`。

各文件的具体职责见 `TEST.md` 第 3 节。

## 相关文档

- 父级：[../README.md](../README.md)
- 子目录：[lbook/README.md](./lbook/README.md)、[library/README.md](./library/README.md)、[progress/README.md](./progress/README.md)、[shared/README.md](./shared/README.md)、[tencent/README.md](./tencent/README.md)、[translate/README.md](./translate/README.md)
- 相关：[../../TEST.md](../../TEST.md)
