import { open, AnnDataAccessor, toArrowTable } from "../src/index.ts";

const tree = await open("./fixtures/test-mudata.zarr");
console.log("opened:", tree);

const ad = AnnDataAccessor.from(tree);
console.log("nObs:", ad.nObs, "nVar:", ad.nVar);

const arrowTable = toArrowTable(ad.obs);
console.log("Arrow table schema:", arrowTable.names);
console.log("Arrow table numRows:", arrowTable.numRows, "numCols:", arrowTable.numCols);
