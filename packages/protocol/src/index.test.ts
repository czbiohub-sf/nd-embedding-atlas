// Package-level wire contract tests.
/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  AnnotationColumnsResponseSchema,
  type AnnotationColumnsResponse,
  AnnotationPredicateWriteResponseSchema,
  type AnnotationPredicateWriteResponse,
  CommitAnnotationsResponseSchema,
  CommitDatasetReportSchema,
  ConfigResponseSchema,
  EmbeddingStatusSchema,
  ErrorResponseSchema,
  ExportBodySchema,
  ExportDirectoryResponseSchema,
  MetadataSchema,
  type Metadata,
  type NdeaProtocol,
  ObsInfoSchema,
  SelectionPublishResponseSchema,
  TrajectoryResponseSchema,
  VarColumnBodySchema,
  VarColumnResponseSchema,
  VarColumnStatusResponseSchema,
  VarLayersResponseSchema,
  VarNamesResponseSchema,
} from "./index.ts";

test("observation info permits rows without a crop-addressable FOV", () => {
  expect(ObsInfoSchema.parse({ t: 0, x: 12, y: 34 })).toEqual({ t: 0, x: 12, y: 34 });
});

describe("shared route contracts", () => {
  test("preserves every embedding status payload", () => {
    const payloads = [
      { status: "not_started" },
      { status: "loading" },
      { status: "ready", n_dims: 2 },
      { status: "error", error: "failed to load" },
    ] as const;

    for (const payload of payloads) {
      expect(EmbeddingStatusSchema.parse(payload)).toEqual(payload);
    }
  });

  test("accepts optional var-column layer and modality fields", () => {
    const request = { name: "MS4A1", modality: "rna" } satisfies NdeaProtocol["var-column/load"]["req"];
    expect(VarColumnBodySchema.parse(request)).toEqual(request);
  });

  test("uses the HTTP export body for the retained WebSocket method", () => {
    const request = {
      predicate: "cell_type = 'T'",
      output_path: "exports/t-cells.parquet",
      embedding_key: null,
    } satisfies NdeaProtocol["export/start"]["req"];
    expect(ExportBodySchema.parse(request)).toEqual(request);
  });
});

