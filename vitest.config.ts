import { defineConfig } from "vitest/config"

// Tests cover the Node side only: the data layer, the .lbook reader/writer and
// the pure helpers. Everything under test takes its paths as arguments, so no
// Electron process is needed and no test ever touches the real %APPDATA%.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/main/**", "src/shared/**"],
    },
  },
})
