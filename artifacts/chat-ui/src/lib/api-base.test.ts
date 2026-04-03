import { afterEach, describe, expect, it, vi } from "vitest";
import { getApiBase, resolveApiUrl } from "./api-base";

describe("getApiBase / resolveApiUrl (static UI vs API host)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("without VITE_API_ORIGIN, keeps same-origin paths for Vite dev proxy", () => {
    vi.stubEnv("VITE_API_ORIGIN", "");
    vi.stubEnv("BASE_URL", "/");

    expect(getApiBase()).toBe("");
    expect(resolveApiUrl("/api/chat")).toBe("/api/chat");
    expect(resolveApiUrl("/api/multi-chat")).toBe("/api/multi-chat");
  });

  it("with VITE_API_ORIGIN, targets the API host so /api is not requested from the static page origin (e.g. Vercel)", () => {
    vi.stubEnv("VITE_API_ORIGIN", "https://api.example.com");
    vi.stubEnv("BASE_URL", "/");

    expect(getApiBase()).toBe("https://api.example.com");
    expect(resolveApiUrl("/api/chat")).toBe("https://api.example.com/api/chat");
    expect(resolveApiUrl("/api/research/runs/x/events")).toBe(
      "https://api.example.com/api/research/runs/x/events",
    );
  });

  it("strips trailing slash from VITE_API_ORIGIN", () => {
    vi.stubEnv("VITE_API_ORIGIN", "https://api.example.com/");
    vi.stubEnv("BASE_URL", "/");

    expect(resolveApiUrl("/api/chat")).toBe("https://api.example.com/api/chat");
  });

  it("passes through absolute http(s) URLs unchanged", () => {
    vi.stubEnv("VITE_API_ORIGIN", "https://api.example.com");
    vi.stubEnv("BASE_URL", "/");

    expect(resolveApiUrl("https://other.example.com/api/chat")).toBe(
      "https://other.example.com/api/chat",
    );
  });

  it("joins non-leading-slash paths to base", () => {
    vi.stubEnv("VITE_API_ORIGIN", "https://api.example.com");
    vi.stubEnv("BASE_URL", "/");

    expect(resolveApiUrl("api/chat")).toBe("https://api.example.com/api/chat");
  });
});
