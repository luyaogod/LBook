/**
 * Local language guessing.
 *
 * Tencent's `LanguageDetect` interface was withdrawn with the rest of the TMT
 * text APIs (see the 2026-07-08 release notes), so "auto" cannot be delegated.
 * For the job at hand — a Chinese reader highlighting English text, or the
 * reverse — the CJK ratio is enough, and it costs nothing and never fails.
 */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const LATIN = /[A-Za-z]/

/**
 * Returns "zh", "en", or null when there is nothing to judge by.
 *
 * The threshold is deliberately low: a line of mostly-Latin text with one quoted
 * Chinese word is English, and a line of mostly-Chinese text with one variable
 * name is Chinese.
 */
export function detectLanguage(text: string): "zh" | "en" | null {
  let cjk = 0
  let latin = 0
  for (const char of text) {
    if (CJK.test(char)) cjk += 1
    else if (LATIN.test(char)) latin += 1
  }
  if (cjk === 0 && latin === 0) return null
  return cjk / (cjk + latin) >= 0.3 ? "zh" : "en"
}
