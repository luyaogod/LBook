import path from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const root = fileURLToPath(new URL("./src/renderer", import.meta.url))
const outDir = fileURLToPath(new URL("./out/renderer", import.meta.url))

// Renderer-only build. The main process and preload are built by scripts/build.mjs (esbuild).
export default defineConfig({
  root,
  // Relative base so the bundle works both from the app:// protocol and from file://
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(root),
      "@shared": path.resolve(root, "..", "shared"),
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
