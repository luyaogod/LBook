import type { TranslateResult } from "@shared/translate"

/**
 * Thin wrapper over the preload bridge, matching the shape of `api/pdfs.ts`.
 *
 * The renderer never learns which vendor answered, and never sees credentials.
 */
export function translateText(input: { text: string; source?: string; target?: string }): Promise<TranslateResult> {
  return window.api.translate.text(input)
}

/** Reads text aloud; resolves to MP3 bytes the caller turns into a Blob URL. */
export function speakText(input: { text: string; language: string }): Promise<{ audio: Uint8Array; mime: string }> {
  return window.api.translate.speak(input)
}

/**
 * Synthesizes text and returns a playable object URL.
 *
 * The bytes arrive through `contextBridge`, which hands back a **proxy** around
 * the typed array. A proxy has no internal slots, so `new Blob([audio])` would
 * silently fall back to stringifying it and the element then fails with "no
 * supported source was found". Copying element by element builds a genuine
 * `Uint8Array` in this realm, which the Blob constructor accepts.
 */
export async function speakToObjectUrl(input: { text: string; language: string }): Promise<string> {
  const { audio, mime } = await speakText(input)
  const source = audio as unknown as ArrayLike<number>
  const bytes = new Uint8Array(source.length)
  for (let index = 0; index < source.length; index += 1) bytes[index] = source[index]
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}
