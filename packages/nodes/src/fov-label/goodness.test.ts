import { describe, expect, test } from "bun:test";
import { cycleGoodness, GOODNESS_ORDER, goodnessCode, parseGoodness } from "./goodness";

describe("parseGoodness", () => {
  test("maps the on-disk numeric encoding", () => {
    expect(parseGoodness(1)).toBe("good");
    expect(parseGoodness(0)).toBe("neutral");
    expect(parseGoodness(-1)).toBe("bad");
  });

  test("accepts the string forms a SQL round-trip can produce", () => {
    expect(parseGoodness("1.0")).toBe("good");
    expect(parseGoodness("-1.0")).toBe("bad");
    expect(parseGoodness("0.0")).toBe("neutral");
  });

  test("treats missing and unparseable values as unlabeled, never as neutral", () => {
    // A NaN feature means "could not be measured"; reading it as neutral would
    // silently invent ground truth.
    for (const empty of [null, undefined, "", Number.NaN, "nan", {}]) {
      expect(parseGoodness(empty)).toBe("unlabeled");
    }
  });
});

describe("goodnessCode", () => {
  test("round-trips every labeled value", () => {
    for (const value of GOODNESS_ORDER) {
      if (value === "unlabeled") continue;
      expect(parseGoodness(goodnessCode(value))).toBe(value);
    }
  });

  test("clears the label with null rather than a numeric sentinel", () => {
    expect(goodnessCode("unlabeled")).toBeNull();
  });
});

describe("cycleGoodness", () => {
  test("first click on an unlabeled FOV marks it good", () => {
    expect(cycleGoodness("unlabeled")).toBe("good");
  });

  test("cycles back to where it started", () => {
    let value = cycleGoodness("unlabeled");
    for (let i = 0; i < GOODNESS_ORDER.length - 1; i++) value = cycleGoodness(value);
    expect(value).toBe("unlabeled");
  });
});
