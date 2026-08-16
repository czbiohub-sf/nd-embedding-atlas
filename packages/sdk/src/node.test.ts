/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  defineNode,
  exactNodeTypeRef,
  migrateNodeConfig,
  nodeConfigVersion,
  NodeConfigMigrationError,
  type JsonValue,
  type NodeConfigContract,
  type NodeConfigMigrationErrorCode,
} from "@ndea/sdk";

function expectMigrationError(migrate: () => unknown, code: NodeConfigMigrationErrorCode): NodeConfigMigrationError {
  let caught: unknown;
  try {
    migrate();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(NodeConfigMigrationError);
  const migrationError = caught as NodeConfigMigrationError;
  expect(migrationError.code).toBe(code);
  return migrationError;
}

describe("defineNode", () => {
  test("preserves author-declared dataset requirements", () => {
    const definition = defineNode({
      ref: exactNodeTypeRef("example/required-data", "1.0.0"),
      title: "Required data",
      role: "view",
      inputs: [],
      outputs: [],
      capabilities: ["data-read"] as const,
      dataRequirements: ["obs", "spatial"] as const,
    });

    expect(definition.dataRequirements).toEqual(["obs", "spatial"]);
  });
});

describe("migrateNodeConfig", () => {
  test("validates and freezes same-version config", () => {
    const version = nodeConfigVersion(2);
    const result = migrateNodeConfig(
      {
        schema: z.object({ count: z.number().int() }),
        version,
        defaultValue: { count: 0 },
      },
      { version, value: { count: 4 } },
    );

    expect(result).toEqual({ version, value: { count: 4 } });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("runs an exact multi-step migration chain", () => {
    const result = migrateNodeConfig(
      {
        schema: z.object({ count: z.number(), labels: z.array(z.string()) }),
        version: nodeConfigVersion(3),
        defaultValue: { count: 0, labels: [] },
        migrations: [
          {
            from: nodeConfigVersion(1),
            to: nodeConfigVersion(2),
            migrate: (value) => {
              const config = value as { count: number };
              return { count: config.count + 1, label: "migrated" };
            },
          },
          {
            from: nodeConfigVersion(2),
            to: nodeConfigVersion(3),
            migrate: (value) => {
              const config = value as { count: number; label: string };
              return { count: config.count + 1, labels: [config.label] };
            },
          },
        ],
      },
      { version: nodeConfigVersion(1), value: { count: 2 } },
    );

    expect(result.value).toEqual({ count: 4, labels: ["migrated"] });
    expect(result.version).toBe(nodeConfigVersion(3));
  });

  test("dispatches an explicit legacy version 0 migrator", () => {
    const result = migrateNodeConfig(
      {
        schema: z.object({ enabled: z.boolean() }),
        version: nodeConfigVersion(1),
        defaultValue: { enabled: false },
        migrations: [
          {
            from: nodeConfigVersion(0),
            to: nodeConfigVersion(1),
            migrate: (value) => ({ enabled: value === "enabled" }),
          },
        ],
      },
      { version: nodeConfigVersion(0), value: "enabled" },
    );

    expect(result.value).toEqual({ enabled: true });
  });

  test("rejects a missing exact migration step", () => {
    const sourceVersion = nodeConfigVersion(1);
    const targetVersion = nodeConfigVersion(3);
    const error = expectMigrationError(
      () =>
        migrateNodeConfig(
          {
            schema: z.object({ count: z.number() }),
            version: targetVersion,
            defaultValue: { count: 0 },
            migrations: [
              {
                from: nodeConfigVersion(2),
                to: targetVersion,
                migrate: (value) => value,
              },
            ],
          },
          { version: sourceVersion, value: { count: 1 } },
        ),
      "missing-migrator",
    );

    expect(error.sourceVersion).toBe(sourceVersion);
    expect(error.targetVersion).toBe(targetVersion);
  });

  test("rejects config from a future version", () => {
    const sourceVersion = nodeConfigVersion(4);
    const targetVersion = nodeConfigVersion(3);
    const error = expectMigrationError(
      () =>
        migrateNodeConfig(
          {
            schema: z.object({ count: z.number() }),
            version: targetVersion,
            defaultValue: { count: 0 },
          },
          { version: sourceVersion, value: { count: 1 } },
        ),
      "future-version",
    );

    expect(error.sourceVersion).toBe(sourceVersion);
    expect(error.targetVersion).toBe(targetVersion);
  });

  test.each([
    [
      "duplicate source",
      [
        {
          from: nodeConfigVersion(0),
          to: nodeConfigVersion(1),
          migrate: (value: JsonValue) => value,
        },
        {
          from: nodeConfigVersion(0),
          to: nodeConfigVersion(2),
          migrate: (value: JsonValue) => value,
        },
      ],
    ],
    [
      "backward step",
      [
        {
          from: nodeConfigVersion(2),
          to: nodeConfigVersion(1),
          migrate: (value: JsonValue) => value,
        },
      ],
    ],
    [
      "overshooting step",
      [
        {
          from: nodeConfigVersion(2),
          to: nodeConfigVersion(4),
          migrate: (value: JsonValue) => value,
        },
      ],
    ],
  ])("rejects an unused malformed %s descriptor", (_name, migrations) => {
    const targetVersion = nodeConfigVersion(3);
    const contract: NodeConfigContract<{ count: number }> = {
      schema: z.object({ count: z.number() }),
      version: targetVersion,
      defaultValue: { count: 0 },
      migrations,
    };

    expectMigrationError(
      () =>
        migrateNodeConfig(contract, {
          version: targetVersion,
          value: { count: 1 },
        }),
      "invalid-migration-graph",
    );
  });

  test("wraps a thrown migration error as its cause", () => {
    const cause = new Error("migration exploded");
    const error = expectMigrationError(
      () =>
        migrateNodeConfig(
          {
            schema: z.object({ count: z.number() }),
            version: nodeConfigVersion(2),
            defaultValue: { count: 0 },
            migrations: [
              {
                from: nodeConfigVersion(1),
                to: nodeConfigVersion(2),
                migrate: () => {
                  throw cause;
                },
              },
            ],
          },
          { version: nodeConfigVersion(1), value: { count: 1 } },
        ),
      "migration-failed",
    );

    expect(error.cause).toBe(cause);
  });

  test("wraps final schema validation failure as its cause", () => {
    const error = expectMigrationError(
      () =>
        migrateNodeConfig(
          {
            schema: z.object({ count: z.number().positive() }),
            version: nodeConfigVersion(1),
            defaultValue: { count: 1 },
          },
          { version: nodeConfigVersion(1), value: { count: 0 } },
        ),
      "invalid-config",
    );

    expect(error.cause).toBeInstanceOf(z.ZodError);
  });

  test("does not mutate snapshots, migration descriptors, or migration arrays", () => {
    const sourceValue = {
      nested: { count: 1 },
      labels: ["before"],
    };
    const migration = Object.freeze({
      from: nodeConfigVersion(1),
      to: nodeConfigVersion(2),
      migrate(value: JsonValue): JsonValue {
        const config = value as typeof sourceValue;
        config.nested.count += 1;
        config.labels.push("after");
        return config;
      },
    });
    const migrations = Object.freeze([migration]);
    const snapshot = Object.freeze({
      version: nodeConfigVersion(1),
      value: sourceValue,
    });

    const result = migrateNodeConfig(
      {
        schema: z.object({
          nested: z.object({ count: z.number() }),
          labels: z.array(z.string()),
        }),
        version: nodeConfigVersion(2),
        defaultValue: { nested: { count: 0 }, labels: [] },
        migrations,
      },
      snapshot,
    );

    expect(sourceValue).toEqual({ nested: { count: 1 }, labels: ["before"] });
    expect(migrations).toEqual([migration]);
    expect(migration.from).toBe(nodeConfigVersion(1));
    expect(migration.to).toBe(nodeConfigVersion(2));
    expect(result.value).toEqual({
      nested: { count: 2 },
      labels: ["before", "after"],
    });
  });
});
