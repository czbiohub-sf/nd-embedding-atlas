import { defineConfig, type ConfigContext, type ServerPlugin } from "fumapress";
import { fumadocsMdx } from "fumapress/adapters/mdx";
import { flexsearchPlugin } from "fumapress/plugins/flexsearch";
import { llmsPlugin } from "fumapress/plugins/llms.txt";
import { docs } from "./.source/server";

const siteBaseUrl = new URL(process.env.DOCS_BASE_URL ?? "https://czbiohub-sf.github.io/nd-embedding-atlas/");
if (!siteBaseUrl.pathname.endsWith("/")) siteBaseUrl.pathname += "/";
const siteBasePath = siteBaseUrl.pathname;

function basePathRedirectPlugin<C extends ConfigContext>(basePath: string): ServerPlugin<C> {
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

export default defineConfig({
  content: docs.toFumadocsSource(),
  mode: "static",
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
})
  .plugins(basePathRedirectPlugin(siteBasePath), flexsearchPlugin(), llmsPlugin())
  .adapters(fumadocsMdx());
