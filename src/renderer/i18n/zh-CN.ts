import type { TranslationKeys } from "./en"

/**
 * Simplified Chinese.
 *
 * Typed as `Record<TranslationKeys, string>`, which is the whole point: adding a
 * key to `en.ts` without translating it here fails the build, so a half-translated
 * screen cannot ship — the failure mode JSON dictionaries have.
 *
 * The wording aims at a reader, not a developer: "书库" for the library, "书文件夹"
 * for a book folder, "块" for an OCR block. Where English says something twice
 * ("Show contents (this book has none yet)"), Chinese says it once and plainly.
 */
export const zhCN: Record<TranslationKeys, string> = {
  // ---- shared -------------------------------------------------------------
  "common.open": "打开",
  "common.remove": "移除",
  "common.refresh": "刷新",
  "common.retry": "重试",
  "common.loading": "加载中…",
  "common.cancel": "取消",
  "common.close": "关闭",
  "common.search": "搜索",
  "common.showInFolder": "在文件管理器中显示",
  "common.openFile": "用系统默认程序打开该文件",
  "common.pages": "{{count}} 页",
  "common.save": "保存",
  "common.choose": "选择…",

  // ---- home (the library) -------------------------------------------------
  "home.search": "按书名搜索…",
  "home.results": "{{count}} 个结果",
  "home.sortNewest": "最新在前",
  "home.showing": "显示第 {{from}}–{{to}} 个，共 {{total}} 个",
  "home.previous": "上一页",
  "home.next": "下一页",
  "home.noMatch": "没有书名匹配“{{query}}”",
  "home.loading": "正在加载书库…",
  "home.loadFailed": "书库加载失败",
  "home.emptyTitle": "还没有书",
  "home.emptyBody":
    "添加一个书文件夹：里面有 book.pdf 与它的 PaddleOCR JSON，可选 toc.json 与封面。书可以放在任何位置——应用只记住路径，绝不复制或移动你的文件。",
  "home.addBook": "添加书文件夹",
  "home.refreshTitle": "重新读取书文件夹（你在自己的编辑器里改完，应用也会自己跟上）",
  "home.removeTitle": "从书库移除（不会删除文件）",
  "home.removeConfirm":
    "把“{{title}}”从书库移除？\n\n文件夹与其中的文件不会被删除——应用只是不再列出它。你随时可以把这个文件夹再加回来。",
  "home.unknownBook": "这本书",
  "home.leftoversTitle": "{{dir}} 里有 {{count}} 个旧的 .lbook 包",
  "home.leftoversBody":
    "这些是迁移前的旧包。现在的书是一个文件夹，而一次性转换器在全部书都搬完之后就删掉了（取回方法见 DESIGN.md 第 6.4 节）。应用不会动这里的任何东西。",
  "home.leftoversHint": "确认新布局没问题之后，你可以自己把它们删掉——应用永远不会替你删。",
  "home.leftoversShowFolder": "打开所在文件夹",
  "home.leftoversHide": "隐藏",
  "home.addFailed": "无法添加这个文件夹。",

  // ---- 新增与维护 ---------------------------------------------------------
  "addBook.title": "添加书籍",
  "addBook.tabFiles": "从文件新建",
  "addBook.tabFolder": "已有的书文件夹",
  "addBook.filesHint":
    "选扫描件与它的 PaddleOCR 输出；封面与目录可选。按下“创建”之前不会写任何东西，下面显示的名字与页数都来自文件本身。",
  "addBook.pdf": "PDF",
  "addBook.pdfHint": "扫描件本身",
  "addBook.ocr": "OCR JSON",
  "addBook.ocrHint": "PaddleOCR 的原始输出，逐字节拷贝",
  "addBook.cover": "封面",
  "addBook.toc": "目录",
  "addBook.optional": "可选",
  "addBook.choose": "选择…",
  "addBook.name": "书名",
  "addBook.nameFromFile": "取自 PDF 的文件名",
  "addBook.destination": "存放位置",
  "addBook.destinationHint":
    "书文件夹会建在这个目录里，名字取自书名。之后应用不会再移动或改名。",
  "addBook.browse": "浏览…",
  "addBook.willCreate": "将创建文件夹“{{name}}”",
  "addBook.create": "创建",
  "addBook.folderHint":
    "指向一个已经存在的书文件夹——别人给你的，或你自己搬过来的。里面散放的元数据（meta.json、ocr.json、toc.json、封面）会被移动进它的 .lbook 目录；book.pdf 留在原地。",
  "addBook.chooseFolder": "选择文件夹…",
  "addBook.movedFiles": "已把 {{count}} 个文件移进 .lbook/（{{name}}）",
  "addBook.alreadyKnown": "“{{name}}”已经在书库里",
  "addBook.previewFailed": "无法检查这些文件。",

  "editBook.title": "维护“{{name}}”",
  "editBook.hint":
    "替换这本书的四个文件之一，或者改书名。每次替换都会先校验再拷贝：不是它自称的那种文件会被拒绝，书仍用原来那份。",
  "editBook.name": "书名",
  "editBook.nameHint": "列表里显示的名字。磁盘上的文件夹名不会被改。",
  "editBook.ocr": "OCR JSON",
  "editBook.ocrHint": "替换后页数会跟着更新",
  "editBook.cover": "封面",
  "editBook.coverHint": "任意图片；旧封面会被删掉",
  "editBook.toc": "目录",
  "editBook.tocHint": "一个 toc.json，拷贝前会先校验",
  "editBook.pdf": "PDF",
  "editBook.pdfHint": "扫描件本身——换完注意它的页数是否仍与 OCR 文件对得上",
  "editBook.replace": "替换…",
  "editBook.showFolder": "打开文件夹",
  "editBook.fileReplaced": "已替换。",
  "editBook.titleSaved": "书名已保存。",

  // ---- 内容修正（编辑的是源码，不是渲染结果）----------------------------
  "block.edit": "编辑这个块的文字",
  "block.sourceHint":
    "正在编辑 ocr.json 里的源文——PaddleOCR 写下的原文，Markdown 与 HTML 都原样显示。",
  "block.saveHint": "Ctrl+Enter 保存，Esc 取消；点别处不会保存。",
  "block.saved": "已写入 ocr.json",
  "block.undo": "撤销这次修改",
  "block.reverted": "已恢复",
  "sidebar.editThisPage": "改这一页",
  "undo.action": "撤销上一次修改",
  "undo.nothing": "这本书还没有改过任何地方",
  "undo.block": "第 {{page}} 页的一段文字",
  "undo.markdown": "第 {{page}} 页的 Markdown",
  "undo.more": "还能再撤 {{more}} 处",
  "markdown.edit": "编辑这一页的 Markdown",
  "markdown.editing": "正在编辑：这一页的 Markdown",
  "markdown.sourceHint":
    "正在编辑 ocr.json 里的源文——PaddleOCR 写下的这一页原文。块视图读的是另一份，不会跟着变。",

  // 应用自己写的提示（厂商报错不翻译，I6）。主进程发来的是 key，英文原文作回落。
  "message.edit.bookGone": "这本书已经不在书库里了。",
  "message.edit.noPage": "这本书里没有这一页。",
  "message.edit.noBlock": "这一页上已经没有这个块了。",
  "message.edit.noMarkdown": "这一页没有 Markdown 文本。",
  "message.edit.notString": "那个字段不是文本，本版本不会去改它。",
  "message.edit.stale": "这段文字在编辑器打开之后变过。重新打开以看到当前版本。",
  "message.edit.readBack": "改动读不回来，文件保持了原样。",
  "message.edit.pageCount": "这次改动改变了页数，而内容修正不该改变页数。",

  // ---- one book's row -----------------------------------------------------
  "book.needsRepair": "需要修复",
  "book.check": "检查这本书的文件",
  "book.openFolder": "打开这个文件夹",
  "book.checkFailed": "检查失败：{{message}}",
  "book.allGood": "一切正常：meta.json、OCR 文件、book.pdf 与目录都能读。",
  "book.problems": "{{count}} 个问题",
  "book.problems_plural": "{{count}} 个问题",
  "book.warnings": "{{count}} 条提醒",
  "book.warnings_plural": "{{count}} 条提醒",
  "book.unreadable": "这本书目前读不了",
  "book.readableButOff": "这本书能读，但里面有东西不对",
  "book.byteOffset": "字节 {{offset}}",
  "book.cover": "封面",

  // ---- header and window chrome -------------------------------------------
  "header.backToLibrary": "回到书库",
  "header.settings": "设置",
  "header.addBook": "添加书籍",
  "window.minimize": "最小化",
  "window.maximize": "最大化",
  "window.restore": "还原",
  "window.close": "关闭",

  // ---- reading view -------------------------------------------------------
  "viewer.loading": "正在加载文档…",
  "viewer.loadFailed": "文档加载失败",
  "viewer.backToHome": "回到书库",
  "viewer.fitWidth": "适应宽度",
  "viewer.hideContents": "收起目录",
  "viewer.showContents": "展开目录",
  "viewer.showContentsNoToc": "展开目录（这本书还没有目录）",
  "viewer.hideOcrPanel": "收起 OCR 栏",
  "viewer.showOcrPanel": "展开 OCR 栏",
  "viewer.loadingPdf": "正在加载 PDF…",
  "viewer.failedToLoadPdf": "PDF 加载失败：{{message}}",

  // ---- the OCR panel ------------------------------------------------------
  "sidebar.blocks": "块",
  "sidebar.markdown": "Markdown",
  "sidebar.hide": "收起这个栏",
  "sidebar.loading": "正在加载 OCR 数据…",
  "sidebar.empty": "这一页没有 OCR 文本。",
  "sidebar.copyMarkdown": "复制 Markdown",
  "sidebar.copied": "已复制",
  "sidebar.scrollHint": "滚动以加载页面…",
  "sidebar.stats": "{{blocks}} 块 · {{text}} 文本 · {{chars}} 字",
  "sidebar.page": "第 {{page}} 页",
  "sidebar.pageLoading": "第 {{page}} 页——加载中…",
  "sidebar.noBlocks": "这一页没有块",
  "sidebar.chars": "{{count}} 字",
  "sidebar.hideOverlays": "隐藏页面上的块框",
  "sidebar.showOverlays": "显示页面上的块框",
  "sidebar.flowMode": "连续滚动翻页",
  "sidebar.expand": "让文本占满整个窗口",
  "sidebar.collapse": "把页面让回来",
  "sidebar.makeOverlaysTransparent": "让块框半透明",
  "sidebar.makeOverlaysOpaque": "让块框不透明",
  "sidebar.scrollMode": "切换为连续滚动",
  "sidebar.pageMode": "切换为逐页翻",
  "sidebar.copyAll": "复制这一页的全文",
  "sidebar.showPageAgain": "把页面显示回来",
  "sidebar.useFullWidth": "隐藏页面，让文本占满宽度",

  // ---- table of contents --------------------------------------------------
  "toc.title": "目录",
  "toc.loading": "正在加载目录…",
  "toc.empty": "这本书还没有目录。",
  "toc.emptyHint": "在书文件夹里放一个 toc.json 就有了。",

  // ---- blocks -------------------------------------------------------------
  "block.image": "图片块",
  "block.table": "表格块",
  "block.empty": "空块",

  // ---- page navigation ----------------------------------------------------
  "page.first": "第一页",
  "page.last": "最后一页",
  "page.of": "/ {{total}}",
  "page.goTo": "跳到页",

  // ---- messages -----------------------------------------------------------
  "error.bookGone": "这本书已经不在书库里了。",

  // ---- updates ------------------------------------------------------------
  "updates.ready": "LBook {{version}} 已就绪，退出时会自动安装。",
  "updates.restartNow": "立即重启",
  "updates.dismiss": "忽略",

  // ---- language names -----------------------------------------------------
  "language.auto": "自动识别",
  "language.zh": "简体中文",
  "language.en": "英语",
  "language.ja": "日语",
  "language.ko": "韩语",
  "language.fr": "法语",
  "language.de": "德语",
  "language.es": "西班牙语",
  "language.ru": "俄语",

  // ---- settings shell -----------------------------------------------------
  "settings.title": "设置",
  "settings.section.general": "通用",
  "settings.section.font": "字体",
  "settings.section.translate": "翻译",
  "settings.close": "关闭",

  // General.
  "settings.appearance.title": "外观",
  "settings.appearance.desc": "选择“跟随系统”时，跟随操作系统的浅色/暗色设置。这个选择会写进 config.json。",
  "settings.appearance.light": "浅色",
  "settings.appearance.dark": "暗色",
  "settings.appearance.system": "跟随系统",
  "settings.appearance.current": "当前生效：{{value}}",
  "settings.appearance.currentSystem": "跟随系统（{{value}}）",

  // Language.
  "settings.language.title": "语言",
  "settings.language.desc": "英文是基准，其余语言跟随它；还没翻译到的地方会回落成英文。",
  "settings.language.system": "跟随系统",
  "settings.language.current": "当前生效：{{value}}",
  "settings.language.currentSystem": "跟随系统（{{value}}）",

  // Font size.
  "settings.font.title": "字号",
  "settings.font.desc": "阅读栏里文字的大小（像素）。Markdown 与块视图共用这一个值。",
  "settings.font.range": "{{min}}–{{max}}px，默认 {{default}}。会写进 config.json，重启后仍然生效。",
  "settings.font.reset": "恢复默认",

  // Translate.
  "settings.translate.provider": "供应商",
  "settings.translate.providerDesc": "用哪家服务来翻译选中的文字。",
  "settings.translate.languages": "语言",
  "settings.translate.languagesDesc": "源语言选“自动识别”时，语种在本地根据选区判断。",
  "settings.translate.save": "保存",
  "settings.translate.test": "试一次翻译",
  "settings.translate.saved": "已保存",
  "settings.translate.clear": "清空（保存后生效）",
  "settings.translate.show": "显示",
  "settings.translate.hide": "隐藏",
  "settings.translate.secretPlaceholder": "留空并保存即可删除这个密钥",
  "settings.translate.testSample": "会计是商业的语言。",
  "settings.translate.testOk": "{{source}} → {{target}}：{{text}}",
  "settings.translate.testOkCached": "{{source}} → {{target}}：{{text}}（来自缓存）",

  // Selection popup.
  "translate.icon": "翻译选中的文字",
  "translate.speakSource": "朗读原文",
  "translate.speakTarget": "朗读译文",
  "translate.stopSpeaking": "停止朗读",
  "translate.copy": "复制译文",
  "translate.cached": "缓存",
  "translate.cachedHint": "来自本地缓存，没有发起请求",
  "translate.inProgress": "翻译中…",
  "translate.openSettings": "打开设置",

  // Provider field text.
  "provider.tencent.label": "腾讯云机器翻译",
  "provider.tencent.region": "地域",
  "provider.tencent.secretId.hint": "访问管理 → API 密钥管理。建议用只授了翻译权限的子账号密钥。",
  "provider.tencent.secretKey.hint": "仅创建时可见，创建后请立刻保存。",
}
