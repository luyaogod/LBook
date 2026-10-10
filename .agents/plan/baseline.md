# 基线与实测记录

数字只写结论与来源，不贴整屏日志。**每次跑 `npm run probe:perf` 都可以复现**（它自检：把扫描器给的每一页切片交给 V8 解析，与整文件 parse 的同一页逐一深度比对）。

机器：本机 Windows，Node 24 / V8（与 Electron 主进程同一引擎）。日期：2026-10-11。

## Phase 0：目标读路径（单文件 + 字节偏移索引）

| 指标 | 库内最大：BPP（ocr.json 7.9MB / 665 页） | 手上最大真实输出：Oxford 3ed（15.6MB / 294 页） |
|---|---|---|
| 自检：切片 vs 整文件 parse 逐页深度比对 | 665/665 相等 | 294/294 相等 |
| 流式扫全文件建索引 | 22.7 ms（349 MB/s） | 35.7 ms（438 MB/s） |
| 首屏（扫到第 30 页 + 取第 1 页） | 3.1 ms | 6.9 ms |
| 冷开书（连全扫一起算） | 23.0 ms | 36.3 ms |
| 顺序取一页 p95 | 0.14 ms | 0.32 ms |
| 随机取一页 p95 | 0.07 ms | 0.29 ms |
| Flow 连滚 60 页合计 | 2.5 ms | 5.8 ms |
| 内存增量：懒加载（索引 + 读 130 页） | +4.2 MB | +4.7 MB |
| 内存增量：整文件 `JSON.parse` | +46.6 MB | +48.1 MB |
| 读回索引缓存 | 0.09 ms | 0.06 ms |

**结论**：懒加载增量不随文件大小变（7.9MB → 15.6MB 是 +4.2 → +4.7MB），整文件 parse 则随文件涨（+46.6 → +48.1MB）。**内存与文件大小解耦**这条性质成立，其余全部达标。

## Phase 0：对照（现在这条路）

| 指标 | 数值 |
|---|---|
| SQLite 顺序取一页（含 parse `pruned_result`） | 0.10 ms |
| SQLite 随机取一页 | 0.10 ms |
| SQLite 取一页的块 + bbox 解析 | 0.04 ms |
| SQLite `listBriefs`（665 页） | 0.35 ms |
| PDF 64KB 区间读：`.lbook`(zip) / 普通文件 | 0.13 / **0.01 ms**（快 10.6×） |
| PDF 2MB 区间读：`.lbook`(zip) / 普通文件 | 0.42 / **0.21 ms**（快 2.0×） |
| 书库扫描（101 本同层文件夹，各读一个 meta.json） | 7.3 ms（72 µs/本） |
| 解包一本 69MB 的书（PDF + ocr.json） | 54 ms（一次性迁移成本） |

**结论**：目标路径按页比现状快（0.04–0.13 vs 0.10 ms），PDF 区间读快 1.7–10.6×，书库扫描 100 本 7ms 量级——**没有一项是退步**，所以重构的性能风险清掉了。

## Phase 0：数据体量（用来判断"拆分 vs 单文件"）

| 指标 | 库内 5 本 / 1872 页 |
|---|---|
| `pruned_result` 合计 | 19.5 MB |
| `ocr_blocks.block_content` 合计 | 3.5 MB（与 `parsed_res_list` 里的块文字重复） |
| `markdown_text` + `markdown_images` | 3.4 + 1.6 MB |
| `lbook.db` 文件 | 38.6 MB |

单页看（BPP 第 21 页，`pruned_result` 13KB）：`parsing_res_list` 占 66%、`layout_det_res` 占 31%（**只存在这里，没有第二份**）、该页 24 块的文字 3KB、`markdown_text` 3KB。

## 逐阶段追加区

- **Phase 1**：_待填——迁移 5 本的真实耗时、新旧路径的实际对比（不只是探针）_
- **Phase 2**：_待填——watch 的反应延迟、坏文件时的书库表现_
- **Phase 3**：_待填——删掉 SQLite/三个依赖后的安装包体积、启动耗时、扫描 100 本的实测_

---

## 相关文档

- 父级：[README.md](./README.md)
- 同级：[`00-decisions.md`](./00-decisions.md)
- 相关：[../../PLAN.md](../../PLAN.md) 第 4.2 节、[`../README.md`](../README.md)
