import { describe, expect, it } from "vitest";
import { printUsage } from "../src/usage.js";

describe("usage", () => {
  it("prints static usage text", () => {
    const outputs: string[] = [];
    printUsage({
      stdout: (message: string) => {
        outputs.push(message);
      },
    });

    expect(outputs[0]).toContain("Usage:");
    expect(outputs[0]).toContain("cli setup");
    expect(outputs[0]).toContain("cli flow sync-allocation");
    expect(outputs[0]).toContain("cli flow sync-allocation-for-account");
    expect(outputs[0]).toContain("cli flow clear-stale-allocation");
    expect(outputs[0]).toContain("cli revnet pay");
  });
});
