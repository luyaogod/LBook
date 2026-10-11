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

### Phase 1（2026-10-11 实测，真实 5 本）

迁移（`npm run migrate:folders --apply`，5 本共 585MB）：

| 指标 | 值 |
|---|---|
| 五本合计耗时 | **~800 ms**（BPP 139 / OPD3ed 99 / OPD 110 / 初级会计 220 / 经济法 223） |
| 产出 | 5 个书文件夹 = 556MB PDF + 27MB `ocr.json` + 封面与 `toc.json` |
| 复核 | 独立脚本读包逐本核对 **61 项全过**（PDF sha256 对得上包内自报值、`ocr.json` 逐字节相同、页数 = 数组长度 = 包内 pageCount、原包哈希与备份相同） |
| 幂等 | 再跑一次：5 本全部 skipped，没有第二个副本 |

新路径的读性能（`npm run probe:perf`，直接拿迁移后的真书文件夹量，最大的那本 7.9MB OCR / 665 页）：

| 指标 | 值 |
|---|---|
| 自检（扫描器 vs V8 逐页深度比对） | 665/665 全等 |
| 读 `meta.json` | 0.19 ms |
| 流式扫全文件建索引 | 27.6 ms（287 MB/s） |
| 取第 1 页 | 0.15 ms |
| 冷开书（全扫） / **首屏（只扫 30 页）** | 28.0 / **2.9 ms** |
| 顺序翻页 p95 / 随机跳页 p95 | 0.20 / 0.08 ms |
| 懒加载内存增量 vs 整文件 parse | **+2.9MB vs +47.0MB** |
| 书库扫描（5 本） | 74 µs/本 |

索引缓存与持久化：

| 指标 | 值 |
|---|---|
| 台账 `library.json` | 776 字节（5 条） |
| 进度 `progress.json` | 562 字节（5 条） |
| 读回索引缓存 vs 重扫 | 0.10 ms vs 27.6 ms（**所以缓存不值得做，A4 成立**） |

打包（Phase 3 的收益已经提前出现）：

| 指标 | 0.0.1（旧） | 现在 |
|---|---|---|
| NSIS 安装包 | 122,227,577 字节（116.6MB） | **108.1MB** |
| `resources/app.asar.unpacked` | 有（better-sqlite3 + bindings） | **无** |
| 原生模块 | `better-sqlite3` | 无（装机包里只有 JS） |

- **Phase 2**：_待填——watch 的反应延迟、坏文件时的书库表现_
### Phase 3（2026-10-11 实测）

| 指标 | 0.0.1（旧） | Phase 1 后 | Phase 3 后 |
|---|---|---|---|
| NSIS 安装包 | 122,227,577 字节（116.6MB） | 113,386,030 字节（108.1MB） | **113,386,030 字节**（依赖本来就没进包；删掉的是 devDependency） |
| `resources/app.asar.unpacked` | 有 | 无 | **无** |
| `npm ls better-sqlite3 yauzl yazl` | 有 | 三个都在 devDependencies | **空** |
| 仓库里的原生模块 | `better-sqlite3` | 无（只是 devDependency） | **无** |
| 仓库里需要编译/原生构建的包 | `better-sqlite3` | 无（只是 devDependency） | **无** |
| 迁移代码 | — | `src/main/migrate/` + `scripts/migrate-folders.ts` + 11 条测试 | **已删除**（约 700 行） |

结论：Phase 3 真正的收益不在装机包体积（那部分 Phase 1 就拿到了），而在**仓库里再也没有需要编译的东西**：`npm install` 不再有 native 构建，`npm run typecheck` 不再需要 `export =` 的兼容开关，`scripts/run.mjs` 的 `external` 只剩 `electron` 与 `electron-updater`。

---

## 相关文档

- 父级：[README.md](./README.md)
- 同级：[`00-decisions.md`](./00-decisions.md)
- 相关：[../../PLAN.md](../../PLAN.md) 第 4.2 节、[`../README.md`](../README.md)
