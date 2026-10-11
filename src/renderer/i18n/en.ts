/**
 * English is the source of truth for the interface.
 *
 * Every key that can be shown to a user lives here first, and `i18next.d.ts`
 * types `t()` against this object — so a typo in a key is a compile error rather
 * than a missing label at runtime, which is the part JSON dictionaries normally
 * give up.
 *
 * Where a *provider* (translation vendor) carries its own field text, the key
 * lives here too and the provider keeps the English string inline as its
 * fallback. That way a third-party provider that ships no keys still renders.
 *
 * Two conventions worth keeping:
 *
 * - Keys are grouped by **where the reader sees them**, not by component: the
 *   library page (`home.*`), a book's row (`book.*`), the reading view
 *   (`viewer.*`, `sidebar.*`, `toc.*`), the chrome (`header.*`, `window.*`), and
 *   the messages nobody wants to see (`error.*`, `updates.*`).
 * - Anything with a number or a name in it uses i18next interpolation
 *   (`{{count}}`, `{{title}}`) rather than string concatenation, because word
 *   order is not shared between languages.
 */
export const en = {
  // ---- shared -------------------------------------------------------------
  "common.open": "Open",
  "common.remove": "Remove",
  "common.refresh": "Refresh",
  "common.retry": "Retry",
  "common.loading": "Loading…",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.search": "Search",
  "common.showInFolder": "Show in the file manager",
  "common.openFile": "Open this file in the program you use for it",
  "common.pages": "{{count}} pages",
  "common.save": "Save",
  "common.choose": "Choose…",

  // ---- home (the library) -------------------------------------------------
  "home.search": "Search by title…",
  "home.results": "{{count}} results",
  "home.sortNewest": "Newest First",
  "home.showing": "Showing {{from}}–{{to}} of {{total}} results",
  "home.previous": "Previous",
  "home.next": "Next",
  "home.noMatch": 'No documents match "{{query}}"',
  "home.loading": "Loading documents…",
  "home.loadFailed": "Failed to load documents",
  "home.emptyTitle": "No books yet",
  "home.emptyBody":
    "Add a book folder: it holds book.pdf and its PaddleOCR JSON, plus an optional toc.json and cover. The book can live anywhere — the app remembers the path and never copies or moves your files.",
  "home.addBook": "Add a book folder",
  "home.refreshTitle": "Read the book folders again (an edit in your own editor shows up on its own too)",
  "home.removeTitle": "Remove from the library (the files are not deleted)",
  "home.removeConfirm":
    'Remove "{{title}}" from the library?\n\nThe folder and the files inside it are NOT deleted — the app only stops listing it. You can add the folder again at any time.',
  "home.unknownBook": "this book",
  "home.leftoversTitle": "{{count}} old .lbook packages in {{dir}}",
  "home.leftoversBody":
    "These are the packages from before the migration. A book is a folder now, and the one-way converter was removed once every book had been moved (DESIGN.md 6.4 has it in git history). The app does not touch anything here.",
  "home.leftoversHint":
    "Once you are happy with the folder layout, delete them yourself — the app never will.",
  "home.leftoversShowFolder": "Show the folder",
  "home.leftoversHide": "Hide",
  "home.addFailed": "Could not add that folder.",

  // ---- adding and maintaining a book --------------------------------------
  "addBook.title": "Add a book",
  "addBook.tabFiles": "From files",
  "addBook.tabFolder": "An existing folder",
  "addBook.filesHint":
    "Pick the scan and its PaddleOCR output; the cover and the outline are optional. Nothing is written until you press Create, and the name and page count below come from the files themselves.",
  "addBook.pdf": "PDF",
  "addBook.pdfHint": "The scanned book itself",
  "addBook.ocr": "OCR JSON",
  "addBook.ocrHint": "PaddleOCR's own output, copied byte for byte",
  "addBook.cover": "Cover",
  "addBook.toc": "Table of contents",
  "addBook.optional": "Optional",
  "addBook.choose": "Choose…",
  "addBook.name": "Title",
  "addBook.nameFromFile": "Taken from the PDF's file name",
  "addBook.destination": "Where to put it",
  "addBook.destinationHint":
    "The book folder is created inside this one, named after the title. The app never moves or renames it afterwards.",
  "addBook.browse": "Browse…",
  "addBook.willCreate": "Will create the folder “{{name}}”",
  "addBook.create": "Create",
  "addBook.folderHint":
    "Point at a book folder that already exists — one somebody sent you, or one you moved here yourself. Anything loose in it (meta.json, ocr.json, toc.json, a cover) is moved into its .lbook directory; book.pdf stays where it is.",
  "addBook.chooseFolder": "Choose a folder…",
  "addBook.movedFiles": "Moved {{count}} file(s) into .lbook/ for “{{name}}”",
  "addBook.alreadyKnown": "“{{name}}” is already in the library",
  "addBook.previewFailed": "Could not check those files.",

  "editBook.title": "Maintain “{{name}}”",
  "editBook.hint":
    "Replace any of the book's four files, or rename it. Each replacement is validated before it is copied, so a file that is not what it claims to be is refused and the book keeps the one it had.",
  "editBook.name": "Title",
  "editBook.nameHint": "Shown in the library. The folder's name on disk is never changed.",
  "editBook.ocr": "OCR JSON",
  "editBook.ocrHint": "Replacing it updates the page count",
  "editBook.cover": "Cover",
  "editBook.coverHint": "Any image; the old cover is removed",
  "editBook.toc": "Table of contents",
  "editBook.tocHint": "A toc.json, checked before it is copied",
  "editBook.pdf": "PDF",
  "editBook.pdfHint": "The scan itself — check that its length still matches the OCR file",
  "editBook.replace": "Replace…",
  "editBook.showFolder": "Show the folder",
  "editBook.fileReplaced": "Replaced.",
  "editBook.titleSaved": "Title saved.",

  // ---- correcting content (the editors work on the source, not on a rendering) --
  "block.edit": "Edit this block's text",
  "block.sourceHint":
    "Editing the source that lives in ocr.json — the text exactly as PaddleOCR wrote it, Markdown and HTML included.",
  "block.saveHint": "Ctrl+Enter saves, Esc cancels. Clicking away does not save.",
  "block.saved": "Written to ocr.json",
  "block.undo": "Undo this edit",
  "block.reverted": "Put back",
  "sidebar.editThisPage": "Edit this page",
  "undo.action": "Undo the last change",
  "undo.nothing": "Nothing has been corrected in this book yet",
  "undo.block": "a block on page {{page}}",
  "undo.markdown": "the Markdown of page {{page}}",
  "undo.more": "{{more}} more can be undone",
  "markdown.edit": "Edit this page's Markdown",
  "markdown.editing": "Editing this page's Markdown",
  "markdown.sourceHint":
    "Editing the source in ocr.json — the page as PaddleOCR wrote it. The Blocks view reads its own copy and will not change.",

  // Messages this app writes itself. A vendor's error text is not translated (I6);
  // these are ours, and they arrive from main as a key with English as the fallback.
  "message.edit.bookGone": "This book is no longer in the library.",
  "message.edit.noPage": "That page is not in this book.",
  "message.edit.noBlock": "That block is no longer on this page.",
  "message.edit.noMarkdown": "This page has no markdown text.",
  "message.edit.notString": "That field is not text, so this build will not touch it.",
  "message.edit.stale":
    "This text changed after the editor was opened. Reopen it to see the current version.",
  "message.edit.readBack":
    "The edit could not be read back, so the file was left exactly as it was.",
  "message.edit.pageCount":
    "That edit changed the page count, which correcting content must not do.",

  // ---- one book's row -----------------------------------------------------
  "book.needsRepair": "Needs repair",
  "book.check": "Check this book's files",
  "book.openFolder": "Open this folder",
  "book.checkFailed": "Could not check this book: {{message}}",
  "book.allGood": "Everything checks out: meta.json, the OCR file, book.pdf and the outline all read.",
  "book.problems": "{{count}} problem",
  "book.problems_plural": "{{count}} problems",
  "book.warnings": "{{count}} warning",
  "book.warnings_plural": "{{count}} warnings",
  "book.unreadable": "this book cannot be read as it is",
  "book.readableButOff": "this book reads, but something in it is off",
  "book.byteOffset": "byte {{offset}}",
  "book.cover": "Cover",

  // ---- header and window chrome -------------------------------------------
  "header.backToLibrary": "Back to library",
  "header.settings": "Settings",
  "header.addBook": "Add book",
  "window.minimize": "Minimize",
  "window.maximize": "Maximize",
  "window.restore": "Restore",
  "window.close": "Close",

  // ---- reading view -------------------------------------------------------
  "viewer.loading": "Loading document…",
  "viewer.loadFailed": "Failed to load document",
  "viewer.backToHome": "Back to Home",
  "viewer.fitWidth": "Fit width",
  "viewer.hideContents": "Hide contents",
  "viewer.showContents": "Show contents",
  "viewer.showContentsNoToc": "Show contents (this book has none yet)",
  "viewer.hideOcrPanel": "Hide the OCR panel",
  "viewer.showOcrPanel": "Show the OCR panel",
  "viewer.loadingPdf": "Loading PDF…",
  "viewer.failedToLoadPdf": "Failed to load the PDF: {{message}}",

  // ---- the OCR panel ------------------------------------------------------
  "sidebar.blocks": "Blocks",
  "sidebar.markdown": "Markdown",
  "sidebar.hide": "Hide this panel",
  "sidebar.loading": "Loading OCR data…",
  "sidebar.empty": "No OCR text for this page.",
  "sidebar.copyMarkdown": "Copy Markdown",
  "sidebar.copied": "Copied",
  "sidebar.scrollHint": "Scroll to load pages…",
  "sidebar.stats": "{{blocks}} blocks · {{text}} text · {{chars}} chars",
  "sidebar.page": "Page {{page}}",
  "sidebar.pageLoading": "Page {{page}} — loading…",
  "sidebar.noBlocks": "No blocks on this page",
  "sidebar.chars": "{{count}} chars",
  "sidebar.hideOverlays": "Hide the block outlines on the page",
  "sidebar.showOverlays": "Show the block outlines on the page",
  "sidebar.flowMode": "Keep scrolling through pages",
  "sidebar.expand": "Give the text the whole window",
  "sidebar.collapse": "Bring the page back",
  "sidebar.makeOverlaysTransparent": "Make the block outlines transparent",
  "sidebar.makeOverlaysOpaque": "Make the block outlines opaque",
  "sidebar.scrollMode": "Switch to continuous scrolling",
  "sidebar.pageMode": "Switch to page-by-page",
  "sidebar.copyAll": "Copy the text of this page",
  "sidebar.showPageAgain": "Show the page again",
  "sidebar.useFullWidth": "Hide the page and use the full width",

  // ---- table of contents --------------------------------------------------
  "toc.title": "Contents",
  "toc.loading": "Loading contents…",
  "toc.empty": "No table of contents for this book.",
  "toc.emptyHint": "Add one by putting a toc.json in the book folder.",

  // ---- blocks -------------------------------------------------------------
  "block.image": "Image block",
  "block.table": "Table block",
  "block.empty": "Empty",

  // ---- page navigation ----------------------------------------------------
  "page.first": "First page",
  "page.last": "Last page",
  "page.of": "of {{total}}",
  "page.goTo": "Go to page",

  // ---- messages -----------------------------------------------------------
  "error.bookGone": "This book is no longer in the library.",
  // The four below are console diagnostics for a failed render, deliberately not
  // translated: they are read by whoever debugs the renderer, not by a reader.

  // ---- updates ------------------------------------------------------------
  "updates.ready": "LBook {{version}} is ready. It will install when you quit.",
  "updates.restartNow": "Restart now",
  "updates.dismiss": "Dismiss",

  // ---- language names (shared by settings and the selection popup) --------
  "language.auto": "Auto-detect",
  "language.zh": "Chinese (Simplified)",
  "language.en": "English",
  "language.ja": "Japanese",
  "language.ko": "Korean",
  "language.fr": "French",
  "language.de": "German",
  "language.es": "Spanish",
  "language.ru": "Russian",

  // ---- settings shell -----------------------------------------------------
  "settings.title": "Settings",
  "settings.section.general": "General",
  "settings.section.font": "Font",
  "settings.section.translate": "Translate",
  "settings.close": "Close",

  // General.
  "settings.appearance.title": "Appearance",
  "settings.appearance.desc":
    "With System, follows the operating system's light/dark setting. The choice is written to config.json.",
  "settings.appearance.light": "Light",
  "settings.appearance.dark": "Dark",
  "settings.appearance.system": "System",
  "settings.appearance.current": "Currently: {{value}}",
  "settings.appearance.currentSystem": "System ({{value}})",

  // Language.
  "settings.language.title": "Language",
  "settings.language.desc":
    "English is the source of truth; other languages follow it, and anything not translated yet falls back to English.",
  "settings.language.system": "Follow the system",
  "settings.language.current": "Currently: {{value}}",
  "settings.language.currentSystem": "System ({{value}})",

  // Font size.
  "settings.font.title": "Font size",
  "settings.font.desc": "Size of the text in the reading panel, in pixels. Markdown and Blocks share it.",
  "settings.font.range": "{{min}}–{{max}}px, default {{default}}. Written to config.json, so it survives a restart.",
  "settings.font.reset": "Reset to default",

  // Translate.
  "settings.translate.provider": "Provider",
  "settings.translate.providerDesc": "Which service translates a selection.",
  "settings.translate.languages": "Languages",
  "settings.translate.languagesDesc":
    'With the source set to "Auto-detect", the language is decided locally from the selection.',
  "settings.translate.save": "Save",
  "settings.translate.test": "Test translation",
  "settings.translate.saved": "Saved",
  "settings.translate.clear": "Clear (takes effect when saved)",
  "settings.translate.show": "Show",
  "settings.translate.hide": "Hide",
  "settings.translate.secretPlaceholder": "Leave empty and save to remove this key",
  "settings.translate.testSample": "Accounting is the language of business.",
  "settings.translate.testOk": "{{source}} → {{target}}: {{text}}",
  "settings.translate.testOkCached": "{{source}} → {{target}}: {{text}} (cached)",

  // Selection popup.
  "translate.icon": "Translate the selected text",
  "translate.speakSource": "Read the original",
  "translate.speakTarget": "Read the translation",
  "translate.stopSpeaking": "Stop reading",
  "translate.copy": "Copy the translation",
  "translate.cached": "cached",
  "translate.cachedHint": "Answered from the local cache; no request was made",
  "translate.inProgress": "Translating…",
  "translate.openSettings": "Open settings",

  // Provider field text (vendors keep an English fallback inline).
  "provider.tencent.label": "Tencent Cloud",
  "provider.tencent.region": "Region",
  "provider.tencent.secretId.hint":
    "Access Management → API Keys. A sub-account key limited to translation is best.",
  "provider.tencent.secretKey.hint": "Shown once at creation; save it immediately.",
} as const

export type TranslationKeys = keyof typeof en
