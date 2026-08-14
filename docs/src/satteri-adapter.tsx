import type { LocalMarkdownPage } from "@fumadocs/satteri/local-md";
import type { Adapter, AppShape } from "fumapress";
import defaultMdxComponents, { createRelativeLink } from "fumadocs-ui/mdx";

type BlogFrontmatter = {
  tags?: string[];
  date?: Date;
};

function isSatteriPage(
  data: unknown,
): data is LocalMarkdownPage<BlogFrontmatter> {
  if (typeof data !== "object" || data === null) return false;

  const page = data as Partial<LocalMarkdownPage<BlogFrontmatter>>;
  return (
    typeof page.content === "string" &&
    typeof page.frontmatter === "object" &&
    page.frontmatter !== null &&
    typeof page.load === "function"
  );
}

export function satteriAdapter<C extends AppShape = AppShape>(): Adapter<C> {
  return {
    "core:get-text"(page) {
      if (isSatteriPage(page.data)) return page.data.content;
    },
    async "core:get-structured-data"(page) {
      if (isSatteriPage(page.data)) {
        return (await page.data.load()).structuredData;
      }
    },
    async "core:get-body"(page) {
      if (!isSatteriPage(page.data)) return;

      const renderer = await page.data.load();
      const { body } = await renderer.render({
        ...defaultMdxComponents,
        a: createRelativeLink(await this.getLoader(), page),
      });
      return { node: body };
    },
    async "core:render-toc"(page) {
      if (isSatteriPage(page.data)) {
        const renderer = await page.data.load();
        return (await renderer.render()).toc;
      }
    },
    "blog:get-tags"(page) {
      if (isSatteriPage(page.data)) return page.data.frontmatter.tags;
    },
    // Without this, Fumapress dates every post at build time: blog cards show
    // the deploy date, ordering collapses, and the RSS feed emits no items.
    "core:get-creation-date"(page) {
      if (isSatteriPage(page.data)) return page.data.frontmatter.date;
    },
  };
}