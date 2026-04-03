import { randomUUID } from "node:crypto";

import type {
  ResearchEvidence,
  ResearchSource,
  ResearchWarning,
} from "@workspace/api-zod";
import type Exa from "exa-js";

type RawExaResult = {
  title?: string | null;
  url?: string;
  text?: string;
};

export type EvidenceCollectionResult = {
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
  warnings: ResearchWarning[];
  success: boolean;
  error?: string;
};

const MAX_QUERY_PASSES = 3;
const MAX_ACCEPTED_SOURCES = 8;
const MAX_RETRIES = 1;
const EXCERPTS_PER_SOURCE = 3;
const EXCERPT_MAX_CHARS = 500;

export type TargetedSearchResult = {
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
  warnings: ResearchWarning[];
  success: boolean;
};

export class EvidenceLedger {
  private exaClient: Exa;

  constructor(exaClient: Exa) {
    this.exaClient = exaClient;
  }

  async searchTargeted(
    query: string,
    existingUrls: Set<string>,
    startingOrdinal: number,
    options: { signal?: AbortSignal } = {},
  ): Promise<TargetedSearchResult> {
    const { signal } = options;
    throwIfAborted(signal);

    const passResult = await this.runPassWithRetry(query, signal);

    if (!passResult.success) {
      return {
        sources: [],
        evidence: [],
        warnings: [
          {
            code: "SEARCH_FAILED",
            message: `Search failed: ${passResult.error}`,
          },
        ],
        success: false,
      };
    }

    const warnings: ResearchWarning[] = [];
    if (passResult.retried) {
      warnings.push({
        code: "EXA_RETRY",
        message: "Search recovered after retry.",
      });
    }

    const sources: ResearchSource[] = [];
    const evidence: ResearchEvidence[] = [];
    let ordinal = startingOrdinal;

    for (const result of passResult.results) {
      const normalizedUrl = normalizeUrl(result.url ?? "");
      if (!normalizedUrl || existingUrls.has(normalizedUrl)) {
        continue;
      }

      const sourceId = randomUUID();
      const title = normalizeTitle(result.title, normalizedUrl);
      const domain = extractDomain(normalizedUrl);

      sources.push({
        sourceId,
        ordinal,
        title,
        domain,
        url: normalizedUrl,
        retrievedAt: new Date(),
      });
      existingUrls.add(normalizedUrl);
      ordinal += 1;

      const excerpts = buildExcerpts(result.text ?? "");
      for (const excerpt of excerpts) {
        evidence.push({
          evidenceId: randomUUID(),
          sourceId,
          excerpt,
        });
      }
    }

    return { sources, evidence, warnings, success: true };
  }

