# tests/unit/renderer

## 这个目录做什么

渲染层中**可纯函数化**的部分的测试。这里不放组件渲染测试——那需要 jsdom，收益低于成本。

## 关键文件

| 文件 | 说明 |
|---|---|
| `assetUrl.test.ts` | `imgs/x.jpg` → `lbook://asset/<uid>/imgs/x.jpg`；绝对 URL、协议相对 URL、data URL 均不改动；不误伤正文文本；单双引号属性都支持 |

## 对外接口

无。

## 依赖方向

引用 `src/shared/urls.ts`。因为该模块被刻意设计成零依赖（无 `electron`、无 Node 内置），所以能在 `environment: 'node'` 下直接测，不需要 DOM。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../TEST.md](../../../TEST.md) 第 7 节（不测什么）
