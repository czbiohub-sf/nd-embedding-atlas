/**
 * Headless Chrome for remote rendering: discovery, launch, and a minimal
 * Chrome DevTools Protocol client.
 *
 * CDP runs over `--remote-debugging-pipe`, not a debugging port: on a shared
 * compute node any local user could connect to a port and drive the browser
 * (read files, open the data routes). The pipe also means Chrome exits on its
 * own when ndea dies and its end of the pipe closes.
 */

import { existsSync, writeSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const PLAYWRIGHT_CACHE =
  process.env.PLAYWRIGHT_BROWSERS_PATH ??
  (process.platform === "darwin"
    ? join(homedir(), "Library/Caches/ms-playwright")
    : process.platform === "win32"
      ? join(process.env.LOCALAPPDATA ?? homedir(), "ms-playwright")
      : join(homedir(), ".cache/ms-playwright"));

/** Newest Playwright `chromium-headless-shell` in its cache, if any. */
function playwrightHeadlessShell(): string | null {
  if (!existsSync(PLAYWRIGHT_CACHE)) return null;
  const glob = new Bun.Glob("chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell{,.exe}");
  const found = [...glob.scanSync({ cwd: PLAYWRIGHT_CACHE, onlyFiles: true })];
  const revision = (path: string) => Number(path.match(/chromium_headless_shell-(\d+)/)?.[1] ?? 0);
  const newest = found.sort((a, b) => revision(b) - revision(a))[0];
  return newest ? join(PLAYWRIGHT_CACHE, newest) : null;
}

/**
 * The Chrome executable: `NDEA_CHROME`, then the platform's install path,
 * then `google-chrome` / `chromium` / `chromium-browser` on PATH, then
 * Playwright's `chromium-headless-shell` cache. Throws with what it tried.
 */
export function findChrome(): string {
  const configured = process.env.NDEA_CHROME;
  if (configured) {
    if (existsSync(configured)) return configured;
    throw new Error(`NDEA_CHROME=${configured} does not exist`);
  }
  const installed =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : process.platform === "win32"
        ? [join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google/Chrome/Application/chrome.exe")]
        : [];
  const found =
    installed.find((path) => existsSync(path)) ??
    ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
      .map((name) => Bun.which(name))
      .find(Boolean) ??
    playwrightHeadlessShell();
  if (found) return found;
  throw new Error(
    "no Chrome or Chromium found for remote rendering: set NDEA_CHROME to its executable, " +
      "load a Chrome/Chromium module, or install chromium-headless-shell " +
      `(searched ${[...installed, "google-chrome", "chromium", "chromium-browser", `${PLAYWRIGHT_CACHE}/chromium_headless_shell-*`].join(", ")})`,
  );
}

/** Launch flags. Linux uses ANGLE on EGL so a GPU node without X or `/dev/dri` still renders on the GPU. */
function chromeFlags(profile: string): string[] {
  const linux = process.platform === "linux";
  return [
    "--headless=new",
    "--remote-debugging-pipe",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--ignore-gpu-blocklist",
    // chrome-headless-shell (old headless) leaves the GPU off without it.
    "--enable-gpu",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    ...(linux ? ["--use-gl=angle", "--use-angle=gl-egl"] : []),
    // Chrome refuses to start as root with its sandbox on; elsewhere it stays on.
    ...(linux && process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    ...(process.env.NDEA_CHROME_FLAGS?.split(/\s+/).filter(Boolean) ?? []),
    "about:blank",
  ];
}

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

export interface Chrome {
  readonly path: string;
  /** `Browser.getVersion().product`, e.g. `Chrome/155.0.8059.85`. */
  readonly version: string;
  /** Resolves when the process exits, for any reason. */
  readonly exited: Promise<unknown>;
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>;
  on(listener: (event: CdpEvent) => void): () => void;
  close(): Promise<void>;
}

/** Start headless Chrome and connect CDP over its pipe. */
export async function launchChrome(path = findChrome()): Promise<Chrome> {
  const profile = await mkdtemp(join(tmpdir(), "ndea-chrome-"));
  const proc = Bun.spawn([path, ...chromeFlags(profile)], {
    stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
  });
  // Chrome reads commands from its fd 3 and writes replies to its fd 4; Bun types extra fds loosely.
  const [, , , commands, replies] = proc.stdio as unknown as number[];
  // Drain stderr (a full pipe would stall Chrome); keep the tail for launch errors.
  let log = "";
  void (async () => {
    for await (const chunk of proc.stderr) log = (log + new TextDecoder().decode(chunk)).slice(-4000);
  })();

  let nextId = 1;
  const pending = new Map<number, PromiseWithResolvers<Record<string, unknown>>>();
  const listeners = new Set<(event: CdpEvent) => void>();
  let closed = false;
  const fail = (error: Error) => {
    closed = true;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };

  void (async () => {
    let buffer = "";
    const decoder = new TextDecoder();
    for await (const chunk of Bun.file(replies).stream()) {
      buffer += decoder.decode(chunk, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\0")) >= 0) {
        const message = JSON.parse(buffer.slice(0, end)) as {
          id?: number;
          result?: Record<string, unknown>;
          error?: { message: string };
        } & Partial<CdpEvent>;
        buffer = buffer.slice(end + 1);
        if (message.id === undefined) {
          for (const listener of listeners) listener(message as CdpEvent);
          continue;
        }
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiter?.reject(new Error(message.error.message));
        else waiter?.resolve(message.result ?? {});
      }
    }
  })().catch(() => {});

  // close() awaits this, so the profile is gone before the server's shutdown exits.
  const exited = proc.exited.then(async (code) => {
    fail(new Error(`Chrome exited (${code ?? proc.signalCode}): ${log.trim().split("\n").slice(-5).join("\n")}`));
    await rm(profile, { recursive: true, force: true });
    return code;
  });

  const send = <T = Record<string, unknown>>(method: string, params = {}, sessionId?: string): Promise<T> => {
    if (closed) return Promise.reject(new Error("Chrome is not running"));
    const id = nextId++;
    const waiter = Promise.withResolvers<Record<string, unknown>>();
    pending.set(id, waiter);
    writeSync(commands, `${JSON.stringify({ id, method, params, sessionId })}\0`);
    return waiter.promise as Promise<T>;
  };

  const timeout = setTimeout(() => proc.kill(), 15_000);
  const version = await send<{ product: string }>("Browser.getVersion")
    .catch((error: unknown) => {
      throw new Error(`could not start ${path}: ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(() => clearTimeout(timeout));

  return {
    path,
    version: version.product,
    exited,
    send,
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      if (closed) return;
      const killer = setTimeout(() => proc.kill(), 2000);
      await send("Browser.close").catch(() => proc.kill());
      await exited;
      clearTimeout(killer);
    },
  };
}

/** Open `url` in a new tab and return the tab's target id and flattened CDP session. */
export async function openTab(chrome: Chrome, url: string): Promise<{ targetId: string; sessionId: string }> {
  const { targetId } = await chrome.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
  if (url !== "about:blank") await chrome.send("Page.navigate", { url }, sessionId);
  return { targetId, sessionId };
}

export interface ChromeProbe {
  path: string;
  version: string;
  /** Unmasked WebGL2 renderer, or null without WebGL2. */
  webgl: string | null;
  /** WebCodecs encoder support per codec: hardware, software-only, or unsupported. */
  encoders: Record<string, "hardware" | "software" | "unsupported">;
}

/** `ndea self doctor`: what remote rendering would get from this machine's Chrome. */
export async function probeChrome(): Promise<ChromeProbe> {
  const chrome = await launchChrome();
  // WebCodecs needs a secure context; about:blank is not one, http://127.0.0.1 is.
  const page = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }),
  });
  try {
    const { sessionId } = await openTab(chrome, `http://127.0.0.1:${page.port}/`);
    const expression = `(async () => {
      while (document.readyState !== "complete" || location.protocol !== "http:") await new Promise((r) => setTimeout(r, 20));
      const gl = document.createElement("canvas").getContext("webgl2");
      const info = gl && gl.getExtension("WEBGL_debug_renderer_info");
      const webgl = gl ? gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : null;
      const encoders = {};
      for (const codec of ${JSON.stringify(REMOTE_CODECS)}) {
        const config = (hardwareAcceleration) => ({ codec, width: 1920, height: 1080, bitrate: 6e6, framerate: 30, hardwareAcceleration });
        const supported = async (hw) => typeof VideoEncoder !== "undefined" && (await VideoEncoder.isConfigSupported(config(hw)).catch(() => ({}))).supported === true;
        encoders[codec] = (await supported("prefer-hardware")) ? "hardware" : (await supported("prefer-software")) ? "software" : "unsupported";
      }
      return { webgl, encoders };
    })()`;
    const { result, exceptionDetails } = await chrome.send<{
      result: { value?: Pick<ChromeProbe, "webgl" | "encoders"> };
      exceptionDetails?: { text: string };
    }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (!result.value) throw new Error(exceptionDetails?.text ?? "probe returned nothing");
    return { path: chrome.path, version: chrome.version, ...result.value };
  } finally {
    void page.stop(true);
    await chrome.close();
  }
}

/** Codecs the render page tries in order; the doctor probes the same list. */
export const REMOTE_CODECS = ["avc1.640033", "vp09.00.41.08"] as const;
