import { describe, expect, it } from "vitest";
import { deleteJsonPointer, readJsonPointer, writeJsonPointer } from "../src/secrets/json-pointer.js";

describe("secrets json-pointer", () => {
  it("reads nested values and escaped segments", () => {
    const payload = {
      "a/b": {
        "til~de": "value",
      },
    };

    expect(readJsonPointer(payload, "/a~1b/til~0de")).toBe("value");
  });

  it("throws on invalid pointers and missing paths", () => {
    expect(() => readJsonPointer({}, "not-a-pointer")).toThrow("Invalid JSON pointer");
    expect(() => readJsonPointer({}, "/missing")).toThrow("Missing JSON pointer path");
  });

  it("writes nested values and supports the root empty segment", () => {
    const payload: Record<string, unknown> = {};
    writeJsonPointer(payload, "/top/inner", "secret");
    writeJsonPointer(payload, "/", "empty-key");

    expect(payload).toEqual({
      top: {
        inner: "secret",
      },
      "": "empty-key",
    });
  });

  it("deletes existing pointers and returns false for missing/non-object paths", () => {
    const payload: Record<string, unknown> = {
      top: {
        inner: "value",
        keep: true,
      },
    };

    expect(deleteJsonPointer(payload, "/top/inner")).toBe(true);
    expect(deleteJsonPointer(payload, "/top/missing")).toBe(false);
    expect(deleteJsonPointer(payload, "/top/keep/deeper")).toBe(false);
    expect(payload).toEqual({
      top: {
        keep: true,
      },
    });
  });
});
