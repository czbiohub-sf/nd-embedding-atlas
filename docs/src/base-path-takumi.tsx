import type { AppShape, PressPlugin } from "fumapress";
import { generateOGImage } from "fumadocs-ui/og/takumi";
import { notFound } from "fumapress/router";
import { absoluteUrl } from "./site-url";

const width = 1200;
const height = 630;

function slugsToImagePath(slugs: string[]): string[] {
  if (slugs.length === 0) return ["index.webp"];
  return slugs.map((slug, i) => (i === slugs.length - 1 ? `${slug}.webp` : slug));
}

function imagePathToSlugs(segments: string[]): string[] {
  const slugs = segments.map((segment) => segment.replace(/\.webp$/, ""));
  if (slugs.length === 1 && slugs[0] === "index") return [];
  return slugs;
}

/**
 * Replaces the stock Takumi plugin, which resolves `og:image` against the origin
 * and so drops the GitHub Pages project subpath of `site.baseUrl`.
 */
export function basePathTakumiPlugin<
  C extends AppShape = AppShape,
>(): PressPlugin<C> {
  return {
    name: "core:takumi",
    init() {
      const { baseUrl } = this.siteConfig;

      this.interceptPageMeta(({ page, next }) => {
        const pathname = `/${slugsToImagePath(page.slugs).join("/")}`;
        const absolute = absoluteUrl(pathname, baseUrl);

        return (
          <>
            {next()}
            <meta property="og:image" content={absolute} />
            <meta property="og:image:width" content={`${width}`} />
            <meta property="og:image:height" content={`${height}`} />
            <meta property="twitter:card" content="summary_large_image" />
          </>
        );
      });
    },
    async createPages({ createApiIsomorphic }) {
      const loader = await this.getLoader();

      createApiIsomorphic({
        render: this.mode === "default" ? "static" : this.mode,
        path: "/[...slugs]",
        staticPaths: loader
          .getPages()
          .map((page) => slugsToImagePath(page.slugs)),
        handler: async (_req, { params }) => {
          const slugs = params.slugs ?? [];
          const page = (await this.getLoader()).getPage(
            imagePathToSlugs(Array.isArray(slugs) ? slugs : [slugs]),
          );
          if (!page) notFound();

          return generateOGImage({
            title: page.data.title,
            description: page.data.description,
            site: this.siteConfig.name,
            width,
            height,
            format: "webp",
          });
        },
      });
    },
  };
}