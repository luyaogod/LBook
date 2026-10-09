import type { TranslateProviderInfo } from "../../shared/translate"

/**
 * The contract every translation vendor implements.
 *
 * A provider is a plain object: it describes its own settings fields so the UI
 * needs no vendor knowledge, and it turns text into text. Nothing else in the app
 * knows the name "tencent" — adding a vendor means adding one file and one entry
 * in `providers/index.ts`.
 *
 * Pure Node: the HTTP call is injected (`fetchImpl`) so tests never hit the network.
 */

export interface TranslateCallInput {
  text: string
  /** Concrete language code; "auto" is resolved before a provider is called. */
  source: string
  target: string
}

export interface TranslateCallResult {
  text: string
  source: string
  target: string
}

export type ProviderCredentials = Record<string, string>

export interface SpeakCallInput {
  text: string
  /** Language code of the text to read, e.g. "en". */
  language: string
}

export interface SpeakCallResult {
  audio: Buffer
  /** MIME type for the renderer's Blob URL, e.g. "audio/mpeg". */
  mime: string
}

export interface TranslateProvider extends TranslateProviderInfo {
  translate(
    input: TranslateCallInput,
    credentials: ProviderCredentials,
    fetchImpl?: typeof fetch,
  ): Promise<TranslateCallResult>

  /**
   * Reads text aloud. Optional: plenty of translation vendors have no speech
   * service, and the UI simply hides the speaker buttons when it is missing.
   */
  speak?(
    input: SpeakCallInput,
    credentials: ProviderCredentials,
    fetchImpl?: typeof fetch,
  ): Promise<SpeakCallResult>
}

/** Thrown by a provider when the user has not filled in what it needs. */
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProviderConfigError"
  }
}
