// Bun's bundler (dev server and build.ts) handles CSS imports; TypeScript only needs to know they resolve.
declare module "*.css";
