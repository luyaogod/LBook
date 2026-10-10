# TEST.md —— 测试策略与执行

## 1. 测试范围与原则

**只测 Node 侧。** 数据层、`.lbook` 读写、迁移重建、纯函数，全部在 Vitest 下以 `environment: 'node'` 运行，**不启动 Electron**，不 mock Electron API。

这条原则能成立，靠的是两条设计约束：

1. `app.getPath()` 全仓库只在 `src/main/index.ts` 出现一次，其余模块通过 `AppContext` 接收路径。
2. `src/main/db/`、`src/main/lbook/`、`src/main/library/` 不 `import` `electron`。

因此这些模块在测试里就是普通 Node 模块，直接实例化即可。

**夹具一律生成在 `fs.mkdtempSync(os.tmpdir())` 下，测试绝不触碰真实的 `%APPDATA%\LBook`。**

---

## 2. 运行方式

```bash
npm test              # 跑一遍
npm run test:watch    # 监听模式
npx vitest run tests/unit/lbook           # 只跑某个目录
npx vitest run -t "readPdfRange"          # 只跑匹配名字的用例
npx vitest --coverage                     # 带覆盖率（覆盖 src/main 与 src/shared）
```

---

## 3. 各测试文件职责

| 文件 | 锁住什么 |
|---|---|
| `tests/unit/db/schema.test.ts` | 五张表与索引存在；`user_version` 正确；**`foreign_keys` 为 ON**；`UNIQUE(pdf_id, page_num)` / `uid` / `file_hash` 生效 |
| `tests/unit/db/migrations.test.ts` | 全新库升到当前版本；重复执行幂等；拒绝来自更高版本的库 |
| `tests/unit/db/repositories.test.ts` | 行→渲染层类型映射（含 `cover_url`）；排序；**级联删除带走页与块**；块 bbox 解析与容错；`is_html_content` 重算；阅读进度 upsert 与越界拒绝 |
| `tests/unit/config/config.test.ts` | 默认值；往返写读；**损坏文件自愈而非崩溃**；字段级回退；**阅读字号缺失时取默认、越界/非法值时夹取与取整**；原子写入不留临时文件 |
| `tests/unit/lbook/zipIndex.test.ts` | 中央目录索引；`dataStart` 由局部文件头算出；区间读取与越界钳制；**拒绝对压缩条目做区间读**；条目名安全 |
| `tests/unit/lbook/offsetIndex.test.ts` | 大 OCR JSON 的字节偏移索引：**跨块**（7/13/64 字节分块把结构字符劈开）、字符串里的括号与转义、多字节 UTF-8 被劈开、`limit` 早退（首屏只读“前缀 + 一块”）、找不到数组/空数组/截断文件都不抛；真实 fixture **逐页与整文件 parse 深度相等** |
| `tests/unit/lbook/reader.test.ts` | **`readPdfRange(uid,0,8)` 以 `%PDF-` 开头**；随机区间与原始字节一致；尾块钳制；manifest / ocr / cover / toc 读取；**损坏的 `toc.json` 报错而不是当作没有目录**；**并发调用共享同一句柄**（句柄泄漏回归） |
| `tests/unit/lbook/manifest.test.ts` | manifest 解析与容错；`slugify` 边界（纯符号标题、非 ASCII、超长） |
| `tests/unit/lbook/validate.test.ts` | DEFLATE 的 PDF → 硬错误 + `needsRepack`；缺 manifest；格式串错；版本过高；**恶意 `../` 条目**；缺 book.pdf；截断包 |
| `tests/unit/tencent/sign.test.ts` | **TC3-HMAC-SHA256 与官方文档算例逐项相等**（规范请求串、待签名字符串、Authorization、UTC 日期、region/STS 头的有无）——签名错一个换行，服务端只会回一句签名校验失败 |
| `tests/unit/translate/service.test.ts` | 供应商解析与未知 id 回退；`auto` 本地判语种；**命中缓存不再调用**（同句第二次 `cached:true` 且供应商只被调一次）；源=目标短路（**一次都不调**）；空选直接拒绝；**设置载荷带出已存凭据**（供设置页预填与复制）与**清空字段 = 移除该键**；缺凭据抛 `ProviderConfigError` 且**不发请求**；朗读按「语言+文本」缓存、不同语言不串、厂商没有语音能力时报"不支持语音朗读"、超长文本在发请求前就被拦下 |
| `tests/unit/translate/detect.test.ts` | 本地语种判断：纯英文/纯中文、英文里夹中文词、中文里夹标识符、无字母数字时返回 null |
| `tests/unit/shared/toc.test.ts` | `toc.json` 的解析与校验（裸数组简写、缺 title、非正整数页号、死节点、嵌套深度、版本过高）；扁平化顺序与 id；**当前条目判定（含章与节同页时取更深的那个）**；祖先路径 |
| `tests/unit/shared/bookFile.test.ts` | 书籍 `meta.json` 契约：缺 title 不当错、未知键忽略、更高 `formatVersion` 拒绝、必需字段逐一拒绝、**`ocrFile` 不得跳出书文件夹**（`../`/子目录/盘符/绝对路径）、垃圾输入只报错不抛；写出的键序稳定且可往返 |
| `tests/unit/library/book.test.ts` | `openBook()`：1-based 页号对应数组下标 0、小 chunk 跨块结果不变；越界/非整数页号报错；**页数以 OCR 文件为准而不是 meta**；PDF 缺失仍可读；meta 缺失/非 JSON/缺 uid 报错；**`ocrFile` 跳出文件夹被拒**；封面名探测与 `toc.json` 读取 |
| `tests/unit/library/ledger.test.ts` | 书库台账：根内相对/根外绝对、**整库改名后相对路径仍可解析**、同一本不重复登记、**`remove()` 只删条目而文件夹仍在磁盘上**、手改坏的台账保住好条目并给出 issues、非 JSON 不崩、跨实例持久化 |
| `tests/unit/library/service.test.ts` | 扫描导入；二次扫描幂等；坏包不中断扫描；**有未保存编辑时拒绝重导入**；文件消失后清理索引；**保存把编辑写回包**；**PDF 逐字节不变**；**未建模的块键保留**；**建书时附上目录**；**坏目录在建书前就被拒绝**；**目录写入/移除**；**只改目录时 OCR 与封面不丢**；**保存与移除目录都不吃掉其他条目**；导入复制到库目录 |
| `tests/unit/migration/reconstruct.test.ts` | **黄金用例**（见第 4 节） |
| `tests/unit/renderer/assetUrl.test.ts` | `imgs/x.jpg` → `lbook://asset/<uid>/imgs/x.jpg`；绝对 URL 与协议相对 URL 不动；不误伤正文文本 |

