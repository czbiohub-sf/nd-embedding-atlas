import type { AppShape, PressPlugin } from "fumapress";
import { buildRSS, type RSSItem } from "fumapress/plugins/rss";
import { absoluteUrl } from "./site-url";

const path = "/rss.xml";
const limit = 20;

/**
 * Replaces the upstream RSS plugin. Its `getItem` option can correct item
 * links, but the feed's `atom:link` self URL and the `<link rel="alternate">`
 * tag are built internally from a root-relative path, so on a Pages project
 * site both point at the organization root and 404.
 */
export function basePathRssPlugin<
  C extends AppShape = AppShape,
>(): PressPlugin<C> {
  return {
    name: "core:rss",
    init() {
      const feedUrl = absoluteUrl(path, this.siteConfig.baseUrl);
      const title = this.siteConfig.name;

      this.interceptRootMeta(({ next }) => (
        <>
          <link
            href={feedUrl}
            rel="alternate"
            title={title}
            type="application/rss+xml"
          />
          {next()}
        </>
      ));
    },
    async createPages({ createApiIsomorphic }) {
      createApiIsomorphic({
        render: this.mode === "default" ? "static" : this.mode,
        path,
        handler: async () => {
          const source = await this.getLoader();
          const items: RSSItem[] = [];

          for (const page of source.getPages()) {
            // Only dated content belongs in a feed; docs pages carry no date,
            // so this naturally limits the feed to blog posts.
            const pubDate =
              (await this.getPageCreatedAt(page)) ??
              (await this.getPageLastModified(page));
            if (!pubDate) continue;

            items.push({
              title: page.data.title ?? page.path,
              description: page.data.description,
              link: absoluteUrl(page.url, this.siteConfig.baseUrl),
              pubDate,
            });
          }

          items.sort(
            (a, b) =>
              new Date(b.pubDate ?? 0).getTime() -
              new Date(a.pubDate ?? 0).getTime(),
          );

          const title = this.siteConfig.name;
          const xml = buildRSS({
            title,
            description: title,
            link: this.siteConfig.baseUrl ?? "/",
            selfUrl: this.siteConfig.baseUrl
              ? absoluteUrl(path, this.siteConfig.baseUrl)
              : undefined,
            items: items.slice(0, limit),
          });

          return new Response(xml, {
            headers: { "Content-Type": "application/rss+xml" },
          });
        },
      });
    },
  };
}
