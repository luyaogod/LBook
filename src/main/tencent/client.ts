import { signTencentRequest, type TencentApiRequest } from "./sign"

/**
 * The one place that talks to `*.tencentcloudapi.com`.
 *
 * Every product in Tencent Cloud API 3.0 shares the same envelope: sign the
 * request, POST JSON, and read either `Response` or `Response.Error`. Products
 * only differ in their action, version and payload, so one call path serves the
 * text-to-speech and translation clients alike.
 */

export interface TencentApiErrorBody {
  Code: string
  Message: string
}

/** Thrown for anything the API itself refused, with the pieces needed to debug it. */
export class TencentApiFailure extends Error {
  readonly code: string
  readonly requestId: string | null

  constructor(code: string, message: string, requestId: string | null) {
    super(`${code}: ${message}${requestId ? ` (RequestId ${requestId})` : ""}`)
    this.name = "TencentApiFailure"
    this.code = code
    this.requestId = requestId
  }
}

export interface CallOptions extends TencentApiRequest {
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface CallResult<T> {
  data: T
  requestId: string | null
}

export async function callTencentApi<T>(options: CallOptions): Promise<CallResult<T>> {
  const signed = signTencentRequest(options)
  const doFetch = options.fetchImpl ?? fetch

  // A hung request must not leave the UI spinning; every Tencent call is short.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000)
  let response: Response
  try {
    response = await doFetch(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
      signal: controller.signal,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new TencentApiFailure("NetworkError", `could not reach ${signed.url}: ${detail}`, null)
  } finally {
    clearTimeout(timeout)
  }

  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new TencentApiFailure(
      "InvalidResponse",
      `HTTP ${response.status}, body was not JSON: ${text.slice(0, 200)}`,
      null,
    )
  }

  const envelope = parsed as { Response?: Record<string, unknown> }
  const payload = envelope.Response
  if (!payload) {
    throw new TencentApiFailure("InvalidResponse", `no Response field: ${text.slice(0, 200)}`, null)
  }

  const requestId = typeof payload.RequestId === "string" ? payload.RequestId : null
  const errorBody = payload.Error as TencentApiErrorBody | undefined
  if (errorBody) {
    throw new TencentApiFailure(errorBody.Code, errorBody.Message, requestId)
  }

  return { data: payload as T, requestId }
}
