import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The UI only ever calls same-origin /api/*; the dev and preview servers proxy it to the local
// LeakGate API. Override the target with VITE_API_TARGET (e.g. a second API on another port).
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const target = env.VITE_API_TARGET || "http://127.0.0.1:8100";
  const proxy = { "/api": { target, changeOrigin: true } };

  return {
    plugins: [react(), tailwindcss()],
    server: { host: "127.0.0.1", port: 5180, strictPort: true, proxy },
    preview: { host: "127.0.0.1", port: 4180, strictPort: true, proxy },
    build: {
      // No source maps or external URLs: the bundle stays self-contained for offline demos.
      sourcemap: false,
      chunkSizeWarningLimit: 900,
    },
  };
});
