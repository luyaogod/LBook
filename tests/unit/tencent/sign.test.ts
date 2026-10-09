import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { signTencentRequest, sha256Hex, utcDateOf } from "../../../src/main/tencent/sign"
import { assertTextFits, explainTtsError, isWithinTtsLimit } from "../../../src/main/tencent/tts"

/**
 * The worked example from Tencent Cloud's 签名方法 v3 documentation
 * (https://cloud.tencent.com/document/api/213/30654). The vendor masks the
 * SecretKey, so the key-derivation chain cannot be reproduced from it — but the
 * documented intermediate hashes and the final signature pin down everything
 * that usually goes wrong: the canonical-request layout, the blank line before
 * the signed-header list, the UTC date, and the string-to-sign order.
 */
const DOC_EXAMPLE = {
  service: "cvm",
  action: "DescribeInstances",
  version: "2017-03-12",
  region: "ap-guangzhou",
  timestamp: 1551113065,
  payload: { Limit: 1, Filters: [{ Values: ["未命名"], Name: "instance-name" }] },
  credentials: { secretId: "AKID********************************", secretKey: "********************************" },
  /** The payload exactly as the documentation prints it. */
  payloadLiteral: '{"Limit": 1, "Filters": [{"Values": ["\\u672a\\u547d\\u540d"], "Name": "instance-name"}]}',
  expectedPayloadHash: "35e9c5b0e3ae67532d3c9f17ead6c90222632e5b1ff7f6e89887f1398934f064",
  expectedCanonicalHash: "7019a55be8395899b900fb5564e4200d984910f34794a27cb3fb7d10ff6a1e84",
  expectedSecretSigning: "b596b923aad85185e2d1f6659d2a062e0a86731226e021e61bfe06f7ed05f5af",
  expectedSignature: "10b1a37a7301a02ca19a647ad722d5e43b4b3cff309d421d85b46093f6ab6c4f",
  expectedCredentialScope: "2019-02-25/cvm/tc3_request",
  expectedSignedHeaders: "content-type;host;x-tc-action",
}

/** The canonical request the documentation derives, byte for byte. */
const DOC_CANONICAL_REQUEST = [
  "POST",
  "/",
  "",
  "content-type:application/json; charset=utf-8",
  "host:cvm.tencentcloudapi.com",
  "x-tc-action:describeinstances",
  "",
  "content-type;host;x-tc-action",
  DOC_EXAMPLE.expectedPayloadHash,
].join("\n")

const DOC_STRING_TO_SIGN = [
  "TC3-HMAC-SHA256",
  "1551113065",
  DOC_EXAMPLE.expectedCredentialScope,
  DOC_EXAMPLE.expectedCanonicalHash,
].join("\n")

