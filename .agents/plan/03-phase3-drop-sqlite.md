# Phase 3 —— 删 SQLite 与三个依赖、重写相关文档

**目标**：把"数据库"和"自研包格式"这两套东西从代码里彻底清掉，只留文件夹。这一步的主要产出是**删除**，也是最容易被忽略的收益：打包不再需要原生模块那四件套配置。

**status（2026-10-11）：大部分已随 Phase 1 完成。** `src/main/db/**`、`library/{service,importer,legacy}.ts`、`lbook/{reader,zipIndex,archiveCache,packer,reconstruct,validate,manifest}.ts` 已删；`better-sqlite3` 与 `yauzl` 已移入 `devDependencies`（只有迁移脚本用），`yazl` 已移除；`electron-builder.yml` 的 `asarUnpack` 与 `npmRebuild` 已删；DESIGN/BUILD/TEST 与各目录 README 已重写。**剩下的是：跑完 T8 迁移、确认无误后删掉 `src/main/migrate/`、`scripts/migrate-folders.ts` 与那两个依赖，再实测一次打包体积。**

**前置**：Phase 1（读路径已切到文件夹 + 迁移已跑过）+ Phase 2（校验与反应式）稳定跑过一段时间。

---

## 删除清单

| 目标 | 说明 |
|---|---|
| `src/main/db/**`（`open.ts` `schema.ts` `migrations.ts` `repositories/**`） | 连同它的 `README.md` 一起删（目录没了，README 也要没） |
| `better-sqlite3` 依赖 | 连同 `electron-builder.yml` 的 `asarUnpack`、`npmRebuild`、`scripts/build.mjs` 的 `external` |
| `yauzl` / `yazl` 依赖 | 若 Phase 1 已删 `reader.ts`/`packer.ts`，这里只剩依赖声明与 `external` 列表 |
| `app.asar.unpacked`（打包产物里的） | 验证它不再出现 |
| `%APPDATA%\LBook\lbook.db*` | **不主动删**：留给用户，文档里写一句"可以自己删了" |
| `DESIGN.md` §5（数据层）、§6（`.lbook` 格式规范）、§4.2（PDF 为什么不走协议）、§12 的若干条 | 重写 |
| `BUILD.md` §5（better-sqlite3 排错）整节、§2 里关于原生模块的话、§9 表格里相关的几行 | 删 |
| `TEST.md` 第 3 节里 db/lbook 的行 | 删 |
| `src/main/README.md`、`src/shared/README.md` 等目录 README | 同步（`db/` 整目录消失） |

---

## 任务清单

- [x] 删 db 层（`src/main/db/**` 与 `tests/unit/db/**` 已删；`context.ts` 不再打开数据库）。
- [x] `electron-builder.yml`：删 `asarUnpack`、`npmRebuild`。
- [x] `scripts/build.mjs` 的 `external` 收尾（`yazl` 已移除；`better-sqlite3`/`yauzl` 只给脚本用）。
- [ ] **跑完 T8 迁移之后**：删 `src/main/migrate/`、`scripts/migrate-folders.ts`，并把 `better-sqlite3`、`yauzl`、`@types/better-sqlite3`、`@types/yauzl` 从 `devDependencies` 里去掉（验收里的 `npm ls` 到那时才为空）。
- [x] 全量回归：`npm run typecheck && npm run lint && npm run check:docs && npm test && npm run probe:perf`。
- [ ] 打包实测：记录安装包体积与 `release/win-unpacked/resources/` 内容（应当没有 `app.asar.unpacked`）。
- [x] 按上面的清单重写四份顶层文档；`AGENTS.md` 不用改（它的规则本身没变）。
- [ ] `.agents/plan/README.md` 状态表改成 ✅（待迁移跑完）；把实测数字追加到 `baseline.md`。

---

## 验收

```bash
npm ls better-sqlite3 yauzl yazl          # 空
ls release/win-unpacked/resources/        # 不该有 app.asar.unpacked
grep -rn "better-sqlite3\|yauzl\|yazl" src/ scripts/ electron-builder.yml   # 空
npm run typecheck && npm run lint && npm run check:docs && npm test && npm run probe:perf
```

- [ ] 安装包体积与基线对比（`baseline.md` 里记了 122,227,577 字节 = 0.0.1 那次），**明显变小**。
- [ ] 一份全新的空机器路径：删掉 `%APPDATA%\LBook`，启动应用 → 能起、能“打开一个书文件夹”并登记进台账、能打开那本书 —— 证明“没有数据库也能跑”。
- [ ] 把一份迁移过来的书文件夹整个拷到另一台机器（只有文件夹，没有 `%APPDATA%`）→ 在那里“打开文件夹”就能读，只有阅读进度是新的（进度本来就是本机的，B2）。

---

## 风险与注意

| 风险 | 注意什么 |
|---|---|
| 删早了，回退不了 | 这个阶段**不可回退**（Phase 1 之后能不能回退，靠的是 git 而不是数据库）。所以放在最后，且前置是"Phase 1/2 稳定跑过一段时间" |
| 用户的进度丢失 | 进度迁移必须在 Phase 1 做完；这里只是删掉旧表 |
| 文档改一半 | `check:docs` 能抓链接，但抓不到"说法过时"。逐文件过一遍：凡是出现 `.lbook` 的地方都要问一句"这句现在还成立吗" |
| 打包配置删多/删少 | 删完必须真打一次包并装一次（`BUILD.md` 第 6 节的手工安装流程），只跑 `build` 不算验过 |

---

## 相关文档

- 父级：[README.md](./README.md)
- 同级：[`02-phase2-reactivity-validation.md`](./02-phase2-reactivity-validation.md)、[`04-phase4-monaco.md`](./04-phase4-monaco.md)
- 相关：[../../PLAN.md](../../PLAN.md) 第 7、9 节、[`baseline.md`](./baseline.md)
