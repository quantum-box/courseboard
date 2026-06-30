import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      gen: fileURLToPath(new URL("./src/gen", import.meta.url)),
      "@sentry/nextjs": fileURLToPath(
        new URL("./sentry.noop.js", import.meta.url),
      ),
    },
  },
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
    }),
  ],
});
