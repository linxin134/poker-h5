import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
  const release = process.env.APP_RELEASE ?? "dev";
  return {
    define: { __APP_RELEASE__: JSON.stringify(release) },
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { "/api": { target: "http://localhost:8787", ws: true } }
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          entryFileNames: `assets/[name]-${release}-[hash].js`,
          chunkFileNames: `assets/[name]-${release}-[hash].js`,
          assetFileNames: `assets/[name]-${release}-[hash][extname]`
        }
      }
    }
  };
});
