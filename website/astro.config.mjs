import mdx from "@astrojs/mdx";
import preact from "@astrojs/preact";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  integrations: [preact(), mdx()],
  vite: { plugins: [tailwindcss()], worker: { format: "es" } },
});