describe("shared HTTP response DTOs", () => {
  test("preserves representative metadata and config raw shapes", () => {
    const metadata = {
      version: "0.0.0-dev",
      props: { data: { id: "obs_name", projection: { x: "umap_0", y: "umap_1" } } },
      database: { type: "rest" },
      obsm: { X_umap: { prefix: "umap", n_dims: 2, loaded: true } },
      obs_columns: ["cell_type"],
      var_count: 42,
      layers: ["X"],
      export_dir: "/tmp/exports",
      spatial: {
        fov_col: null,
        crop_fov_col: null,
        t_col: "t",
        bbox_col: null,
        x_col: "x",
        y_col: "y",
        z_col: "z_slice",
      },
      plate: false,
      preset: "annotate",
      capabilities: ["obs", "var", "obsm"],
    } satisfies Metadata;
    const config = {
      datasets: { atlas: { path: "/data/atlas.zarr", platePath: null } },
      spatial: { fov: null, t: "t", bbox: null, x: "x", y: "y", z: null },
      obsColumns: ["cell_type"],
      availableObsmKeys: ["X_umap"],
      loadedEmbeddings: ["X_umap"],
      nObs: 120,
      port: 5055,
    };

    expect(MetadataSchema.parse(metadata)).toEqual(metadata);
    expect(ConfigResponseSchema.parse(config)).toEqual(config);
  });

  test("preserves trajectory mixed-case keys and optional fields", () => {
    const raw = [
      {
        rowIndex: 7,
        t: 2,
        emb_x: 1.25,
        emb_y: -3,
        spatial_x: 100,
        spatial_y: 200,
        datasetKey: null,
      },
      {
        rowIndex: 8,
        t: 3,
        emb_x: 2,
        emb_y: -2,
        spatial_x: 101,
        spatial_y: 201,
        datasetKey: "atlas",
        category: 4,
      },
    ];

    expect(TrajectoryResponseSchema.parse(raw)).toEqual(raw);
    expect("category" in TrajectoryResponseSchema.parse(raw)[0]).toBe(false);
  });

  test("preserves annotation and export raw shapes", () => {
    const annotationColumns = {
      columns: [
        { name: "cell_type", dtype: "categorical" },
        { name: "score", dtype: "float" },
      ],
    } satisfies AnnotationColumnsResponse;
    const annotationWrite = { ok: true, n: 12 } satisfies AnnotationPredicateWriteResponse;
    const exportDir = { default_dir: "/tmp/exports", writable: true };
    expect(AnnotationColumnsResponseSchema.parse(annotationColumns)).toEqual(annotationColumns);
    expect(AnnotationPredicateWriteResponseSchema.parse(annotationWrite)).toEqual(annotationWrite);
    expect(ExportDirectoryResponseSchema.parse(exportDir)).toEqual(exportDir);
  });

  test("preserves var and selection responses", () => {
    expect(VarNamesResponseSchema.parse({ names: ["CD3D", "CD3E"] })).toEqual({ names: ["CD3D", "CD3E"] });
    expect(VarLayersResponseSchema.parse({ layers: ["X", "counts"] })).toEqual({ layers: ["X", "counts"] });
    expect(
      VarColumnResponseSchema.parse({
        task_id: "task-1",
        status: "loading",
        column: "__var_CD3D_X__",
      }),
    ).toEqual({ task_id: "task-1", status: "loading", column: "__var_CD3D_X__" });
    expect(
      VarColumnStatusResponseSchema.parse({
        status: "ready",
        column: "__var_CD3D_X__",
      }),
    ).toEqual({ status: "ready", column: "__var_CD3D_X__" });
    expect(SelectionPublishResponseSchema.parse({ ok: true, table: "sel_node_1", count: 3 })).toEqual({
      ok: true,
      table: "sel_node_1",
      count: 3,
    });
  });

  test("rejects malformed payloads used by production fetch paths", () => {
    const malformed = [
      MetadataSchema.safeParse({ database: { type: "rest" }, obsm: {} }),
      ConfigResponseSchema.safeParse({ datasets: {}, obsColumns: "cell_type" }),
      TrajectoryResponseSchema.safeParse([{ t: 0, emb_x: "1", emb_y: 2, spatial_x: 3, spatial_y: 4 }]),
      AnnotationColumnsResponseSchema.safeParse({ columns: [{ name: "score", dtype: "number" }] }),
      AnnotationPredicateWriteResponseSchema.safeParse({ ok: true }),
      ExportDirectoryResponseSchema.safeParse({ default_dir: "/tmp" }),
      VarNamesResponseSchema.safeParse({ names: [42] }),
      VarLayersResponseSchema.safeParse({ layers: "X" }),
      VarColumnResponseSchema.safeParse({ task_id: "x" }),
      VarColumnStatusResponseSchema.safeParse({ status: "done", column: "x" }),
      SelectionPublishResponseSchema.safeParse({ ok: true, table: "sel", count: -1 }),
    ];

    for (const result of malformed) {
      expect(result.success).toBe(false);
    }
  });

  test("requires trajectory identity keys while preserving an explicit null dataset", () => {
    const base = {
      rowIndex: 1,
      t: 0,
      emb_x: 1,
      emb_y: 2,
      spatial_x: 3,
      spatial_y: 4,
      datasetKey: null,
    };

    expect(TrajectoryResponseSchema.parse([base])).toEqual([base]);
    expect(TrajectoryResponseSchema.safeParse([{ ...base, rowIndex: undefined }]).success).toBe(false);
    expect(TrajectoryResponseSchema.safeParse([{ ...base, datasetKey: undefined }]).success).toBe(false);
  });

  test("keeps optional fields optional and validates error envelopes", () => {
    const metadata = {
      props: { data: { id: "obs_name", projection: { x: "x", y: "y" } } },
      database: { type: "rest" },
      obsm: {},
      capabilities: [],
    };
    const parsedMetadata = MetadataSchema.parse(metadata);
    expect(parsedMetadata).toEqual(metadata);
    expect("obs_columns" in parsedMetadata).toBe(false);

    const status = VarColumnStatusResponseSchema.parse({ status: "loading", column: "__var_X__" });
    expect("error" in status).toBe(false);
    expect(ErrorResponseSchema.parse({ error: "bad request", issues: [{ path: ["name"] }] })).toEqual({
      error: "bad request",
      issues: [{ path: ["name"] }],
    });
  });
});

describe("CommitAnnotationsResponseSchema", () => {
  test("parses a success dataset report", () => {
    const r = CommitDatasetReportSchema.safeParse({
      datasetKey: "ds1",
      path: "/data/x.zarr",
      format: "v3",
      nObs: 50_000,
      columns: [{ name: "cell_type", kind: "categorical", nNonNull: 1240 }],
      written: false,
    });
    expect(r.success).toBe(true);
  });

  test("parses a remote/error skip report", () => {
    const r = CommitDatasetReportSchema.safeParse({
      datasetKey: "ds2",
      path: "https://remote/x.zarr",
      error: "remote stores can't be written back yet",
    });
    expect(r.success).toBe(true);
  });

  test("error member discriminates: no columns/format to dereference", () => {
    const skip = CommitDatasetReportSchema.parse({ datasetKey: "d", error: "no source dataset for this key" });
    expect("error" in skip).toBe(true);
    expect("columns" in skip).toBe(false);
    expect("format" in skip).toBe(false);
  });

  test("full response wraps dryRun + a mixed datasets array", () => {
    const r = CommitAnnotationsResponseSchema.parse({
      dryRun: true,
      datasets: [
        { datasetKey: "a", path: "/a.zarr", format: "v2", nObs: 10, columns: [], written: false },
        { datasetKey: "b", error: "remote stores can't be written back yet" },
      ],
    });
    expect(r.dryRun).toBe(true);
    expect(r.datasets).toHaveLength(2);
  });

  test("rejects a success shape missing required fields", () => {
    const r = CommitDatasetReportSchema.safeParse({ datasetKey: "a", path: "/a.zarr", format: "v3" });
    expect(r.success).toBe(false);
  });
});
