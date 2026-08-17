export type AppAmbient = [
  typeof Bun.file,
  typeof process,
  HTMLElement,
  NodeListOf<Element>[typeof Symbol.iterator],
  GPUDevice,
  ImportMeta["env"],
];
