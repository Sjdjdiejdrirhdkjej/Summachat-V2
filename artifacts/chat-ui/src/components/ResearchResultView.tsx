import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResearchDebateEntry, ResearchResult } from "@workspace/api-zod";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import {
  buildResearchSourceEntries,
  replaceInlineCitationTokens,
  groupDebateEntriesByRound,
  getRoundLabel,
  getModelDisplayName,
} from "./research-result-utils";

function CitationChip({
  ordinal,
  onClick,
}: {
  ordinal: number;
  onClick: (ordinal: number) => void;
}) {
  return (
    <button
      type="button"
      data-testid="citation-chip"
      onClick={() => onClick(ordinal)}
      className="mx-0.5 inline-flex items-center rounded-md border border-cyan-800/60 bg-cyan-950/30 px-1.5 py-0.5 text-[11px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-900/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
      aria-label={`Jump to source ${ordinal}`}
    >
      [{ordinal}]
    </button>
  );
}

export function ResearchResultView({
  result,
  debate,
}: {
  result: ResearchResult;
  debate: ResearchDebateEntry[];
}) {
  const [highlightedOrdinal, setHighlightedOrdinal] = useState<number | null>(
    null,
  );
  const sourceRefs = useRef(new Map<number, HTMLDivElement>());
  const highlightTimeoutRef = useRef<number | null>(null);

  const sourceEntries = useMemo(
    () => buildResearchSourceEntries(result, debate),
    [debate, result],
  );
  const validOrdinals = useMemo(
    () => new Set(sourceEntries.map((source) => source.ordinal)),
    [sourceEntries],
  );
  const renderedAnswer = useMemo(
    () => replaceInlineCitationTokens(result.answer, validOrdinals),
    [result.answer, validOrdinals],
  );

  const focusSource = useCallback(
    (ordinal: number) => {
      if (!validOrdinals.has(ordinal)) {
        return;
      }

      setHighlightedOrdinal(ordinal);
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
      highlightTimeoutRef.current = window.setTimeout(() => {
        setHighlightedOrdinal((current) =>
          current === ordinal ? null : current,
        );
      }, 1800);

      sourceRefs.current.get(ordinal)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    },
    [validOrdinals],
  );

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="space-y-3">
      <div
        data-testid="research-final-answer"
        className="rounded-lg border border-border bg-background/60 px-3 py-2.5"
      >
        <Markdown
          className="prose-p:mb-2 prose-p:last:mb-0"
          components={{
            a({ href, children, ...props }) {
              const citationMatch = href?.match(/^#research-source-(\d+)$/);

              if (citationMatch) {
                const ordinal = Number(citationMatch[1]);

                if (!validOrdinals.has(ordinal)) {
                  return null;
                }

                return <CitationChip ordinal={ordinal} onClick={focusSource} />;
              }

              return (
                <a
                  {...props}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all"
                >
                  {children}
                </a>
              );
            },
          }}
        >
          {renderedAnswer}
        </Markdown>
      </div>

      {sourceEntries.length > 0 && (
        <section
          data-testid="research-source-panel"
          className="rounded-lg border border-border bg-background/60 px-3 py-3"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Sources
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Supporting sources used in the final research answer
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {sourceEntries.length} total
            </span>
          </div>

          <div className="mt-3 space-y-2">
            {sourceEntries.map((source) => (
              <div
                key={source.ordinal}
                id={`research-source-${source.ordinal}`}
                ref={(element) => {
                  if (element) {
                    sourceRefs.current.set(source.ordinal, element);
                    return;
                  }

                  sourceRefs.current.delete(source.ordinal);
                }}
                className={cn(
                  "rounded-lg border border-border bg-card/40 px-3 py-3 transition-colors",
                  highlightedOrdinal === source.ordinal &&
                    "border-cyan-700 bg-cyan-950/20",
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-7 min-w-7 items-center justify-center rounded-md border border-cyan-800/60 bg-cyan-950/30 px-2 text-[11px] font-semibold text-cyan-200">
                    [{source.ordinal}]
                  </div>

                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-sm font-medium leading-snug text-foreground">
                      {source.title}
                    </p>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-cyan-300 transition-colors hover:text-cyan-200"
                      >
                        {source.domain}
                      </a>
                      <span className="text-muted-foreground">•</span>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {source.url}
                      </a>
                    </div>

                    {source.excerpts[0] ? (
                      <div className="rounded-md border border-border bg-background/70 px-2.5 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Supporting excerpt
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-foreground/90">
                          {source.excerpts[0]}
                        </p>
                        {source.excerpts.length > 1 && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {source.excerpts.length} supporting excerpts
                            captured in the research ledger
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No supporting excerpt was attached to this source.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {debate.length > 0 && (
        <section
          data-testid="research-debate-panel"
          className="rounded-lg border border-border bg-background/60 px-3 py-3"
        >
          <div className="border-b border-border pb-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Panel Discussion
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Multi-model group debate with opening statements, discussion, and consensus
            </p>
          </div>

          <div className="mt-3 space-y-4">
            {Array.from(groupDebateEntriesByRound(debate)).map(
              ([round, entries]) => (
                <div key={round}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                      {getRoundLabel(round)}
                    </span>
                    <span className="text-[10px] text-muted-foreground/80">
                      {entries.length}{" "}
                      {entries.length === 1 ? "entry" : "entries"}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {entries.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-lg border border-border bg-muted/30 px-3 py-2.5"
                      >
                        <div className="mb-1.5 flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                              entry.model.includes("gpt") &&
                                "border border-emerald-800/60 bg-emerald-950/30 text-emerald-300",
                              entry.model.includes("claude") &&
                                "border border-orange-800/60 bg-orange-950/30 text-orange-300",
                              entry.model.includes("gemini") &&
                                "border border-blue-800/60 bg-blue-950/30 text-blue-300",
                              !entry.model.includes("gpt") &&
                                !entry.model.includes("claude") &&
                                !entry.model.includes("gemini") &&
                                "border border-border bg-muted/60 text-foreground/90",
                            )}
                          >
                            {getModelDisplayName(entry.model)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {entry.type}
                          </span>
                        </div>

                        <Markdown
                          className="prose-p:mb-1.5 prose-p:text-xs prose-p:leading-relaxed prose-p:text-foreground/90"
                          components={{
                            a({ href, children, ...props }) {
                              const citationMatch = href?.match(
                                /^#research-source-(\d+)$/,
                              );

                              if (citationMatch) {
                                const ordinal = Number(citationMatch[1]);

                                if (!validOrdinals.has(ordinal)) {
                                  return null;
                                }

                                return (
                                  <CitationChip
                                    ordinal={ordinal}
                                    onClick={focusSource}
                                  />
                                );
                              }

                              return (
                                <a
                                  {...props}
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="break-all"
                                >
                                  {children}
                                </a>
                              );
                            },
                          }}
                        >
                          {replaceInlineCitationTokens(
                            entry.content,
                            validOrdinals,
                          )}
                        </Markdown>
                      </div>
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        </section>
      )}
    </div>
  );
}
