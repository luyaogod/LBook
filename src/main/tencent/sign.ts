import { createHash, createHmac } from "node:crypto"

/**
 * Tencent Cloud API 3.0 signing (TC3-HMAC-SHA256).
 *
 * Hand-rolled rather than pulled in from `tencentcloud-sdk-nodejs`: that package
 * is tens of megabytes of generated clients for a single pair of calls, and the
 * app ships as an offline installer (see DESIGN.md). The algorithm is fixed and
 * small, and `tests/unit/tencent/sign.test.ts` pins it to the worked example in
 * the vendor's own 签名方法 v3 documentation.
 *
 * Pure Node — no `electron`, no I/O — so it runs under Vitest.
 */

export interface TencentCredentials {
  secretId: string
  secretKey: string
  /** Only for temporary credentials (STS); sent as `X-TC-Token`. */
  token?: string
}

export interface TencentApiRequest {
  /** Product key, which is also the host prefix: "tts" -> tts.tencentcloudapi.com. */
  service: string
  /** e.g. "TextToVoice". */
  action: string
  /** e.g. "2019-08-23". */
  version: string
  region?: string
  payload: unknown
  credentials: TencentCredentials
  /** UNIX seconds. Injected so tests can pin it; defaults to now. */
  timestamp?: number
}

export interface SignedTencentRequest {
  url: string
  headers: Record<string, string>
  /** Exactly the bytes that were hashed; send these, not a re-serialization. */
  body: string
  canonicalRequest: string
  stringToSign: string
  signature: string
  credentialScope: string
  timestamp: number
}

export const ALGORITHM = "TC3-HMAC-SHA256"
/** Signing a subset is allowed, but these must match what is actually sent. */
export const SIGNED_HEADERS = "content-type;host;x-tc-action"
export const CONTENT_TYPE = "application/json; charset=utf-8"

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex")
}

export function hmacSha256(key: Buffer | string, message: string): Buffer {
  return createHmac("sha256", key).update(message, "utf8").digest()
}

/** `2019-02-25` for a UNIX timestamp — **UTC**, or calls fail between 00:00 and 08:00 CST. */
export function utcDateOf(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10)
}

export function signTencentRequest(request: TencentApiRequest): SignedTencentRequest {
  const { service, action, version, region, payload, credentials } = request
  const timestamp = request.timestamp ?? Math.floor(Date.now() / 1000)

  const host = `${service}.tencentcloudapi.com`
  const body = JSON.stringify(payload)
  const date = utcDateOf(timestamp)
  const credentialScope = `${date}/${service}/tc3_request`

  // Step 1 — canonical request. `join("\n")` on the headers block reproduces the
  // blank line the format requires before the signed-header list.
  const canonicalHeaders =
    `content-type:${CONTENT_TYPE}\n` + `host:${host}\n` + `x-tc-action:${action.toLowerCase()}\n`
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    SIGNED_HEADERS,
    sha256Hex(body),
  ].join("\n")

  // Step 2 — string to sign.
  const stringToSign = [ALGORITHM, timestamp, credentialScope, sha256Hex(canonicalRequest)].join("\n")

  // Step 3 — signature: derive a per-day, per-service key from the secret.
  const secretDate = hmacSha256(`TC3${credentials.secretKey}`, date)
  const secretService = hmacSha256(secretDate, service)
  const secretSigning = hmacSha256(secretService, "tc3_request")
  const signature = createHmac("sha256", secretSigning).update(stringToSign, "utf8").digest("hex")

  // Step 4 — authorization header.
  const authorization =
    `${ALGORITHM} Credential=${credentials.secretId}/${credentialScope}, ` +
    `SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`

  const headers: Record<string, string> = {
    Authorization: authorization,
    "Content-Type": CONTENT_TYPE,
    "X-TC-Action": action,
    "X-TC-Timestamp": String(timestamp),
    "X-TC-Version": version,
  }
  if (region) headers["X-TC-Region"] = region
  if (credentials.token) headers["X-TC-Token"] = credentials.token

  return { url: `https://${host}`, headers, body, canonicalRequest, stringToSign, signature, credentialScope, timestamp }
}