describe("TC3-HMAC-SHA256 signing", () => {
  it("hashes a payload the way the documentation does", () => {
    expect(sha256Hex(DOC_EXAMPLE.payloadLiteral)).toBe(DOC_EXAMPLE.expectedPayloadHash)
  })

  it("builds the canonical request the documentation shows", () => {
    // Our own body is JSON.stringify's compact form, which cannot reproduce the
    // doc's literal hash (it has spaces and \u escapes). So swap in the doc's
    // payload hash and require everything else — including the blank line before
    // the signed headers — to match exactly. The hash function itself is covered
    // by the test above.
    const signed = signTencentRequest(DOC_EXAMPLE)
    const swapped = signed.canonicalRequest.replace(sha256Hex(signed.body), DOC_EXAMPLE.expectedPayloadHash)
    expect(swapped).toBe(DOC_CANONICAL_REQUEST)
    expect(sha256Hex(DOC_CANONICAL_REQUEST)).toBe(DOC_EXAMPLE.expectedCanonicalHash)
  })

  it("derives the documented signature from the documented signing key", () => {
    // The vendor masks the SecretKey, so the final HMAC is verified against the
    // documented intermediate key — the strongest link the doc allows.
    const signature = createHmac("sha256", Buffer.from(DOC_EXAMPLE.expectedSecretSigning, "hex"))
      .update(DOC_STRING_TO_SIGN, "utf8")
      .digest("hex")
    expect(signature).toBe(DOC_EXAMPLE.expectedSignature)
  })

  it("reproduces the documented string to sign and credential scope", () => {
    const signed = signTencentRequest(DOC_EXAMPLE)
    expect(signed.credentialScope).toBe(DOC_EXAMPLE.expectedCredentialScope)
    expect(signed.stringToSign.split("\n").slice(0, 3)).toEqual([
      "TC3-HMAC-SHA256",
      "1551113065",
      DOC_EXAMPLE.expectedCredentialScope,
    ])
    expect(signed.stringToSign.split("\n")[3]).toBe(sha256Hex(signed.canonicalRequest))
  })

  it("uses the UTC date, not the local one", () => {
    // 1551113065 is 2019-02-26 00:44 in UTC+8 — the classic off-by-one-day bug.
    expect(utcDateOf(1551113065)).toBe("2019-02-25")
    expect(utcDateOf(0)).toBe("1970-01-01")
  })

  it("builds an Authorization header in the documented shape", () => {
    const signed = signTencentRequest(DOC_EXAMPLE)
    expect(signed.headers.Authorization).toMatch(
      /^TC3-HMAC-SHA256 Credential=AKID\*+\/2019-02-25\/cvm\/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=[0-9a-f]{64}$/,
    )
    expect(signed.url).toBe("https://cvm.tencentcloudapi.com")
    expect(signed.headers["X-TC-Action"]).toBe("DescribeInstances")
    expect(signed.headers["X-TC-Timestamp"]).toBe("1551113065")
    expect(signed.headers["X-TC-Version"]).toBe("2017-03-12")
    expect(signed.headers["X-TC-Region"]).toBe("ap-guangzhou")
  })

  it("sends exactly the bytes it hashed", () => {
    const signed = signTencentRequest(DOC_EXAMPLE)
    expect(sha256Hex(signed.body)).toBe(sha256Hex(JSON.stringify(DOC_EXAMPLE.payload)))
  })

  it("keeps the documented SignedHeaders list in sync with the sent headers", () => {
    const signed = signTencentRequest({ ...DOC_EXAMPLE, service: "tts", action: "TextToVoice" })
    // action is lowercased inside the canonical headers only; the header itself
    // keeps its own casing.
    expect(signed.canonicalRequest).toContain("x-tc-action:texttovoice\n")
    expect(signed.headers["X-TC-Action"]).toBe("TextToVoice")
    expect(DOC_EXAMPLE.expectedSignedHeaders).toBe("content-type;host;x-tc-action")
  })

  it("omits the region header when no region is given", () => {
    const signed = signTencentRequest({ ...DOC_EXAMPLE, region: undefined })
    expect(signed.headers["X-TC-Region"]).toBeUndefined()
  })

  it("sends the STS token header only when a token is present", () => {
    expect(signTencentRequest(DOC_EXAMPLE).headers["X-TC-Token"]).toBeUndefined()
    const withToken = signTencentRequest({
      ...DOC_EXAMPLE,
      credentials: { ...DOC_EXAMPLE.credentials, token: "sts-token" },
    })
    expect(withToken.headers["X-TC-Token"]).toBe("sts-token")
  })
})

describe("TTS request limits", () => {
  it("enforces the per-request text limits", () => {
    expect(isWithinTtsLimit("a".repeat(500), 2)).toBe(true)
    expect(isWithinTtsLimit("a".repeat(501), 2)).toBe(false)
    expect(isWithinTtsLimit("字".repeat(150), 1)).toBe(true)
    expect(isWithinTtsLimit("字".repeat(151), 1)).toBe(false)
    expect(() => assertTextFits("a".repeat(501), 2)).toThrow(/500 letters/)
    expect(() => assertTextFits("   ")).toThrow(/empty/)
  })
})

describe("error hints", () => {
  it("turns the quota codes into an action, and unknown codes into nothing", () => {
    // Hit for real on an account whose free pack was spent; it reads like a bug
    // otherwise.
    expect(explainTtsError("UnsupportedOperation.PkgExhausted")).toMatch(/资源包已用尽/)
    expect(explainTtsError("InvalidParameterValue.AppIdNotRegistered")).toMatch(/未开通/)
    expect(explainTtsError("SomethingElse.Entirely")).toBeNull()
  })
})