### 两道硬闸

- `tests/unit/lbook/reader.test.ts` 里的 `readPdfRange(uid,0,8) === '%PDF-'`。**这一条过了，包内所有偏移计算就都是对的。**
- `tests/unit/lbook/zipIndex.test.ts` 里的 `book.pdf` 必须为 STORE。压缩的 PDF 会让阅读器退化成 O(n²)。

---

## 4. 黄金回归用例：迁移保真度

`tests/unit/migration/reconstruct.test.ts` 是整个套件里价值最高的一个。

**它比对什么**：把 `backend/lbook.db` 里第一本书的 `ocr_pages` + `ocr_blocks` 重建成 PaddleOCR JSON，与 `dev-data/Oxford Picture Dictionary 3 ed.ocr.json` 对比，要求 `dataInfo`、每页 `prunedResult`、每页 `markdown` **全部深度相等**（294 页 / 8609 块）。

**为什么重要**：这份 `dev-data` 里的 JSON 是这本书的**原始识别结果**，是唯一一份未经数据库中转的真相。如果重建算法漂移，比对会立刻失败——否则你会在几千个 block 已经悄悄变形之后才发现。

**为什么它可能被跳过**：`backend/lbook.db` 与 `dev-data/` 都不在版本控制里（前者是历史遗留的数据文件，后者被 `.gitignore` 忽略）。缺任一个，该 describe 块整体 skip。这是有意的——宁可不跑，也不要静默地"通过"。

**怎么重新启用**：迁移完成后 `backend/` 已按计划删除。要重新跑到这个用例，从迁移前的备份把旧库放回原位即可：

```bash
mkdir -p backend
cp "D:/我的项目/LBook-backup-20261001/backend/lbook.db" backend/
npm test
```

`dev-data/` 也需同时存在（它没有被删，一直在仓库里）。

**重建为什么是合并而不是替换**：块内容从 `ocr_blocks` 取（用户在 App 里改过，第 3 本书第 22、24 页共 5 处），但块对象里 DB 没有列的键（`global_block_id`、`global_group_id`、`block_polygon_points`）只能从 `pruned_result` 取。**两者都不能偏废**——只用 `pruned_result` 会静默回退用户的编辑，只用 `ocr_blocks` 会丢掉那三个键。`service.test.ts` 里有一条专门的用例锁住后者。

