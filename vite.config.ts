import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const packageMetadata: unknown = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
if (
  packageMetadata === null
  || typeof packageMetadata !== "object"
  || !("version" in packageMetadata)
  || typeof packageMetadata.version !== "string"
) {
  throw new Error("package.json 缺少有效版本号");
}

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageMetadata.version),
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5273,
    strictPort: true,
  },
});
