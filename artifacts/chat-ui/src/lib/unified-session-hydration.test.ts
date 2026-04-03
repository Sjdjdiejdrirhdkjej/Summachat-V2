import { describe, expect, it } from "vitest";
import { shouldApplyBlankDefaultsForNewSession } from "./unified-session-hydration";

describe("shouldApplyBlankDefaultsForNewSession", () => {
  it("returns true only when there is no local activity yet", () => {
    expect(
      shouldApplyBlankDefaultsForNewSession({
        turnCount: 0,
        promptTrimmedLength: 0,
      }),
    ).toBe(true);
  });

  it("returns false when a turn already exists (e.g. user sent before fingerprint resolved)", () => {
    expect(
      shouldApplyBlankDefaultsForNewSession({
        turnCount: 1,
        promptTrimmedLength: 0,
      }),
    ).toBe(false);
  });

  it("returns false when the composer has non-empty text before hydration", () => {
    expect(
      shouldApplyBlankDefaultsForNewSession({
        turnCount: 0,
        promptTrimmedLength: 3,
      }),
    ).toBe(false);
  });
});
