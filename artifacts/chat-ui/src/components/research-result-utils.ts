import type { ResearchDebateEntry, ResearchResult } from "@workspace/api-zod";

const INLINE_CITATION_PATTERN = /\[\[(\d+)\]\]/g;

export type ResearchSourceEntry = {
  ordinal: number;
  title: string;
  domain: string;
  url: string;
  excerpts: string[];
};

export function replaceInlineCitationTokens(
  answer: string,
  validOrdinals: Set<number>,
) {
  return answer.replace(INLINE_CITATION_PATTERN, (_match, rawOrdinal) => {
    const ordinal = Number(rawOrdinal);
    return validOrdinals.has(ordinal)
      ? `[${ordinal}](#research-source-${ordinal})`
      : "";
  });
}

export function groupDebateEntriesByRound(
  debate: ResearchDebateEntry[],
): Map<number, ResearchDebateEntry[]> {
  const groups = new Map<number, ResearchDebateEntry[]>();
  for (const entry of debate) {
    const existing = groups.get(entry.round) ?? [];
    groups.set(entry.round, [...existing, entry]);
  }
  return groups;
}

export function getRoundLabel(round: number): string {
  if (round === 0) return "Initial Analysis";
  if (round === 1) return "Round 1 — Opening";
  return `Round ${round}`;
}

export function getModelDisplayName(model: string): string {
  if (model.includes("gpt")) return "GPT";
  if (model.includes("claude")) return "Claude";
  if (model.includes("gemini")) return "Gemini";
  return model;
}

export function buildResearchSourceEntries(
  result: ResearchResult,
  debate: ResearchDebateEntry[],
): ResearchSourceEntry[] {
  const excerptsBySourceId = new Map<string, string[]>();

  for (const entry of debate) {
    for (const citation of entry.citations) {
      if (!citation?.excerpt) {
        continue;
      }
      const excerpt = citation.excerpt.trim();
      if (!excerpt) {
        continue;
      }

      const existing = excerptsBySourceId.get(citation.sourceId) ?? [];
      if (!existing.includes(excerpt)) {
        excerptsBySourceId.set(citation.sourceId, [...existing, excerpt]);
      }
    }
  }

  return [...result.sources]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((source) => ({
      ordinal: source.ordinal,
      title: source.title,
      domain: source.domain,
      url: source.url,
      excerpts: excerptsBySourceId.get(source.sourceId) ?? [],
    }));
}
