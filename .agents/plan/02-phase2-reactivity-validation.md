# Phase 2 —— 外部编辑的反应式重读 + 校验与坏书 UI

**目标**：让"用户自己改文件"这件事真的顺手——改完不用重启；改坏了要在书库里看得见，而不是等打开时才炸。

**前置**：Phase 1 已完成（书文件夹 + 台账是真相，应用只读）。

---

## 任务清单

### T1 反应式重读 ✅ 已完成（2026-10-11）

> 实现：`src/main/library/watch.ts`（每本书一个 `fs.watch`，300ms 去抖，挂不上时降级为 30s 轮询）、`OpenBook.isStale()`（每次读都比较 `meta.json`/`ocr.json` 的 `mtime+size`，约 20µs）、`app.on("browser-window-focus")` 重扫 + `library:refresh`、渲染层的 `useBookChange()` 把版本号喂给三个数据 hook（**只换数据，不动页码与滚动**）。`book.pdf` 被替换的情况不在范围内：重开这本书即可。

- [x] `fs.watch` 挂在**已登记的那些书文件夹**上（台账里每个 path 一个 watcher，而不是扫一个库目录；上限很多时只挂父目录或降级到轮询），去抖 300ms。
- [x] 窗口聚焦时重扫一次（`app.on("browser-window-focus")` 或渲染层的 `visibilitychange` → IPC）——网络盘/移动盘上 watch 不可靠，聚焦重扫是兜底。
- [x] 正在读的那一页所在文件变了：**只重读该页**（用 `mtimeMs + size` 判断），保持页码与滚动位置。
- [x] `ocr.json` 变了：偏移索引失效重扫（这是唯一的失效条件；缩进被改、换行被改都归到这里）。
- [x] 显式的"刷新"按钮（书库页右上角），并做 30s 轮询兜底（仅当 watcher 报告过失败时启用）。
- [x] 主进程到渲染层的通知通道：`library:changed` / `book:changed` 事件（参考现有的 `UPDATE_STATUS_EVENT` 写法）。
- [x] 不要在看 PDF 时把整页闪一下：重读只替换数据，不重挂载查看器。

### T2 校验器（一套消息，两处用）✅ 已完成

> 实现：`src/shared/validateBook.ts`（规则 + 文案，零依赖、不做 I/O、**永不抛异常**）+ `src/main/library/inspect.ts`（把输入读齐）。额外发现并补上的一条：逐页切片读法对"页与页之间少一个逗号"是免疫的，所以深度检查还会整份 `JSON.parse` 一次——否则这份文件对本应用没事、对别的工具却是坏的。

- [x] `src/shared/validateBook.ts`：输入"一个书文件夹的原始内容摘要"，输出 `Issue[]`（`{ level: "error"|"warn", file, message, offset?, jsonPath? }`）。
  - [x] `meta.json`：缺 `uid` / `pageCount` 非数字 / `ocrFile` 指向不存在的文件。
  - [x] `ocr.json`：找不到 `layoutParsingResults`；某页元素不是对象；`parsing_res_list` 不是数组；`block_bbox` 不是 4 个数。
  - [x] 交叉：页文件数与 `pageCount` 与 PDF 页数三者不一致 → 提示"**页码可能整体移位**"（页号 = 数组下标，A8）。
  - [x] `toc.json`：复用现有 `parseToc` 的消息。
  - [x] `book.pdf`：文件头不是 `%PDF-`。
- [x] 单测：每条规则一个用例；**坏到极致也不能抛异常**（校验器自己崩了就等于书库崩了）。

### T3 书库里的"需要修复" ✅ 已完成

> 实现：列表行的徽标 + 原因（已有），加一个 **Check** 按钮展开明细：每条给出文件、人话、`jsonPath`、字节偏移，并配 "Open" 与 "Show in folder"。坏书仍可点开（能读多少读多少）。

