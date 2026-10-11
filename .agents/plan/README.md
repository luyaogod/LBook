# 施工计划（`.agents/plan`）

`PLAN.md` 讲"改成什么样、为什么"，**这里讲"先动哪个文件、怎么算做完"**。两边是同一件事的两个视角：`PLAN.md` 是给"要不要做"看的，这里是给"动手"看的。

## 阶段状态

| 阶段 | 内容 | 状态 | 文件 |
|---|---|---|---|
| **Phase 0** | 性能验证与决策：单文件 + 字节偏移索引到底顶不顶得住 | ✅ 已完成（数据见 `baseline.md`） | — |
| **Phase 1** | 读路径换成文件夹 + 一次性迁移 + **下掉全部编辑入口** | ✅ 已完成（含真实 5 本的迁移与逐本复核） | [`01-phase1-folder-read.md`](./01-phase1-folder-read.md) |
| **Phase 2** | 外部编辑的反应式重读 + 校验与坏书 UI | ✅ 已完成（watch + 聚焦重扫 + 每次读都比对 mtime；校验器一套规则两处用、Check 明细带字节偏移、打开/定位入口、旧包提示） | [`02-phase2-reactivity-validation.md`](./02-phase2-reactivity-validation.md) |
| **Phase 3** | 删 SQLite 与三个依赖、重写相关文档 | ✅ 已完成（db 层、迁移代码与 `better-sqlite3`/`yauzl`/`yazl` 全删，文档已重写，安装包 116.6MB → 108.1MB） | [`03-phase3-drop-sqlite.md`](./03-phase3-drop-sqlite.md) | [`03-phase3-drop-sqlite.md`](./03-phase3-drop-sqlite.md) |
| **Phase 4** | 后期：Monaco 按页编辑（独立立项） | 🅿️ 搁置 | [`04-phase4-monaco.md`](./04-phase4-monaco.md) |
| **界面多语言** | i18next 接入；英文为基准 + 简体中文；设置里有 Language 三张卡片 | 🟡 进行中 | [`05-i18n.md`](./05-i18n.md) |

`05-i18n.md` 是与 Phase 1 并行的一条线（互不阻塞）。`00-decisions.md` 是决策台账：**动工前先看它**，里面有 5 条待拍板的事与已经定下来的事。`baseline.md` 是 Phase 0 的实测数据，Phase 3 的"删除到底省了多少"要拿它对比。

## 怎么用这套文件

1. **先读 `00-decisions.md`**：待拍板的事没定，Phase 1 的任务清单里有些条目就是悬空的（会标出来）。
2. 每个阶段文件都是可独立施工、可独立验收、可停的。任务清单里的 `[ ]` 就是进度，改了就打勾并写一句"怎么验的"。
3. **做完一个阶段，改本文件的状态表**，并把 验收 里跑过的命令与输出要点追加到 `baseline.md` 的对应小节（只写结论与数字，不要贴整屏日志）。
4. `PLAN.md` 与本文档冲突时，**以这里为准**（它是后写的、更细的），然后回头把 `PLAN.md` 修正——别让两边各说各的。

## 两条施工纪律

- **一个阶段一次提交（或按"删/加"分开几次），信息用英文**：说明做了什么以及为什么（`AGENTS.md` §4）。
- **每个阶段结束都要跑全套**：`npm run typecheck && npm run lint && npm run check:docs && npm test && npm run probe:perf`。文档索引（`check:docs`）会因为新增/删除目录而失败——新增目录必须同时加它的 README，这是 `AGENTS.md` §1.1 的硬规则。

## 相关文档

- 父级：[../README.md](../README.md)
- 同级：[`00-decisions.md`](./00-decisions.md)、[`baseline.md`](./baseline.md)
- 相关：[../../PLAN.md](../../PLAN.md)（产品视角）、[../../DESIGN.md](../../DESIGN.md)（现状）、[../../TEST.md](../../TEST.md)（测试与手工清单）
