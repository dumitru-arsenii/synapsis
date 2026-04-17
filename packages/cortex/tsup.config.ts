import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: [
    "src/index.ts",
    "src/redis/index.ts",
    "src/memory/index.ts"
  ],
  format: ["esm", "cjs"],
  sourcemap: true,
  splitting: true,
  treeshake: true
});