- [x] `listBooks` 返回的 `problem` 在列表项上显示成一个徽标 + 一句人话（不是堆栈）。
- [x] 展开明细：文件名、JSON 路径（`layoutParsingResults[300]`）、**字节偏移**、期望什么。
- [x] 坏书仍然可以点开（能读多少读多少），不能因为一本坏挡住整个书库。

### T4 打开位置与外部编辑器 ✅ 已完成

> 实现：`library:openPath` / `library:showInFolder`（按**角色**取名：`folder`/`meta`/`ocr`/`toc`/`pdf`/`cover`，路径由 `Library.resolveFile()` 解析）+ 首页的 Refresh 与 “Show the folder”。

- [x] "在资源管理器中显示"（`shell.showItemInFolder`）与"用系统默认程序打开该文件"（`shell.openPath`）——库根、书文件夹、`ocr.json`、`meta.json` 各一个入口。
- [x] 沿用 `settings:revealLibraryDir` 的写法（错误要回传给渲染层显示，不要静默）。

### T5 未迁移的 `.lbook` ✅ 已完成

> 实现：`library:leftovers` 找出默认位置里的旧包，首页顶部一条可隐藏的提示说明它们是什么、**应用不会动它们**，并给一个打开所在文件夹的入口。
>
> **2026-10-11 修正**：这条提示原先写着 `npm run migrate:folders`，而那个脚本在 Phase 3 随迁移代码一起删掉了——照它输入只会得到 `Missing script`。文案改成：这些是迁移前的旧包、一次性转换器在全部书都搬完之后已删除（取回见 `DESIGN.md` 6.4）、这里的东西应用一个字节都不碰、看着没问题就自己删掉。**界面里不该出现仓库里不存在的命令。**

- [x] 迁移是一次的（A12/A13，由脚本跑完）；这里只处理“迁移之后又冒出来的旧包”：在默认新建位置里发现 `.lbook` 时提示一次。~~给个入口跑迁移~~ → **转换器已随 Phase 3 删除**，所以入口是“打开所在文件夹”，而不是承诺一个做不到的按钮。
- [x] 迁移完提示"原包保留着，确认新布局没问题后可以自己删掉"（2026-10-11 文案修正后为真）。

---

## 验收

- [x] 用外部编辑器改 `toc.json` → 切回窗口，目录栏**立刻**是新内容（无需重启）。
- [x] 改某页的一个字 → 切回窗口，**当前页**（如果正是那一页）立刻更新，且**停在原页码**、滚动位置不跳。
- [x] 把 `meta.json` 改坏（删掉 `uid`）→ 书库标红但不崩；其余书照常打开。
- [x] 把台账里某本书的文件夹改名 → 那一条标“找不到”，点“从书库移除”后条目消失，**文件夹仍在**。
- [x] 把 `ocr.json` 第 300 页后面的结构改坏（少一个 `}`）→ 修复明细报出**字节偏移**，第 1 页仍能打开。
- [x] 手动改回文件后，徽标消失（校验是每次扫描重算的，不缓存"坏"这个结论）。
- [x] 全程 `npm test`、`npm run check:docs` 绿。

---

## 风险与注意

| 风险 | 注意什么 |
|---|---|
| `fs.watch` 在 Windows 上重复/丢事件 | 去抖 + 聚焦重扫 + 手动按钮，三层兜底；**不要**依赖 watch 的语义 |
| 重读把阅读打断 | 只换数据、不重挂载；保持页码与滚动；绝不自动跳到别处 |
| 校验器把书库拖慢 | 校验只读 `meta.json` 与文件头，**不要**在列表阶段扫整个 `ocr.json`；`layoutParsingResults` 的结构校验放在"打开那本书时"或"用户点开明细时" |
| 网络盘/移动盘 | 聚焦重扫是主路径，watch 只是加速；文档里说明"网络盘上可能需要手动刷新" |

---

## 相关文档

- 父级：[README.md](./README.md)
- 同级：[`01-phase1-folder-read.md`](./01-phase1-folder-read.md)、[`03-phase3-drop-sqlite.md`](./03-phase3-drop-sqlite.md)
- 相关：[../../PLAN.md](../../PLAN.md) 第 5、6 节
