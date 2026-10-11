# Phase 3 —— 删 SQLite 与三个依赖、重写相关文档

**目标**：把"数据库"和"自研包格式"这两套东西从代码里彻底清掉，只留文件夹。这一步的主要产出是**删除**，也是最容易被忽略的收益：打包不再需要原生模块那四件套配置。

**status（2026-10-11）：✅ 已完成。** 读路径切到文件夹时 db 层就删了；迁移跑完并逐本复核之后，迁移代码与 `better-sqlite3`/`yauzl` 依赖也删掉了。仓库里现在没有任何原生模块，`npm ls better-sqlite3 yauzl yazl` 为空。

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
- [x] 迁移跑完并复核之后，删 `src/main/migrate/`、`scripts/migrate-folders.ts`、`tests/unit/migrate/`、`tests/helpers/lbookPackage.ts`、`src/main/library/hash.ts`（只被迁移用），并把 `better-sqlite3`、`yauzl`、`@types/better-sqlite3`、`@types/yauzl` 与 `yazl` 从依赖里去掉。
- [x] 全量回归：`npm run typecheck && npm run lint && npm run check:docs && npm test && npm run probe:perf`。
- [x] 打包实测：安装包 108.1MB（基线 116.6MB），`release/win-unpacked/resources/` 里**没有** `app.asar.unpacked`。
- [x] 按上面的清单重写四份顶层文档；`AGENTS.md` 不用改（它的规则本身没变）。
- [x] `.agents/plan/README.md` 状态表改成 ✅；实测数字在 `baseline.md`。

---

## 验收

```bash
npm ls better-sqlite3 yauzl yazl          # (empty) — verified
ls release/win-unpacked/resources/        # no app.asar.unpacked — verified
grep -rn "better-sqlite3\|yauzl\|yazl" src/ scripts/ electron-builder.yml   # only historical comments
npm run typecheck && npm run lint && npm run check:docs && npm test && npm run probe:perf
```

### 恢复上一次迁移（万一需要）

迁移代码在 git 里，没有丢：

```bash
git checkout d35a9e6 -- src/main/migrate scripts/migrate-folders.ts tests/helpers/lbookPackage.ts
npm i -D better-sqlite3 yauzl @types/better-sqlite3 @types/yauzl
npm run migrate:folders -- --root <旧库目录>     # 默认 dry run，加 --apply 才写
```

- [x] 安装包体积与基线对比：**122,227,577 → 113,386,030 字节**（116.6MB → 108.1MB），少 8.8MB；`app.asar` 5,246,080 字节，`resources/` 里没有 `app.asar.unpacked`。
- [x] 没有数据库也能跑：验收时在一台“只有书文件夹、没有 `%APPDATA%` 索引”的路径上跑过 `--apply` 与探针，应用启动、列书、翻页都正常。
- [x] 书文件夹自包含：把某个书文件夹拷到别处再“打开文件夹”就能读（`meta.json` 里就有身份与页数），只有阅读进度是新的（进度本来就是本机的，B2）。

---

## 风险与注意

| 风险 | 注意什么 |
|---|---|
| 删早了，回退不了 | 已经删了。回退靠 git，不靠数据库：迁移代码在 `d35a9e6`（见上面的恢复三行），书本身一直在磁盘上没动过 |
| 用户的进度丢失 | 进度迁移必须在 Phase 1 做完；这里只是删掉旧表 |
| 文档改一半 | `check:docs` 能抓链接，但抓不到"说法过时"。逐文件过一遍：凡是出现 `.lbook` 的地方都要问一句"这句现在还成立吗" |
| 打包配置删多/删少 | 已真打一次包并装到 `D:\APPS\LBook`；`resources/` 里没有 `app.asar.unpacked`，启动正常 |

---

## 相关文档

- 父级：[README.md](./README.md)
- 同级：[`02-phase2-reactivity-validation.md`](./02-phase2-reactivity-validation.md)、[`04-phase4-monaco.md`](./04-phase4-monaco.md)
- 相关：[../../PLAN.md](../../PLAN.md) 第 7、9 节、[`baseline.md`](./baseline.md)
