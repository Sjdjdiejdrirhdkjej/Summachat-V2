import { describe, expect, it } from "vitest";
import { assertVercelProductionApiOrigin } from "./vite-vercel-api-guard";

describe("assertVercelProductionApiOrigin", () => {
  it("does nothing when not production mode", () => {
    expect(() =>
      assertVercelProductionApiOrigin("development", {
        VERCEL: "1",
      }),
    ).not.toThrow();
  });

  it("does nothing when not on Vercel", () => {
    expect(() =>
      assertVercelProductionApiOrigin("production", {
        VERCEL: undefined,
      }),
    ).not.toThrow();
  });

  it("does nothing when VITE_API_ORIGIN is set", () => {
    expect(() =>
      assertVercelProductionApiOrigin("production", {
        VERCEL: "1",
        VITE_API_ORIGIN: "https://api.example.com",
      }),
    ).not.toThrow();
  });

  it("throws when VITE_API_ORIGIN is whitespace-only (treated as missing)", () => {
    expect(() =>
      assertVercelProductionApiOrigin("production", {
        VERCEL: "1",
        VITE_API_ORIGIN: "   ",
      }),
    ).toThrow(/set VITE_API_ORIGIN/);
  });

  it("throws on Vercel production without API origin or escape hatch", () => {
    expect(() =>
      assertVercelProductionApiOrigin("production", {
        VERCEL: "1",
      }),
    ).toThrow(/VITE_API_ORIGIN/);
  });

  it("allows same-origin API when VITE_ALLOW_SAME_ORIGIN_API=1", () => {
    expect(() =>
      assertVercelProductionApiOrigin("production", {
        VERCEL: "1",
        VITE_ALLOW_SAME_ORIGIN_API: "1",
      }),
    ).not.toThrow();
  });
});
