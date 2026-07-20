import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5273,
    open: true,
    proxy: {
      // 仅代理接口路径，避免误将 /api-client.ts 等前端模块请求转发到后端。
      "/api/": {
        target: "http://127.0.0.1:3100",
        changeOrigin: false,
      },
    },
  },
});