---

## 5. 依赖注入与临时目录约定

- 测试夹具用 `tests/helpers/temp.ts` 的 `createTestContext()` / `createLibraryTestContext()`，它们在 `os.tmpdir()` 下建独立目录，并在 `afterEach` 里清理。
- `.lbook` 夹具用 `tests/helpers/lbook.ts` 的 `buildLbook()`（基于 yazl，走正常写入路径）与 `writeRawZip()`（手工构造 ZIP，用于 yazl 拒绝生成的恶意条目名）。`buildLbook()` 的 `extra` 选项用来塞入 `toc.json` 这类可选条目。
- **绝不写真实的 `%APPDATA%\LBook` 或用户的库目录。**

---

## 6. 手工冒烟清单

自动化覆盖不到 UI 与真实文件，每次发版前按下表过一遍。

### 基本链路

1. `npm run dev` 启动
2. 首页能列出书本，封面缩略图正常显示
3. 打开一本**大书**（如 189MB 的那本）——注意窗口内存占用应保持平稳，DevTools 控制台**不应**出现 fake worker 警告
4. 翻页、缩放、Fit Width 正常
5. 切到 Flow 连续滚动模式，滚动流畅，侧栏跟随当前可见页
6. 侧栏切换 Blocks / Markdown 两个视图
7. **流式的按需绘制不能露出白页**：连续向下滚 6 屏，**视口内的每一页都必须已经有内容**（不能出现整页空白的占位纸）——这是"只画视口附近"这个优化的主要风险，数字见 `DESIGN.md` 4.3
8. 用页码框跳 +20 页、再跳回来：目标页应**几乎立刻**出现内容（瞬移，不是平滑滚过去），跳回看过的页**不应重新绘制**（画布被复用）
9. 单页模式下连续翻 10 页：每页都应即时出现内容，不应有某几页明显卡顿或长时间空白
10. 点目录里的条目跳转：跳到该条目所在页，且内容正常显示（跳转是瞬移）

### 目录树

11. 窗口顶部**不应**出现 File / Edit / View / Window 菜单栏，也**不应**有系统标题栏的文字与图标
12. **右上角三个窗口按钮是应用自绘的**：底与顶栏完全一致（不应出现色块，也不应有与下边线之间的缝隙）；悬停高亮**整条顶满**（从顶栏上沿到下沿，而不是浮在中间的小色块）
13. 悬停颜色：最小化与最大化是**淡灰**，关闭是**红色 `#E81123`**、叉号同时变白（这个红是我们自己画的，不是系统那种只有它变红）
14. 点最小化 → 窗口收进任务栏；点最大化 → 铺满且**图标变成"还原"**（双击顶栏、`Win+↑`、拖到屏幕边缘也应让图标同步切换）；点关闭 → 应用退出
15. 浅色与暗色下各看一遍第 8、9 条（暗色下最容易看出色差）
16. 拖动顶栏空白处能移动窗口；双击顶栏能最大化/还原
17. 左右两个栏的标题行下方**没有**分隔线，标题与内容连成一片
18. 工具栏最左侧的书目按钮能开关左侧目录栏；拖动它与 OCR 栏之间的分隔条可调整宽度
19. 打开一本带目录的书：章默认展开、节能直接点到，点击条目**跳到该章正文首页**（不是目录页）
20. 翻页时目录里当前阅读的条目高亮并自动滚入视野；手动折叠某章后，该章内的页只高亮到章这一级
21. 条目右侧显示的是**书本印的页号**，悬停提示同时给出 PDF 页号
22. OCR 栏默认是 **Markdown** 视图，且 Markdown 按钮在 Blocks **左边**；某页没有 markdown 时自动显示 Blocks 且 Blocks 高亮
23. 分栏时 OCR 栏右上角只有**占满**按钮，**没有**"收起"——收起归工具栏最右侧的按钮管
24. 点**占满**后 PDF 区与工具栏消失、右栏铺满；此时栏头**最左边**依次是「页码导航」「收起」，然后是分隔线与 Markdown/Blocks——右端仍只有原来的复制与还原两个按钮，位置不变
25. 点 header 里的"还原"回到分栏；点"收起"把整栏藏起来，工具栏最右侧的按钮把它叫回来
26. **占满 + 流式**：占满后切到流式（`⇅`），正文应立刻出现并能一直往下滚——每滚到底部自动续上 3 页，页码导航与目录高亮跟着走，**绝不能停在"Scroll to load pages..."**
27. 占满 + 流式下点目录条目、或用栏头翻页：应跳到该页并继续可滚动（从该页重新铺开 5 页）
28. 各处的滚动条**宽度是平台默认**（量法：滚动容器 `offsetWidth - clientWidth` 应等于 15），滑块颜色**比系统默认淡**：浅色主题下是浅灰（约 `#CECECE`，系统原生是 `#8B8B8B`），暗色下约 `#3D3D3D`（原生更亮更重）——注意颜色由 `scrollbar-color` 控制，`::-webkit-scrollbar-thumb` 在 Windows 11 上是被原生绘制覆盖的
29. **切换书本不应改动另一本的阅读进度**（曾经会把新书的页码写进旧书的行）：把 A 书设到某页 → 回首页 → 打开 B 书 → A 的行必须还是原来的页码；再切回 A，B 的行同理
30. 对没有目录的书，Edit 对话框里选一份合法 `toc.json` 并保存后，重开该书目录立即出现；选一份写错的 JSON 会看到"Not a valid table of contents: nodes[0]…"这样的报错，且书没有被动过
31. Edit 对话框里点"Remove current"再保存，目录确实空了，且 OCR 与封面仍在
32. 建书（Upload PDF）时同时选一份 `toc.json`，新书打开即有目录

