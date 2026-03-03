import { describe, expect, it } from "vitest";
import { isLoopbackHost, normalizeApiUrlInput, parseAndValidateApiBaseUrl } from "../src/url.js";

describe("url helpers", () => {
  it("detects loopback hosts case-insensitively", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("api.example")).toBe(false);
  });

  it("validates absolute api base urls for https and loopback http", () => {
    expect(parseAndValidateApiBaseUrl("https://api.example").toString()).toBe("https://api.example/");
    expect(parseAndValidateApiBaseUrl("http://localhost:3000").toString()).toBe("http://localhost:3000/");
  });

  it("rejects invalid api base urls", () => {
    expect(() => parseAndValidateApiBaseUrl("api.example")).toThrow(
      "API base URL is invalid. Use an absolute https URL."
    );
    expect(() => parseAndValidateApiBaseUrl("https://user:pass@api.example")).toThrow(
      "API base URL must not include username or password."
    );
    expect(() => parseAndValidateApiBaseUrl("http://api.example")).toThrow(
      "API base URL must use https (http is allowed only for localhost, 127.0.0.1, or [::1])."
    );
  });

  it("normalizes urls by inferring protocol", () => {
    expect(normalizeApiUrlInput("co.build", "Interface URL")).toBe("https://co.build");
    expect(normalizeApiUrlInput("localhost:3000", "Interface URL")).toBe("http://localhost:3000");
    expect(normalizeApiUrlInput("[::1]:4000", "Chat API URL")).toBe("http://[::1]:4000");
  });

  it("returns full url when path/search/hash are present", () => {
    expect(normalizeApiUrlInput("https://api.example/v1?x=1#y", "Chat API URL")).toBe(
      "https://api.example/v1?x=1#y"
    );
  });

  it("rejects invalid normalization inputs", () => {
    expect(() => normalizeApiUrlInput("   ", "Interface URL")).toThrow("Interface URL cannot be empty.");
    expect(() => normalizeApiUrlInput("https://user:pass@api.example", "Interface URL")).toThrow(
      "Interface URL must not include username or password."
    );
    expect(() => normalizeApiUrlInput("http://api.example", "Chat API URL")).toThrow(
      "Chat API URL must use https (http is allowed only for localhost, 127.0.0.1, or [::1])."
    );
    expect(() => normalizeApiUrlInput("https://api.example:99999", "Interface URL")).toThrow(
      "Interface URL is invalid. Use a full URL like https://co.build or http://localhost:3000."
    );
  });
});
