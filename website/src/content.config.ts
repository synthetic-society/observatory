import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const pages = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/pages" }),
  schema: z.object({
    title: z.string(),
  }),
});

export const collections = { pages };
