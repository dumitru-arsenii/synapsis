import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@synapsis\/brain$/,
        replacement: resolve(__dirname, "packages/brain/src/index.ts")
      },
      {
        find: /^@synapsis\/cortex$/,
        replacement: resolve(__dirname, "packages/cortex/src/index.ts")
      },
      {
        find: /^@synapsis\/cortex\/memory$/,
        replacement: resolve(__dirname, "packages/cortex/src/memory/index.ts")
      },
      {
        find: /^@synapsis\/cortex\/redis$/,
        replacement: resolve(__dirname, "packages/cortex/src/redis/index.ts")
      },
      {
        find: /^@synapsis\/neuron$/,
        replacement: resolve(__dirname, "packages/neuron/src/index.ts")
      },
      {
        find: /^@synapsis\/openai$/,
        replacement: resolve(__dirname, "packages/openai/src/index.ts")
      },
      {
        find: /^@synapsis\/pathway$/,
        replacement: resolve(__dirname, "packages/pathway/src/index.ts")
      }
    ]
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"]
  }
});