  async collectEvidence(
    query: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<EvidenceCollectionResult> {
    const { signal } = options;
    const sources: ResearchSource[] = [];
    const evidence: ResearchEvidence[] = [];
    const warnings: ResearchWarning[] = [];
    const seenUrls = new Set<string>();
    let budgetWarningAdded = false;

    for (
      let pass = 1;
      pass <= MAX_QUERY_PASSES && sources.length < MAX_ACCEPTED_SOURCES;
      pass += 1
    ) {
      throwIfAborted(signal);
      const passResult = await this.runPassWithRetry(query, signal);
      throwIfAborted(signal);

      if (!passResult.success) {
        if (evidence.length === 0) {
          return {
            sources,
            evidence,
            warnings,
            success: false,
            error: passResult.error,
          };
        }

        warnings.push({
          code: "EXA_PASS_FAILED",
          message: `Exa query pass ${pass} failed: ${passResult.error}`,
        });
        break;
      }

      if (passResult.retried) {
        warnings.push({
          code: "EXA_RETRY",
          message: `Exa transient failure recovered on retry during pass ${pass}.`,
        });
      }

      for (const result of passResult.results) {
        const normalizedUrl = normalizeUrl(result.url ?? "");
        if (!normalizedUrl || seenUrls.has(normalizedUrl)) {
          continue;
        }

        if (sources.length >= MAX_ACCEPTED_SOURCES) {
          if (!budgetWarningAdded) {
            warnings.push({
              code: "SOURCE_BUDGET_REACHED",
              message: `Accepted source budget of ${MAX_ACCEPTED_SOURCES} unique URLs reached.`,
            });
            budgetWarningAdded = true;
          }
          break;
        }

        const now = new Date();
        const sourceId = randomUUID();
        const title = normalizeTitle(result.title, normalizedUrl);
        const domain = extractDomain(normalizedUrl);
        const ordinal = sources.length + 1;

        sources.push({
          sourceId,
          ordinal,
          title,
          domain,
          url: normalizedUrl,
          retrievedAt: now,
        });
        seenUrls.add(normalizedUrl);

        const excerpts = buildExcerpts(result.text ?? "");
        for (const excerpt of excerpts) {
          evidence.push({
            evidenceId: randomUUID(),
            sourceId,
            excerpt,
          });
        }
      }
    }

    if (sources.length >= MAX_ACCEPTED_SOURCES && !budgetWarningAdded) {
      warnings.push({
        code: "SOURCE_BUDGET_REACHED",
        message: `Accepted source budget of ${MAX_ACCEPTED_SOURCES} unique URLs reached.`,
      });
      budgetWarningAdded = true;
    }

    if (evidence.length === 0) {
      return {
        sources,
        evidence,
        warnings,
        success: false,
        error:
          "Failed to retrieve usable evidence from Exa after retries and query passes.",
      };
    }

    return {
      sources,
      evidence,
      warnings,
      success: true,
    };
  }

  private async runPassWithRetry(
    query: string,
    signal?: AbortSignal,
  ): Promise<
    | {
        success: true;
        results: RawExaResult[];
        retried: boolean;
      }
    | {
        success: false;
        error: string;
        retried: boolean;
      }
  > {
    let retries = 0;

    while (retries <= MAX_RETRIES) {
      try {
        throwIfAborted(signal);
        const response = await this.exaClient.searchAndContents(query, {
          type: "auto",
          numResults: 8,
          text: { maxCharacters: 2500 },
          signal,
        });

        const maybeResults = (response as { results?: unknown }).results;
        if (!Array.isArray(maybeResults)) {
          return {
            success: true,
            results: [],
            retried: retries > 0,
          };
        }

        const results = maybeResults
          .map((item): RawExaResult | null => {
            if (!item || typeof item !== "object") {
              return null;
            }

            const candidate = item as {
              title?: unknown;
              url?: unknown;
              text?: unknown;
            };

            const url =
              typeof candidate.url === "string" ? candidate.url.trim() : "";
            if (!url) {
              return null;
            }

            return {
              title:
                typeof candidate.title === "string" ? candidate.title : null,
              url,
              text: typeof candidate.text === "string" ? candidate.text : "",
            };
          })
          .filter((item): item is RawExaResult => item !== null);

        return {
          success: true,
          results,
          retried: retries > 0,
        };
      } catch (error) {
        if (!isTransientExaError(error)) {
          return {
            success: false,
            error: getErrorMessage(error),
            retried: retries > 0,
          };
        }

        if (retries >= MAX_RETRIES) {
          return {
            success: false,
            error: getErrorMessage(error),
            retried: true,
          };
        }

        retries += 1;
      }
    }

    return {
      success: false,
      error: "Exa query pass failed unexpectedly.",
      retried: retries > 0,
    };
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Research run aborted");
  }
}

function normalizeUrl(input: string): string {
  const value = input.trim();
  if (!value) {
    return "";
  }

  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

function normalizeTitle(title: string | null | undefined, url: string): string {
  const value = typeof title === "string" ? title.trim() : "";
  return value || url;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function buildExcerpts(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const chunks = normalized
    .split(/\n{2,}/)
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .filter((chunk) => chunk.length > 0)
    .slice(0, EXCERPTS_PER_SOURCE)
    .map((chunk) => {
      if (chunk.length <= EXCERPT_MAX_CHARS) {
        return chunk;
      }
      return `${chunk.slice(0, EXCERPT_MAX_CHARS).trim()}...`;
    });

  if (chunks.length > 0) {
    return chunks;
  }

  return [
    normalized.length <= EXCERPT_MAX_CHARS
      ? normalized
      : `${normalized.slice(0, EXCERPT_MAX_CHARS).trim()}...`,
  ];
}

function isTransientExaError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status !== null) {
    if (status === 408 || status === 425 || status === 429) {
      return true;
    }

    if (status >= 500 && status <= 599) {
      return true;
    }
  }

  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("network") ||
    message.includes("temporar") ||
    message.includes("rate limit")
  );
}

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as { status?: unknown; statusCode?: unknown };
  if (typeof candidate.status === "number") {
    return candidate.status;
  }

  if (typeof candidate.statusCode === "number") {
    return candidate.statusCode;
  }

  return null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown Exa error";
}
