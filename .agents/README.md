# .agents

## 这个目录做什么

**代理与协作者的工作区**：施工计划、决策台账、实测记录。它不是产品文档，也不参与构建与打包（`.agents/**` 不在 `electron-builder.yml` 的 `files` 里，也不被 `tsconfig` 收录）。

- 它**不**放代码、不放测试、不放构建产物——那些在 `src/`、`tests/`、`scripts/`。
- 产品性的文档（架构、构建、测试、约定、计划）仍在根目录那五份里，**不要**在这里复制一份。

按 `AGENTS.md` §1 的硬规则，只有 `src/`、`scripts/`、`tests/` 下的目录必须带 README；本目录写给协作者看，所以照样带，但索引链的终点是 `PLAN.md` 与根 `README.md`。

## 关键文件

| 文件 | 说明 |
|---|---|
| `plan/README.md` | 施工计划的索引：阶段状态表、怎么用这套文件、下一步 |

## 对外接口

无——这是文档目录。

## 依赖方向

被 `PLAN.md`、根 `README.md` 与 `AGENTS.md` 链接。它自己不引用任何代码。

## 相关文档

- 父级：[../README.md](../README.md)
- 子目录：[plan/README.md](./plan/README.md)
- 相关：[../PLAN.md](../PLAN.md)（这份计划的产品视角版本）、[../AGENTS.md](../AGENTS.md)
