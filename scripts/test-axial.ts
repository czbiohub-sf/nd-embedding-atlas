import { open, AnnData, MuData, toArrowTable } from "../src/index.ts";

const parsed = await open("./fixtures/test-mudata.zarr");
console.log("opened:", parsed.kind);
if (parsed.kind === "ome-zarr") throw new Error("fixture should be AnnData / MuData");

const ad = parsed.kind === "mudata" ? MuData.from(parsed) : AnnData.from(parsed);
console.log("nObs:", ad.nObs, "kind:", ad.kind);

const source = ad.kind === "mudata" ? ad.mod.values().next().value!.accessor.obs : ad.accessor.obs;
const arrowTable = toArrowTable(source);
console.log("Arrow table schema:", arrowTable.names);
console.log("Arrow table numRows:", arrowTable.numRows, "numCols:", arrowTable.numCols);
