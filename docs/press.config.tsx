import { defineConfig, type ConfigContext, type ServerPlugin } from "fumapress";
import { fumadocsMdx } from "fumapress/adapters/mdx";
import { flexsearchPlugin } from "fumapress/plugins/flexsearch";
import { llmsPlugin } from "fumapress/plugins/llms.txt";
import { docs } from "./.source/server";

function basePathRedirectPlugin<C extends ConfigContext>(): ServerPlugin<C> {
  return {
    name: "base-path-redirect",
    enforce: "pre",
    createMiddlewares() {
      return [
        async (context, next) => {
          if (context.req.path === "/") return context.redirect("/nd-embedding-atlas/");
          if (context.req.path === "/favicon.ico") return context.body(null, 204);
          await next();
        },
      ];
    },
  };
}

export default defineConfig({
  content: docs.toFumadocsSource(),
  site: {
    name: "nd-embedding-atlas",
    baseUrl: "https://czbiohub-sf.github.io/nd-embedding-atlas/",
    git: {
      user: "czbiohub-sf",
      repo: "nd-embedding-atlas",
      branch: "main",
      rootDir: "docs/content",
    },
  },
})
  .plugins(basePathRedirectPlugin(), flexsearchPlugin(), llmsPlugin())
  .adapters(fumadocsMdx());