### 翻译（腾讯云）

33. 点右上角的 **Bolt** 打开设置（**首页与阅读器里都有这个按钮**，阅读器里就在窗口按钮左边）：左侧有 General / Font / Translate 三个分区，且**每次都停在 General**（切到 Translate → 关闭 → 再打开，回到 General）
34. Translate 里填 SecretId / SecretKey（建议子账号密钥）→ 保存 → 重开设置：**两个框都预填着已存的值，SecretKey 显示为点**
35. SecretKey 框右侧的**小眼睛**切到明文后，值可以被选中复制；再点一次恢复成点
36. 清空 SecretKey 并保存 → "测试翻译"应报"缺少 SecretId / SecretKey"；把密钥填回去保存即恢复
37. 点"测试翻译"，应显示 `en → zh：会计是商业语言。`；再点一次应带"缓存"标记（不再计费）
38. 打开一本书 → OCR 栏切到 **Markdown** 视图 → 划选一句英文：小图标出现在**鼠标松开处水平居中**、并在**选区矩形的外侧**（鼠标在选区下半 → 图标在选区下方；上半 → 在上方），此时**不应**发生任何翻译；点图标才展开卡片并显示译文
39. 卡片长在图标那一侧（图标在上则卡片在上），**不遮住选区**；那一侧放不下时跨到选区另一侧
40. 卡片里原文与译文各有一个**喇叭**：点一下朗读；朗读中再点一次停止；重复点同一段应立刻出声（音频走内存缓存，不再合成）
41. 选中**超过 500 字符**（例如整页）或**纯数字/标点**（例如 `12.5%`、页码）时**不出图标**——这是照抄 Google 扩展的静默抑制（阈值 250 改成了 500），不是出错
42. 滚动侧栏、按 Esc、或在别处点击都会关掉图标与卡片
43. 检查语音资源包余量：朗读会消耗字符数（基础/精品音色免费包 800 万字符、3 个月有效、每账号一次）
44. 断网后划词应报网络错误，其余功能（翻页、目录、编辑）不受影响

### 主题（浅色 / 暗色）

45. 设置 → **General** → Appearance 有 Light / Dark / System 三张卡片，当前项高亮
46. 点 **Dark**：整窗立刻变暗（含首页列表、阅读器、侧栏正文、弹窗、滚动条），标题栏右侧的三个窗口按钮所在的那条也变暗（**不留白块**）
47. `%APPDATA%\LBook\config.json` 的 `theme` 变为 `dark`；**重启应用**后仍是暗色，且启动瞬间**不闪浅色**
48. 点 **System** 后在操作系统里切换浅色/暗色：应用应跟着变（无需重启）
49. 暗色下逐一确认：选中的翻译气泡、划词图标、块类型徽标（PARAGRAPH TITLE / TEXT 等）、未保存的琥珀色徽标都清晰可读；下拉框（服务商/语言）弹出层也是暗色的
50. **PDF 页面本身仍是白纸**——这是刻意保留的（反色会让表格与图不可信）
51. 暗色下页面周围的桌面是**纯黑、与页头同色**
52. **面板之间的拖拽条平时不可见**：左右两侧"面板—桌面"交界处不该有预留的竖带或竖缝——浅色下最容易看出来（桌面 `#f8fafc` 与白色面板只差一档，凭空多出 6px 就是一条缝）；鼠标移到边界上才浮出一条 6px 实色蓝带（`#0090f1`），按住拖动改宽度时同样是这条带
53. 命中区左右各只探进 3px，所以**面板贴边的滚动条还能拖**（不能被面板拖拽抢走）；拖动过程中宽度要跟手，松开即停
54. **PDF 工具栏下方那条分割线要从左侧目录面板一直连到右侧 OCR 面板**，两端不能各缺一小截；线宽 1px，三段的 y 必须对齐（差 1px 就能看出错位）

