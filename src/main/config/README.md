# src/main/config

## 这个目录做什么

读写 `%APPDATA%\LBook\config.json`。**绝不因为配置损坏而让应用起不来。**

## 关键文件

| 文件 | 说明 |
|---|---|
| `config.ts` | `AppConfig` 定义、默认值、读（含容错与自愈）、原子写 |

## 对外接口

`AppConfig`、`Theme`、`CONFIG_VERSION`、`defaultConfig()`、`readConfig(file)`、`writeConfig(file, config)`。

## 依赖方向

被 `src/main/context.ts` 调用。只依赖 `node:fs` 与 `node:path`，**不依赖 `electron`**，因此可在纯 Node 下测试。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../DESIGN.md](../../../DESIGN.md) 第 5 节（数据层）
