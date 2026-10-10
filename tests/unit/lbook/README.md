# tests/unit/lbook

## 这个目录做什么

OCR JSON 的**字节级**读法测试，以及"页元素 → 渲染层形状"的映射测试。这是整个套件里最接近"物理正确性"的部分。

## 关键文件

| 文件 | 说明 |
|---|---|
| `offsetIndex.test.ts` | 字节偏移索引：**跨块**（7/13/64 字节分块，故意把结构字符劈开）、字符串里的括号与转义、多字节 UTF-8 被劈开、`limit` 早退（首屏只读"前缀 + 一块"）、找不到数组/空数组/截断文件都不抛异常；真实 fixture **逐页与整文件 parse 深度相等** |
| `ocr.test.ts` | 映射：`parsing_res_list` → `OcrBlock[]`（字段名保持 PaddleOCR 原样、`block_index` 就是数组下标）、半写坏的块不抛异常、页尺寸缺失时按 bbox 推断、`markdown.text` **原样**读出来（不从块派生，A10） |

## 对外接口

无。

## 依赖方向

引用 `src/main/lbook/**` 与 `tests/helpers/bookFolder.ts`。

`ocr.test.ts` 里那几条断言看着平淡，但它们是渲染层的形状契约：`block_index` 是 hover/滚动联动的身份，`markdown_text` 与 `blocks` 是**两条独立的读法**，谁也不能从谁派生。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../TEST.md](../../../TEST.md) 第 3 节
