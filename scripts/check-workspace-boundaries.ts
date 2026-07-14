#!/usr/bin/env bun

import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import ts from "typescript";

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

interface ImportInspection {
  errors: string[];
  importsChecked: number;
}

const ROOT = resolve(import.meta.dir, "..");
const FIXTURE_ROOT = resolve(ROOT, "scripts/fixtures/package-boundaries");
const EXPECTED_WORKSPACES = [
  {
    name: "@ndea/app",
    directory: "apps/ndea",
    sourceGlobs: ["src/**/*.{ts,tsx}", "scripts/**/*.ts", "vite.config.ts"],
  },
  { name: "@ndea/protocol", directory: "packages/protocol", sourceGlobs: ["src/**/*.{ts,tsx}"] },
  { name: "@ndea/sdk", directory: "packages/sdk", sourceGlobs: ["src/**/*.{ts,tsx}"] },
  { name: "@ndea/zarr", directory: "packages/zarr", sourceGlobs: ["src/**/*.{ts,tsx}"] },
  {
    name: "@ndea/example-custom-node",
    directory: "examples/plugins/custom-node",
    sourceGlobs: ["src/**/*.{ts,tsx}"],
  },
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

function isLowerLayerWorkspaceImport(
  workspace: Workspace,
  path: string,
  workspaceRoot: string,
  specifier: string,
  targetPath?: string,
): boolean {
  if (
    workspace.name !== "@ndea/app" ||
    !/^src\/frontend\/core\/(?:graph|node|plugin)(?:\/|$)/.test(path.replaceAll("\\", "/"))
  ) {
    return false;
  }
  if (specifier === "@/core/workspace" || specifier.startsWith("@/core/workspace/")) return true;
  return targetPath !== undefined && containsPath(resolve(workspaceRoot, "src/frontend/core/workspace"), targetPath);
}

function collectModuleSpecifiers(path: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    path,
    source.replace(/^#![^\n]*\n/, "\n"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function inspectImports(
  workspace: Workspace,
  path: string,
  source: string,
  workspaces: readonly Workspace[],
  workspaceNames: ReadonlySet<string>,
): ImportInspection {
  const errors: string[] = [];
  const workspaceRoot = resolve(ROOT, workspace.directory);
  const dependencies = declaredDependencies(workspace.manifest);
  const absolutePath = resolve(workspaceRoot, path);
  const imports = collectModuleSpecifiers(path, source);

  for (const specifier of imports) {
    if (specifier.startsWith(".")) {
      const targetPath = resolve(dirname(absolutePath), specifier);
      if (isLowerLayerWorkspaceImport(workspace, path, workspaceRoot, specifier, targetPath)) {
        errors.push(
          `${workspace.directory}/${path}: graph, node, and plugin cores cannot import Workspace composition.`,
        );
      }
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

    if (isLowerLayerWorkspaceImport(workspace, path, workspaceRoot, specifier)) {
      errors.push(`${workspace.directory}/${path}: graph, node, and plugin cores cannot import Workspace composition.`);
      continue;
    }
    if (specifier.startsWith("@/") && workspace.name !== "@ndea/app") {
      errors.push(`${workspace.directory}/${path}: frontend alias ${specifier} is app-only.`);
      continue;
    }
    if (workspace.name === "@ndea/sdk" && /^(?:react|react-dom)(?:\/|$)/.test(specifier)) {
      errors.push(`${workspace.directory}/${path}: @ndea/sdk cannot import React runtime module ${specifier}.`);
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
      errors.push(`${workspace.directory}/${path}: non-app workspaces cannot import @ndea/app.`);
    }
    if (packageName !== workspace.name && !dependencies.has(packageName)) {
      errors.push(`${workspace.directory}/${path}: ${packageName} is not declared in ${workspace.name} dependencies.`);
    }

    const subpath = segments.length === 2 ? "." : `./${segments.slice(2).join("/")}`;
    if (!exportsSubpath(targetWorkspace.manifest, subpath)) {
      errors.push(`${workspace.directory}/${path}: ${specifier} is not an exported package entrypoint.`);
    }
  }

  return { errors, importsChecked: imports.length };
}

function fixtureHeaderValues(source: string, name: string): string[] {
  const values: string[] = [];
  const pattern = new RegExp(`^// ${name}: (.+)$`, "gm");
  for (const match of source.matchAll(pattern)) values.push(match[1]?.trim() ?? "");
  return values;
}

async function checkArchitectureFixtures(
  workspaces: readonly Workspace[],
  workspaceNames: ReadonlySet<string>,
): Promise<string[]> {
  const fixtureErrors: string[] = [];
  const glob = new Bun.Glob("architecture/*.{ts,tsx}");
  const paths = [...glob.scanSync({ cwd: FIXTURE_ROOT, onlyFiles: true })].toSorted();

  for (const path of paths) {
    const source = await Bun.file(resolve(FIXTURE_ROOT, path)).text();
    const workspaceName = fixtureHeaderValues(source, "workspace")[0];
    const virtualPath = fixtureHeaderValues(source, "virtual-path")[0];
    const expectedErrors = fixtureHeaderValues(source, "expect-error");
    const workspace = workspaces.find(({ name }) => name === workspaceName);
    if (!workspace || !virtualPath) {
      fixtureErrors.push(`${path}: requires valid workspace and virtual-path headers.`);
      continue;
    }

    const inspection = inspectImports(workspace, virtualPath, source, workspaces, workspaceNames);
    if (expectedErrors.length === 0) {
      for (const error of inspection.errors) fixtureErrors.push(`${path}: unexpected boundary failure: ${error}`);
      continue;
    }
    if (inspection.errors.length === 0) {
      fixtureErrors.push(`${path}: expected a boundary failure.`);
      continue;
    }
    for (const expected of expectedErrors) {
      if (!inspection.errors.some((error) => error.includes(expected))) {
        fixtureErrors.push(`${path}: expected boundary diagnostic containing "${expected}".`);
      }
    }
  }

  return fixtureErrors;
}

async function checkCompileFixtures(): Promise<string[]> {
  const fixtureErrors: string[] = [];
  const glob = new Bun.Glob("compile/**/*.ts");
  const paths = [...glob.scanSync({ cwd: FIXTURE_ROOT, onlyFiles: true })].toSorted();
  const sandbox = await mkdtemp(join(tmpdir(), "ndea-package-boundaries-"));

  try {
    await symlink(resolve(ROOT, "apps/ndea/node_modules"), resolve(sandbox, "node_modules"), "dir");
    await writeFile(
      resolve(sandbox, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          allowImportingTsExtensions: true,
          lib: ["ESNext", "DOM"],
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          paths: {
            "@/*": [resolve(ROOT, "apps/ndea/src/frontend/*")],
          },
          skipLibCheck: true,
          strict: true,
          target: "ESNext",
          types: ["bun", "@webgpu/types"],
          verbatimModuleSyntax: true,
        },
        files: ["fixture.ts"],
      }),
    );

    for (const path of paths) {
      const source = await Bun.file(resolve(FIXTURE_ROOT, path)).text();
      const expectedErrors = fixtureHeaderValues(source, "expect-error");
      await writeFile(resolve(sandbox, "fixture.ts"), source);
      const process = Bun.spawn(["vp", "exec", "tsc", "-p", resolve(sandbox, "tsconfig.json"), "--pretty", "false"], {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ]);
      const output = `${stdout}\n${stderr}`;

      if (expectedErrors.length === 0) {
        if (code !== 0) fixtureErrors.push(`${path}: canonical barrel fixture failed:\n${output.trim()}`);
        continue;
      }
      if (code === 0) {
        fixtureErrors.push(`${path}: expected TypeScript to reject this fixture.`);
        continue;
      }
      for (const expected of expectedErrors) {
        if (!output.includes(expected)) {
          fixtureErrors.push(`${path}: expected TypeScript diagnostic containing "${expected}".`);
        }
      }
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }

  return fixtureErrors;
}

const errors: string[] = [];
const rootManifest = (await Bun.file(resolve(ROOT, "package.json")).json()) as { workspaces?: unknown };
const rootWorkspaces = Array.isArray(rootManifest.workspaces) ? rootManifest.workspaces : [];
if (
  !rootWorkspaces.includes("apps/*") ||
  !rootWorkspaces.includes("packages/*") ||
  !rootWorkspaces.includes("examples/plugins/*") ||
  rootWorkspaces.includes("docs")
) {
  errors.push(
    'package.json workspaces must contain "apps/*", "packages/*", and "examples/plugins/*", and must exclude "docs".',
  );
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
  const paths = new Set<string>();
  for (const pattern of workspace.sourceGlobs) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan({ cwd: workspaceRoot, onlyFiles: true })) paths.add(path);
  }

  for (const path of paths) {
    filesChecked += 1;
    const absolutePath = resolve(workspaceRoot, path);
    const inspection = inspectImports(workspace, path, await Bun.file(absolutePath).text(), workspaces, workspaceNames);
    importsChecked += inspection.importsChecked;
    errors.push(...inspection.errors);
  }
}

if (workspaces.length !== EXPECTED_WORKSPACES.length) {
  errors.push(`Expected ${EXPECTED_WORKSPACES.length} product workspaces; loaded ${workspaces.length}.`);
} else {
  errors.push(...(await checkArchitectureFixtures(workspaces, workspaceNames)));
  errors.push(...(await checkCompileFixtures()));
}

if (errors.length > 0) {
  console.error(`Workspace boundary check failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Workspace boundaries: ${filesChecked} files and ${importsChecked} imports checked.`);
