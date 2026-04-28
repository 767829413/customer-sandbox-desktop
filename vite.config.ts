import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Tauri expects a fixed dev port and doesn't need clear-screen
// (logs from cargo would otherwise get nuked).
export default defineConfig({
  plugins: [solid()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  // Vite envs the Tauri runtime injects; surfacing them here lets
  // the frontend `import.meta.env.TAURI_*` without warnings.
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
