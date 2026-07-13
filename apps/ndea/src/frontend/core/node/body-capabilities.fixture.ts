import type { NodeBodyProps } from "./app-node-host";

function DataReadBody({ host }: NodeBodyProps<unknown, "data-read">): null {
  // @ts-expect-error A Body cannot acquire a GPU lease without gpu-device.
  void host.acquireDeviceLease();
  // @ts-expect-error A Body cannot coordinate focus without focus-coordination.
  void host.focus;
  return null;
}

void DataReadBody;
