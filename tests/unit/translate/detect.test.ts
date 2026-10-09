import { describe, expect, it } from "vitest"
import { detectLanguage } from "../../../src/main/translate/detect"

describe("detectLanguage", () => {
  it("recognises the two languages this app reads", () => {
    expect(detectLanguage("Accounting is the language of business.")).toBe("en")
    expect(detectLanguage("会计是商业语言。")).toBe("zh")
  })

  it("treats mostly-Latin text with a Chinese term as English", () => {
    // A textbook line: English prose quoting a Chinese term.
    expect(detectLanguage('The term "会计" means accounting.')).toBe("en")
  })

  it("treats mostly-Chinese text with a code identifier as Chinese", () => {
    expect(detectLanguage("调用 accountAPI 后返回结果。")).toBe("zh")
  })

  it("returns null when there is nothing to judge by", () => {
    expect(detectLanguage("1234 —— ！？")).toBeNull()
    expect(detectLanguage("")).toBeNull()
  })
})
