/**
 * Run `task` one at a time. Calls made while it runs collapse into one rerun
 * with the latest argument, so the last request always runs and none overlap.
 */
export function latestOnly<T>(task: (arg: T) => Promise<void>): (arg: T) => void {
  let running = false;
  let pending: { arg: T } | null = null;
  const run = (arg: T) => {
    running = true;
    void task(arg)
      .catch((error: unknown) => console.warn("[scatter] readback failed:", error))
      .finally(() => {
        running = false;
        const next = pending;
        pending = null;
        if (next) run(next.arg);
      });
  };
  return (arg) => {
    if (running) pending = { arg };
    else run(arg);
  };
}
