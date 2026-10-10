import type { TranslationKeys } from "./en"

/**
 * 简体中文。
 *
 * Typed as `Record<TranslationKeys, string>`, so a new key in `en.ts` fails the
 * build until it is translated here. That is on purpose: the alternative
 * (missing keys silently falling back) is how a half-translated interface
 * survives to a release.
 */
export const zhCN: Record<TranslationKeys, string> = {
  "language.auto": "自动检测",
  "language.zh": "中文（简体）",
  "language.en": "英语",
  "language.ja": "日语",
  "language.ko": "韩语",
  "language.fr": "法语",
  "language.de": "德语",
  "language.es": "西班牙语",
  "language.ru": "俄语",

  "settings.title": "设置",
  "settings.close": "关闭",

  "settings.appearance.title": "外观",
  "settings.appearance.desc": "跟随系统时，随操作系统的浅色/暗色自动切换。选择会写进 config.json。",
  "settings.appearance.light": "浅色",
  "settings.appearance.dark": "暗色",
  "settings.appearance.system": "跟随系统",
  "settings.appearance.current": "当前生效：{{value}}",
  "settings.appearance.currentSystem": "跟随系统（{{value}}）",

  "settings.language.title": "语言",
  "settings.language.desc": "英文是基准；其他语言跟随它，尚未翻译的部分回落到英文。",
  "settings.language.system": "跟随系统",
  "settings.language.current": "当前生效：{{value}}",
  "settings.language.currentSystem": "跟随系统（{{value}}）",

  "settings.font.title": "字体大小",
  "settings.font.desc": "阅读区文字的大小，单位为像素。Markdown 与 Blocks 两个视图共用这一档字号。",
  "settings.font.range": "{{min}}–{{max}}px，默认 {{default}}px。改动写进 config.json，重启后仍然有效。",
  "settings.font.reset": "恢复默认",

  "settings.translate.provider": "服务商",
  "settings.translate.providerDesc": "划词翻译走哪家的接口。",
  "settings.translate.languages": "语言",
  "settings.translate.languagesDesc": "源语言选“自动检测”时，按选中文字在本地判断。",
  "settings.translate.save": "保存",
  "settings.translate.test": "测试翻译",
  "settings.translate.saved": "已保存",
  "settings.translate.clear": "清除（保存后生效）",
  "settings.translate.show": "显示",
  "settings.translate.hide": "隐藏",
  "settings.translate.secretPlaceholder": "留空并保存 = 移除该密钥",
  "settings.translate.testSample": "Accounting is the language of business.",
  "settings.translate.testOk": "{{source}} → {{target}}：{{text}}",
  "settings.translate.testOkCached": "{{source}} → {{target}}：{{text}}（缓存）",

  "translate.icon": "翻译选中的文字",
  "translate.speakSource": "朗读原文",
  "translate.speakTarget": "朗读译文",
  "translate.stopSpeaking": "停止朗读",
  "translate.copy": "复制译文",
  "translate.cached": "缓存",
  "translate.cachedHint": "来自本地缓存，未调用接口",
  "translate.inProgress": "翻译中…",
  "translate.openSettings": "去设置",

  "provider.tencent.label": "腾讯云机器翻译",
  "provider.tencent.region": "地域",
  "provider.tencent.secretId.hint": "访问管理 → API 密钥管理。建议用只授了翻译权限的子账号密钥。",
  "provider.tencent.secretKey.hint": "仅创建时可见，创建后请立刻保存。",
}
