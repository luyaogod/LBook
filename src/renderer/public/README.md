# src/renderer/public

## 这个目录做什么

**原样拷贝**到产物根目录的静态文件——不经打包器处理、不加哈希。适用于必须保持固定路径的东西。

## 关键文件

| 文件 | 说明 |
|---|---|
| `favicon.svg` | 页面图标，由 `index.html` 以相对路径引用 |
| `icons.svg` | 图标精灵，当前未被引用 |

## 对外接口

无——它们不是模块，是照 URL 访问的文件。

## 依赖方向

被 `src/renderer/index.html` 引用。生产环境下经 `app://bundle/` 提供。

## 相关文档

- 父级：[../README.md](../README.md)
