#!/usr/bin/env bun

import { dirname, isAbsolute, relative, resolve } from "node:path";

interface PackageManifest {
  name?: string;
  exports?: string | Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface Workspace {
  name: string;
  directory: string;
  manifest: PackageManifest;
  sourceGlobs: readonly string[];
}

const ROOT = resolve(import.meta.dir, "..");
const EXPECTED_WORKSPACES = [
  {
    name: "@ndea/app",
    directory: "apps/ndea",
    sourceGlobs: ["src/**/*.{ts,tsx}", "scripts/**/*.ts", "vite.config.ts"],
  },
  { name: "@ndea/protocol", directory: "packages/protocol", sourceGlobs: ["src/**/*.{ts,tsx}"] },
  { name: "@ndea/sdk", directory: "packages/sdk", sourceGlobs: ["src/**/*.{ts,tsx}"] },
  { name: "@ndea/zarr", directory: "packages/zarr", sourceGlobs: ["src/**/*.{ts,tsx}"] },
] as const;

function containsPath(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function declaredDependencies(manifest: PackageManifest): Set<string> {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
}

function exportsSubpath(manifest: PackageManifest, subpath: string): boolean {
  if (subpath === ".") return typeof manifest.exports === "string" || Boolean(manifest.exports?.[subpath]);
  return typeof manifest.exports === "object" && manifest.exports !== null && subpath in manifest.exports;
}

const errors: string[] = [];
const rootManifest = (await Bun.file(resolve(ROOT, "package.json")).json()) as { workspaces?: unknown };
const rootWorkspaces = Array.isArray(rootManifest.workspaces) ? rootManifest.workspaces : [];
if (!rootWorkspaces.includes("apps/*") || !rootWorkspaces.includes("packages/*") || rootWorkspaces.includes("docs")) {
  errors.push('package.json workspaces must contain "apps/*" and "packages/*", and must exclude "docs".');
}

const workspaces: Workspace[] = [];
for (const expected of EXPECTED_WORKSPACES) {
  const manifestPath = resolve(ROOT, expected.directory, "package.json");
  const file = Bun.file(manifestPath);
  if (!(await file.exists())) {
    errors.push(`${expected.directory}/package.json is missing.`);
    continue;
  }
  const manifest = (await file.json()) as PackageManifest;
  if (manifest.name !== expected.name) {
    errors.push(`${expected.directory}/package.json must be named ${expected.name}; found ${String(manifest.name)}.`);
    continue;
  }
  workspaces.push({ ...expected, manifest });
}

const workspaceNames = new Set(workspaces.map((workspace) => workspace.name));
let filesChecked = 0;
let importsChecked = 0;

for (const workspace of workspaces) {
  const workspaceRoot = resolve(ROOT, workspace.directory);
  const dependencies = declaredDependencies(workspace.manifest);
  const paths = new Set<string>();
  for (const pattern of workspace.sourceGlobs) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan({ cwd: workspaceRoot, onlyFiles: true })) paths.add(path);
  }

  for (const path of paths) {
    filesChecked += 1;
    const absolutePath = resolve(workspaceRoot, path);
    const source = (await Bun.file(absolutePath).text()).replace(/^#![^\n]*\n/, "\n");
    const loader = path.endsWith(".tsx") ? "tsx" : "ts";
    const imports = new Bun.Transpiler({ loader }).scanImports(source);
    for (const imported of imports) {
      importsChecked += 1;
      const specifier = imported.path;
      if (specifier.startsWith(".")) {
        const targetPath = resolve(dirname(absolutePath), specifier);
        const targetWorkspace = workspaces.find((candidate) =>
          containsPath(resolve(ROOT, candidate.directory), targetPath),
        );
        if (targetWorkspace && targetWorkspace.name !== workspace.name) {
          errors.push(
            `${workspace.directory}/${path}: relative import ${specifier} crosses into ${targetWorkspace.name}; use its package export.`,
          );
        }
        continue;
      }

      if (specifier.startsWith("@/") && workspace.name !== "@ndea/app") {
        errors.push(`${workspace.directory}/${path}: frontend alias ${specifier} is app-only.`);
        continue;
      }
      if (!specifier.startsWith("@ndea/")) continue;

      const segments = specifier.split("/");
      const packageName = segments.slice(0, 2).join("/");
      const targetWorkspace = workspaces.find((candidate) => candidate.name === packageName);
      if (!targetWorkspace || !workspaceNames.has(packageName)) {
        errors.push(`${workspace.directory}/${path}: import ${specifier} targets an unknown workspace.`);
        continue;
      }
      if (packageName === "@ndea/app" && workspace.name !== "@ndea/app") {
        errors.push(`${workspace.directory}/${path}: shared packages cannot import @ndea/app.`);
      }
      if (packageName !== workspace.name && !dependencies.has(packageName)) {
        errors.push(
          `${workspace.directory}/${path}: ${packageName} is not declared in ${workspace.name} dependencies.`,
        );
      }

      const subpath = segments.length === 2 ? "." : `./${segments.slice(2).join("/")}`;
      if (!exportsSubpath(targetWorkspace.manifest, subpath)) {
        errors.push(`${workspace.directory}/${path}: ${specifier} is not an exported package entrypoint.`);
      }
    }
  }
}

if (workspaces.length !== EXPECTED_WORKSPACES.length) {
  errors.push(`Expected ${EXPECTED_WORKSPACES.length} product workspaces; loaded ${workspaces.length}.`);
}

if (errors.length > 0) {
  console.error(`Workspace boundary check failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Workspace boundaries: ${filesChecked} files and ${importsChecked} imports checked.`);
