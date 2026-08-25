import { useCallback, useState } from "react";

/**
 * A config value that a control in the body can actually change.
 *
 * `NodeHost` exposes `readonly config` and `patchConfig` but nothing to subscribe to, and
 * `mountNodeBody` renders the body exactly once with `createElement(Component, { host })`.
 * So mutating config through `patchConfig` alone never re-renders — the control appears
 * dead until some unrelated state change (a focus event, say) forces a render, which is
 * exactly the "buttons do nothing until I click a FOV" failure.
 *
 * React state is therefore the source of truth for the current render, and `patchConfig`
 * is persistence: it survives reload, but it is not what drives the UI.
 *
 * The proper fix is a config subscription on the host, which would let every node's
 * in-body controls work without this shim.
 *
 * @param initial value from `host.config`, read once at mount (restores a persisted value)
 * @param persist forwards the change to `host.patchConfig`
 */
export function useConfigState<T>(initial: T, persist: (value: T) => void): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const set = useCallback(
    (next: T) => {
      setValue(next);
      persist(next);
    },
    [persist],
  );
  return [value, set];
}
