import { describe, expect, it } from "vitest";
import { printJson } from "../src/output.js";

describe("output", () => {
  it("prints formatted JSON to stdout", () => {
    const outputs: string[] = [];
    printJson(
      {
        stdout: (value: string) => {
          outputs.push(value);
        },
      },
      { ok: true, nested: { count: 1 } }
    );

    expect(outputs).toEqual([
      JSON.stringify(
        {
          ok: true,
          nested: { count: 1 },
        },
        null,
        2
      ),
    ]);
  });
});
