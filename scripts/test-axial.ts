import { open, AnnData, toArrowTable } from "../src/index.ts";

const parsed = await open("./fixtures/test-mudata.zarr");
console.log("opened:", parsed.kind);
if (parsed.kind === "ome-zarr") throw new Error("fixture should be AnnData / MuData");

const ad = AnnData.from(parsed);
console.log("nObs:", ad.nObs, "nVar:", ad.nVars);

const arrowTable = toArrowTable(ad.accessor.obs);
console.log("Arrow table schema:", arrowTable.names);
console.log("Arrow table numRows:", arrowTable.numRows, "numCols:", arrowTable.numCols);
