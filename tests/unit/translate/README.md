# tests/unit/translate

## 这个目录做什么

翻译服务层的单元测试。重点有三块：**不联网**（供应商用假的实现注入）、**不重复付费**（缓存命中）、**密钥只写不读**（`settingsView` 把 secret 字段抹空）。

## 关键文件

| 文件 | 说明 |
|---|---|
| `service.test.ts` | 供应商解析与回退、`auto` 本地判语言、缓存命中、源=目标时短路、空选拒绝、凭据的"留空=不改 / null=清除"语义、缺凭据报 `ProviderConfigError` 且不发请求 |
| `detect.test.ts` | 本地语种判断（中英混排的两种典型情况、无字母数字时返回 null） |

## 对外接口

无。

## 依赖方向

引用 `src/main/translate/`、`src/main/config/`、`src/main/paths.ts`。HTTP 通过 `fetchImpl` 注入，**测试里一次真实请求都不会发出**。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../TEST.md](../../../TEST.md)、[../../../src/main/translate/README.md](../../../src/main/translate/README.md)
