import { defineConfig, type AppShape, type PressPlugin } from "fumapress";
import { fumadocsMdx } from "fumapress/adapters/mdx";
import { createGlassLayoutPage } from "fumapress/layouts/glass";
import { blogPlugin } from "fumapress/plugins/blog";
import { oramaSearchPlugin } from "fumapress/plugins/orama-search";
import { robotsPlugin } from "fumapress/plugins/robots";
import { docs } from "./.source/server";
import { basePathRssPlugin } from "./src/base-path-rss";
import { basePathSitemapPlugin } from "./src/base-path-sitemap";
import { basePathTakumiPlugin } from "./src/base-path-takumi";
import { blogSource } from "./src/blog-source";
import { satteriAdapter } from "./src/satteri-adapter";

const siteBaseUrl = new URL(process.env.DOCS_BASE_URL ?? "https://czbiohub-sf.github.io/nd-embedding-atlas/");
if (!siteBaseUrl.pathname.endsWith("/")) siteBaseUrl.pathname += "/";
const siteBasePath = siteBaseUrl.pathname;

function basePathRedirectPlugin<C extends AppShape>(basePath: string): PressPlugin<C> {
  return {
    name: "base-path-redirect",
    enforce: "pre",
    createMiddlewares() {
      return [
        async (context, next) => {
          if (basePath !== "/" && context.req.path === "/") {
            return context.redirect(basePath);
          }
          if (context.req.path === "/favicon.ico") return context.body(null, 204);
          await next();
        },
      ];
    },
  };
}

const GlassLayout = createGlassLayoutPage<typeof config.$context>();

const config = defineConfig({
  content: {
    docs: docs.toFumadocsSource(),
    blog: blogSource.dynamicSource({ baseDir: "blog" }),
  },
  mode: "static",
  preset: "recommended",
  site: {
    name: "nd-embedding-atlas",
    baseUrl: siteBaseUrl.href,
    git: {
      user: "czbiohub-sf",
      repo: "nd-embedding-atlas",
      branch: "main",
      rootDir: "docs/content",
    },
  },
  defaultLayoutProps: {
    links: [
      { type: "main", text: "Docs", url: "/" },
      { type: "main", text: "Blog", url: "/blog", active: "nested-url" },
    ],
  },
  renderPage: (props) => <GlassLayout {...props} />,
})
  .plugins(
    basePathRedirectPlugin(siteBasePath),
    blogPlugin(),
    oramaSearchPlugin(),
    basePathTakumiPlugin(),
    basePathSitemapPlugin(),
    basePathRssPlugin(),
    // A relative reference resolves under the deployment subpath; the default
    // "/sitemap.xml" would be published at the organization root.
    robotsPlugin({ sitemap: "sitemap.xml" }),
  )
  .adapters(fumadocsMdx(), satteriAdapter());

export default config;