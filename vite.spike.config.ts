import { fileURLToPath } from "node:url"

import { defineConfig } from "vite"

const root = fileURLToPath(new URL("./src/renderer/spike", import.meta.url))

/**
 * A second, deliberately separate build for `npm run check:editor`.
 *
 * Why not a second entry in the app's own config: rolldown hoists a module shared by an
 * entry and a dynamic chunk into the **entry** chunk, and vite then preloads and
 * *evaluates* that chunk before the dynamic one. With Monaco the editor chunk ended up
 * importing the app's entry chunk, so the check page booted the whole interface into a
 * page with no root element. The check builds its own page from its own graph, and what it
 * measures is the editor, the protocol and the policy — not the app.
 */
export default defineConfig({
  root,
  base: "./",
  build: {
    outDir: fileURLToPath(new URL("./out/spike", import.meta.url)),
    emptyOutDir: true,
  },
})