### 语言（英文 / 简体中文）

55. 设置 → **General** → Language：English / 简体中文 / 跟随系统 三张卡片，当前项高亮
56. 点 **简体中文**：界面文案立刻变中文（General 的说明、Font 分区、Translate 分区的字段标签与提示、划词卡片的按钮与状态）；`config.json` 的 `locale` 变为 `zh-CN`，**重启后仍然是中文**
57. 点 **English** 回到英文；点**跟随系统**时看当前生效那行写的是被解析出来的那个语言
58. **未翻译的 key 回落英文**，而不是显示 key 本身（例如选择弹窗里未列入词典的语言代码仍显示原代码）

### 字体（阅读区字号）
59. 设置 → **Font**：只有一个字号滑块（12–24px，默认 14），右侧跟着显示当前数值
60. **拖动滑块时阅读区的文字实时变化**（不用等松开鼠标），松手后 `%APPDATA%\LBook\config.json` 的 `readingFontSize` 才变成该值
61. 调到 **24px**：正文与 Markdown 的 h1/h2 标题、代码块、表格**一起变大**，且标题**不会**反而比正文小（尺寸都是相对的）
62. 点滑块右侧的 **↺** 回到 14px；当前已是默认值时该按钮禁用
63. 关掉设置面板后字号保持；Markdown 与 Blocks 两个视图同一个字号；**重启应用**后仍是这个大小

### 编辑与保存（Excel 模型）

64. 在侧栏编辑一个 block 的内容，点击确认
65. 顶栏书名右侧出现**琥珀色圆点**（有未保存修改；悬停提示 Ctrl+S）——顶栏已经没有 Save 按钮了
66. 按 `Ctrl+S` 保存，圆点消失
67. 返回首页——该书行上的 **Unsaved** 徽标消失
68. 关闭并重开该书，**编辑仍然在**
69. 用 7-Zip 打开该 `.lbook`，确认 `book.pdf` 的"方式"列是 **Store**，且 `ocr.json` / `toc.json` / 封面都还在
70. 再编辑一次，然后直接按"返回首页"，应弹出未保存确认

### 导入与资源

71. 用 "Upload PDF" 选一个 PDF + PaddleOCR JSON（可加封面），确认能建成书并立即打开
72. 用铅笔按钮替换 OCR JSON 与封面，确认生效
73. 把一个 `.lbook` 手工拖进库目录，重启应用后应被自动发现

### 存储与更新

74. 设置里把库目录改到另一个盘，确认书仍能打开（文件应已被搬走）
75. **断网启动**，确认不崩溃、不弹错误
76. 打包版：安装 → 运行 → 确认更新检查无报错

---

## 7. 不测什么，以及为什么

| 不测 | 原因 |
|---|---|
| React 组件渲染 | 需要 jsdom 或 Electron 环境，收益低于成本；UI 正确性靠第 6 节手工冒烟 |
| Electron 主进程启动 | 需要真实 Electron 进程；`main/index.ts` 被刻意写得很薄，逻辑都在可测模块里 |
| `electron-updater` 的真实更新流程 | 需要已发布的 Release；靠发版后的手工验证 |
| `lbook://` 协议处理 | 需要 Electron 的 `protocol` 模块；其依赖的读取逻辑（`reader.ts`）已被单元测试覆盖 |
| 并发写同一个库 | 单用户桌面应用，未做多实例互斥（见 `DESIGN.md` 已知限制） |

---

## 8. 相关文档

- 父级：[README.md](./README.md)
- 同级：[DESIGN.md](./DESIGN.md)、[BUILD.md](./BUILD.md)、[AGENTS.md](./AGENTS.md)
- 子目录：[tests/README.md](./tests/README.md)
