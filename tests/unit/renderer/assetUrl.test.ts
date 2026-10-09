import { describe, expect, it } from "vitest"
import { assetUrl, coverUrl, resolveAssetUrls } from "../../../src/shared/urls"

describe("coverUrl", () => {
  it("addresses the package cover by uid", () => {
    expect(coverUrl("abc123")).toBe("lbook://cover/abc123")
  })
})

describe("assetUrl", () => {
  it("addresses an entry inside the package", () => {
    expect(assetUrl("abc", "imgs/photo.jpg")).toBe("lbook://asset/abc/imgs/photo.jpg")
  })

  it("encodes each path segment without flattening the separators", () => {
    expect(assetUrl("abc", "imgs/a b&c.jpg")).toBe("lbook://asset/abc/imgs/a%20b%26c.jpg")
  })

  it("tolerates a leading slash", () => {
    expect(assetUrl("abc", "/imgs/x.jpg")).toBe("lbook://asset/abc/imgs/x.jpg")
  })
})

describe("resolveAssetUrls", () => {
  it("rewrites a relative image source", () => {
    expect(resolveAssetUrls('<img src="imgs/x.jpg">', "uid1")).toBe(
      '<img src="lbook://asset/uid1/imgs/x.jpg">',
    )
  })

  it("rewrites every image in a document", () => {
    const html = '<p>a</p><img src="imgs/1.png"><img class="x" src=\'imgs/2.png\'>'
    const out = resolveAssetUrls(html, "u")
    expect(out).toContain("lbook://asset/u/imgs/1.png")
    expect(out).toContain("lbook://asset/u/imgs/2.png")
  })

  it("leaves absolute URLs alone so the CSP keeps blocking them", () => {
    const html =
      '<img src="https://evil.example/x.jpg"><img src="http://evil.example/y.jpg"><img src="data:image/png;base64,AAA">'
    expect(resolveAssetUrls(html, "u")).toBe(html)
  })

  it("leaves protocol-relative URLs alone", () => {
    const html = '<img src="//cdn.example/x.jpg">'
    expect(resolveAssetUrls(html, "u")).toBe(html)
  })

  it("does not touch text that merely looks like a path", () => {
    const html = "<p>see imgs/x.jpg for details</p>"
    expect(resolveAssetUrls(html, "u")).toBe(html)
  })

  it("handles single and double quoted attributes", () => {
    expect(resolveAssetUrls("<img src='imgs/a.jpg'>", "u")).toBe(
      "<img src='lbook://asset/u/imgs/a.jpg'>",
    )
  })
})
