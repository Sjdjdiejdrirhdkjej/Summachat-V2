import type Exa from "exa-js";
import { describe, expect, it, vi } from "vitest";

import { EvidenceLedger } from "./evidence-ledger";

type MockSearchResult = {
  title?: string | null;
  url: string;
  text?: string;
};

function createExaMock() {
  const searchAndContents = vi.fn();
  const client = {
    searchAndContents,
  } as unknown as Exa;

  return { client, searchAndContents };
}

function createResponse(results: MockSearchResult[]) {
  return { results };
}

describe("EvidenceLedger", () => {
  it("collects evidence across multiple query passes", async () => {
    const { client, searchAndContents } = createExaMock();
    searchAndContents
      .mockResolvedValueOnce(
        createResponse([
          {
            title: "Alpha",
            url: "https://alpha.example.com/path",
            text: "Alpha paragraph 1\n\nAlpha paragraph 2",
          },
        ]),
      )
      .mockResolvedValueOnce(
        createResponse([
          {
            title: "Beta",
            url: "https://beta.example.com/post",
            text: "Beta text",
          },
        ]),
      )
      .mockResolvedValueOnce(
        createResponse([
          {
            title: "",
            url: "https://gamma.example.com/news",
            text: "Gamma text",
          },
        ]),
      );

    const ledger = new EvidenceLedger(client);
    const result = await ledger.collectEvidence("research query");

    expect(result.success).toBe(true);
    expect(searchAndContents).toHaveBeenCalledTimes(3);
    expect(result.sources).toHaveLength(3);
    expect(result.sources.map((source) => source.ordinal)).toEqual([1, 2, 3]);
    expect(result.sources[2]?.title).toBe("https://gamma.example.com/news");
    expect(result.sources[0]?.domain).toBe("alpha.example.com");
    expect(result.evidence.length).toBeGreaterThanOrEqual(3);
    expect(result.evidence.every((item) => item.evidenceId.length > 0)).toBe(
      true,
    );
  });

  it("deduplicates the same URL across passes", async () => {
    const { client, searchAndContents } = createExaMock();
    searchAndContents
      .mockResolvedValueOnce(
        createResponse([
          {
            title: "Original",
            url: "https://dup.example.com/article",
            text: "Original text",
          },
        ]),
      )
      .mockResolvedValueOnce(
        createResponse([
          {
            title: "Duplicate",
            url: "https://dup.example.com/article",
            text: "Duplicate text",
          },
          {
            title: "Unique",
            url: "https://unique.example.com/article",
            text: "Unique text",
          },
        ]),
      )
      .mockResolvedValueOnce(createResponse([]));

    const ledger = new EvidenceLedger(client);
    const result = await ledger.collectEvidence("dedupe query");

    expect(result.success).toBe(true);
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]?.title).toBe("Original");
    expect(result.sources[0]?.ordinal).toBe(1);
    expect(result.sources[1]?.ordinal).toBe(2);
    expect(result.evidence).toHaveLength(2);
  });

  it("enforces accepted source budget at 8 unique sources", async () => {
    const { client, searchAndContents } = createExaMock();

    const passOne = Array.from({ length: 6 }, (_, index) => ({
      title: `Source ${index + 1}`,
      url: `https://budget-${index + 1}.example.com/a`,
      text: `Evidence ${index + 1}`,
    }));

    const passTwo = Array.from({ length: 6 }, (_, index) => ({
      title: `Source ${index + 7}`,
      url: `https://budget-${index + 7}.example.com/a`,
      text: `Evidence ${index + 7}`,
    }));

    searchAndContents
      .mockResolvedValueOnce(createResponse(passOne))
      .mockResolvedValueOnce(createResponse(passTwo));

    const ledger = new EvidenceLedger(client);
    const result = await ledger.collectEvidence("budget query");

    expect(result.success).toBe(true);
    expect(result.sources).toHaveLength(8);
    expect(result.sources.map((source) => source.ordinal)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(
      result.warnings.some(
        (warning) => warning.code === "SOURCE_BUDGET_REACHED",
      ),
    ).toBe(true);
    expect(searchAndContents).toHaveBeenCalledTimes(2);
  });

  it("retries once on transient Exa failure", async () => {
    const { client, searchAndContents } = createExaMock();
    searchAndContents
      .mockRejectedValueOnce(new Error("request timeout"))
      .mockResolvedValueOnce(
        createResponse([
          {
            title: "Recovered",
            url: "https://retry.example.com/post",
            text: "Recovered evidence",
          },
        ]),
      )
      .mockResolvedValueOnce(createResponse([]))
      .mockResolvedValueOnce(createResponse([]));

    const ledger = new EvidenceLedger(client);
    const result = await ledger.collectEvidence("retry query");

    expect(result.success).toBe(true);
    expect(searchAndContents).toHaveBeenCalledTimes(4);
    expect(result.sources).toHaveLength(1);
    expect(result.evidence).toHaveLength(1);
    expect(
      result.warnings.some((warning) => warning.code === "EXA_RETRY"),
    ).toBe(true);
  });

  it("returns retrieval failure on permanent Exa failure", async () => {
    const { client, searchAndContents } = createExaMock();
    searchAndContents.mockRejectedValueOnce(new Error("bad request"));

    const ledger = new EvidenceLedger(client);
    const result = await ledger.collectEvidence("failure query");

    expect(result.success).toBe(false);
    expect(result.error).toContain("bad request");
    expect(result.sources).toHaveLength(0);
    expect(result.evidence).toHaveLength(0);
  });

  it("returns terminal retrieval failure when evidence remains empty", async () => {
    const { client, searchAndContents } = createExaMock();
    searchAndContents
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValueOnce(
        createResponse([
          {
            title: "No excerpt",
            url: "https://empty.example.com/page",
            text: "",
          },
        ]),
      )
      .mockResolvedValueOnce(createResponse([]))
      .mockResolvedValueOnce(createResponse([]));

    const ledger = new EvidenceLedger(client);
    const result = await ledger.collectEvidence("empty query");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to retrieve usable evidence");
    expect(result.sources).toHaveLength(1);
    expect(result.evidence).toHaveLength(0);
  });
});
