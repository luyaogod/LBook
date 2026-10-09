# tests/unit/tencent

## 这个目录做什么

腾讯云调用层的单元测试。重点是**签名**：签名错一个换行、把 UTC 日期写成东八区日期，服务端只会回一句"签名校验失败"，所以这里用官方文档的算例把它钉死。

## 关键文件

| 文件 | 说明 |
|---|---|
| `sign.test.ts` | `TC3-HMAC-SHA256` 的规范请求串、待签名字符串、Authorization 头、UTC 日期、region/STS 头的有无 |

## 对外接口

无。

## 依赖方向

引用 `src/main/tencent/sign.ts`。**不发起网络请求**——真实调用由 `scripts/tencent-probe.ts` 手工执行。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../TEST.md](../../../TEST.md)、[../../../src/main/tencent/README.md](../../../src/main/tencent/README.md)
