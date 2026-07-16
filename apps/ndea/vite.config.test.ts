import { expect, test } from "bun:test";
import config from "./vite.config";

test("dev server proxies approved API, plugin asset, and websocket routes", () => {
  expect(typeof config).toBe("object");
  if (!config || typeof config !== "object") throw new TypeError("expected object Vite config");

  expect(config.server?.proxy).toMatchObject({
    "/api": "http://localhost:5055",
    "/plugins": "http://localhost:5055",
    "/ws": { target: "ws://localhost:5055", ws: true },
    "/mosaic": { target: "ws://localhost:5055", ws: true },
  });
});
