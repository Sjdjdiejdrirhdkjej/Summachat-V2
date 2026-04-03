import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { resolveApiUrl } from "@/lib/api-base";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/Markdown";
import { getFingerprint } from "@/lib/fingerprint";
import { ChatSidebar } from "@/components/ChatSidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import type { ModelId, ModelState, SearchResult } from "@/types/chat";
import {
  getOrCreateAnonymousOwnerId,
  type ImageGenerationResult,
} from "@/lib/image-owner";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  getSession,
  saveSession,
  createStoredSession,
  updateStoredSession,
  type StoredSession,
  type UnifiedTurn,
  type ComposerMode,
} from "@/lib/session-store";
import { shouldApplyBlankDefaultsForNewSession } from "@/lib/unified-session-hydration";

// Model definitions
const MODELS = [
  {
    id: "gpt-5.2" as ModelId,
    label: "GPT 5.4",
    shortLabel: "GPT",
    provider: "OpenAI",
    color: "bg-emerald-500",
    borderColor: "border-emerald-500",
    headerClass: "bg-emerald-950/60 border-emerald-800",
    chipActive: "bg-emerald-900/60 border-emerald-500 text-emerald-300",
    chipInactive:
      "bg-muted/30 border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-muted-foreground",
    icon: "/logo-openai.png",
  },
  {
    id: "claude-opus-4-6" as ModelId,
    label: "Claude Opus 4.6",
    shortLabel: "Claude",
    provider: "Anthropic",
    color: "bg-orange-500",
    borderColor: "border-orange-500",
    headerClass: "bg-orange-950/60 border-orange-800",
    chipActive: "bg-orange-900/60 border-orange-500 text-orange-300",
    chipInactive:
      "bg-muted/30 border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-muted-foreground",
    icon: "/logo-anthropic.png",
  },
  {
    id: "gemini-3.1-pro-preview" as ModelId,
    label: "Gemini 3.1 Pro",
    shortLabel: "Gemini",
    provider: "Google",
    color: "bg-blue-500",
    borderColor: "border-blue-500",
    headerClass: "bg-blue-950/60 border-blue-800",
    chipActive: "bg-blue-900/60 border-blue-500 text-blue-300",
    chipInactive:
      "bg-muted/30 border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-muted-foreground",
    icon: "/logo-gemini.png",
  },
] as const;

const MODEL_MAP = Object.fromEntries(MODELS.map((m) => [m.id, m])) as Record<
  ModelId,
  (typeof MODELS)[number]
>;

// Local type aliases for the component
type TextTurn = Extract<UnifiedTurn, { type: "text" }>;
type CompareTurn = Extract<UnifiedTurn, { type: "compare" }>;
type ImageTurn = Extract<UnifiedTurn, { type: "image" }>;

// Error messages
const INCOMPLETE_MODEL_ERROR =
  "Connection ended before this model produced a complete response.";
const MISSING_MODEL_TERMINAL_ERROR =
  "This model never reached a terminal response state.";

// Auto-scroll component
function AutoScrollBox({
  streaming,
  className,
  children,
}: {
  streaming: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (streaming && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  });

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

// Mode chip component
function ModeChip({
  mode,
  active,
  onClick,
  disabled,
}: {
  mode: ComposerMode;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  const configs = {
    ask: {
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
      ),
      label: "Ask",
    },
    compare: {
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      ),
      label: "Precise",
    },
    image: {
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15-5-5-4.5 4.5" />
        </svg>
      ),
      label: "Image",
    },
  };

  const config = configs[mode];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 rounded-full border text-xs font-medium transition-all min-h-[40px]",
        active
          ? "bg-primary border-primary text-primary-foreground"
          : "bg-muted/30 border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground/90",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      {config.icon}
      <span className="hidden sm:inline">{config.label}</span>
    </button>
  );
}

// Single model dropdown for Ask mode
function SingleModelDropdown({
  selectedModel,
  onChange,
  disabled,
}: {
  selectedModel: ModelId;
  onChange: (model: ModelId) => void;
  disabled?: boolean;
}) {
  const current = MODEL_MAP[selectedModel];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={disabled}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/50 text-xs font-medium text-foreground/90 transition-all hover:border-muted-foreground/40 min-h-[40px]",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        >
          <img
            src={current.icon}
            alt={current.provider}
            className="w-4 h-4 rounded-sm object-contain"
          />
          <span>{current.label}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-card border-border">
        <DropdownMenuRadioGroup value={selectedModel} onValueChange={(v) => onChange(v as ModelId)}>
          {MODELS.map((m) => (
            <DropdownMenuRadioItem
              key={m.id}
              value={m.id}
              className="text-foreground focus:bg-muted focus:text-foreground"
            >
              <div className="flex items-center gap-2">
                <img src={m.icon} alt={m.provider} className="w-4 h-4 rounded-sm object-contain" />
                <span>{m.label}</span>
                <span className="text-[10px] text-muted-foreground">{m.provider}</span>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Multi model dropdown for Compare mode
function MultiModelDropdown({
  selectedModels,
  onToggle,
  disabled,
}: {
  selectedModels: Set<ModelId>;
  onToggle: (model: ModelId) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            disabled={disabled}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/50 text-xs font-medium text-foreground/90 transition-all hover:border-muted-foreground/40 min-h-[40px]",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            <div className="flex items-center -space-x-1">
              {MODELS.filter((m) => selectedModels.has(m.id)).map((m) => (
                <img
                  key={m.id}
                  src={m.icon}
                  alt={m.provider}
                  className="w-4 h-4 rounded-sm object-contain ring-1 ring-background"
                />
              ))}
            </div>
            <span>{selectedModels.size} Models</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-card border-border">
          <DropdownMenuLabel className="text-muted-foreground text-xs">Select models (2+)</DropdownMenuLabel>
          {MODELS.map((m) => (
            <DropdownMenuCheckboxItem
              key={m.id}
              checked={selectedModels.has(m.id)}
              onCheckedChange={() => onToggle(m.id)}
              onSelect={(e) => e.preventDefault()}
              className="text-foreground focus:bg-muted focus:text-foreground"
            >
              <div className="flex items-center gap-2">
                <img src={m.icon} alt={m.provider} className="w-4 h-4 rounded-sm object-contain" />
                <span>{m.label}</span>
                <span className="text-[10px] text-muted-foreground">{m.provider}</span>
              </div>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {selectedModels.size < 2 && (
        <span className="text-[11px] text-red-400">Select 2+</span>
      )}
    </div>
  );
}

// Text turn component
function TextTurnCard({
  turn,
  isExpanded,
  onToggleExpand,
  isMobile,
}: {
  turn: TextTurn;
  isExpanded: boolean;
  onToggleExpand: () => void;
  isMobile: boolean;
}) {
  const model = MODEL_MAP[turn.modelId];
  if (!model) return null;

  return (
    <div className="bg-muted/50 border border-border rounded-xl overflow-hidden">
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 border-b",
          model.headerClass,
        )}
      >
        <img
          src={model.icon}
          alt={model.provider}
          className="w-5 h-5 rounded object-contain"
        />
        <span className="text-[11px] font-medium text-foreground/90">
          {model.label}
        </span>
        {turn.status === "streaming" && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        )}
      </div>
      <div
        className={cn(
          "relative",
          !isExpanded && turn.modelState.content && "cursor-pointer",
        )}
        onClick={
          !isExpanded && turn.modelState.content ? onToggleExpand : undefined
        }
      >
        <AutoScrollBox
          streaming={turn.status === "streaming"}
          className={cn(
            "p-3 overflow-y-auto",
            isExpanded ? "max-h-[60vh]" : "max-h-[10rem]",
          )}
        >
          {!turn.modelState || turn.modelState.status === "idle" ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
              <span className="w-3 h-3 rounded-full border-2 border-border border-t-primary animate-spin" />
              Waiting…
            </div>
          ) : turn.modelState.status === "error" ? (
            <p className="text-xs text-red-400">
              {turn.modelState.error ?? "Error"}
            </p>
          ) : (
            <div className="text-sm text-foreground">
              <Markdown>{turn.modelState.content}</Markdown>
              {turn.status === "streaming" && (
                <span className="inline-block w-1 h-3.5 bg-primary ml-0.5 animate-pulse align-text-bottom" />
              )}
            </div>
          )}
        </AutoScrollBox>
        {!isExpanded && turn.modelState.content && (
          <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-card to-transparent pointer-events-none" />
        )}
      </div>
    </div>
  );
}

// Compare turn component
function CompareTurnCard({
  turn,
  expandedPanels,
  setExpandedPanels,
  isMobile,
}: {
  turn: CompareTurn;
  expandedPanels: Set<string>;
  setExpandedPanels: React.Dispatch<React.SetStateAction<Set<string>>>;
  isMobile: boolean;
}) {
  const modelList = turn.selectedModels
    .map((id) => MODEL_MAP[id])
    .filter(Boolean);

  const panelKey = `${turn.id}-compare`;

  return (
    <div
      className={cn(
        "grid gap-px bg-border rounded-xl overflow-hidden border border-border",
        modelList.length === 2
          ? "grid-cols-1 sm:grid-cols-2"
          : "grid-cols-1 sm:grid-cols-3",
      )}
    >
      {modelList.map((m) => {
        const ms = turn.models[m.id];
        const modelPanelKey = `${turn.id}-${m.id}`;
        const isExpanded = expandedPanels.has(modelPanelKey);
        const canExpand = ms?.status === "done" || ms?.status === "error";
        const toggleExpand = () => {
          if (!canExpand) return;
          setExpandedPanels((prev) => {
            const next = new Set(prev);
            if (isMobile && !next.has(modelPanelKey)) {
              next.clear();
            }
            if (next.has(modelPanelKey)) {
              next.delete(modelPanelKey);
            } else {
              next.add(modelPanelKey);
            }
            return next;
          });
        };

        return (
          <div key={m.id} className="flex flex-col bg-background min-h-[10rem]">
            <div
              className={cn(
                "flex items-center gap-2 px-3 py-2 border-b flex-shrink-0",
                m.headerClass,
              )}
            >
              <img
                src={m.icon}
                alt={m.provider}
                className="w-5 h-5 rounded object-contain"
              />
              <span className="text-[11px] font-medium text-foreground/90">
                {m.label}
              </span>
              {ms?.status === "streaming" ? (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              ) : canExpand && ms?.content ? (
                <button
                  type="button"
                  onClick={toggleExpand}
                  className="ml-auto text-muted-foreground hover:text-foreground/90 transition-colors p-0.5 rounded"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={cn(
                      "transition-transform",
                      isExpanded && "rotate-180",
                    )}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              ) : null}
            </div>
            <div
              className={cn(
                "relative",
                canExpand && !isExpanded && "cursor-pointer",
              )}
              onClick={canExpand && !isExpanded ? toggleExpand : undefined}
            >
              <AutoScrollBox
                streaming={ms?.status === "streaming"}
                className={cn(
                  "p-3 overflow-y-auto",
                  isExpanded ? "max-h-[60vh]" : "max-h-[10rem]",
                )}
              >
                {!ms || ms.status === "idle" ? (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
                    <span className="w-3 h-3 rounded-full border-2 border-border border-t-primary animate-spin" />
                    Waiting…
                  </div>
                ) : ms.status === "error" ? (
                  <p className="text-xs text-red-400">{ms.error ?? "Error"}</p>
                ) : (
                  <div className="text-xs">
                    <Markdown>{ms.content}</Markdown>
                    {ms.status === "streaming" && (
                      <span className="inline-block w-1 h-3.5 bg-primary ml-0.5 animate-pulse align-text-bottom" />
                    )}
                  </div>
                )}
              </AutoScrollBox>
              {!isExpanded && canExpand && ms?.content && (
                <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background to-transparent pointer-events-none" />
              )}
            </div>
          </div>
        );
      })}

      {/* Moderator section */}
      {turn.selectedModels.length >= 2 && (
        <div className="col-span-full bg-amber-950/20 border-t border-amber-900/50">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-900/50">
            <div className="w-5 h-5 rounded bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-[10px] font-bold">
              M
            </div>
            <span className="text-[11px] font-medium text-amber-300">
              Moderator
            </span>
            {turn.moderatorChoice && (
              <Badge
                variant="outline"
                className="text-[10px] border-amber-700 text-amber-200"
              >
                {MODEL_MAP[turn.moderatorChoice]?.label}
              </Badge>
            )}
            {turn.moderatorStatus === "streaming" && (
              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            )}
          </div>
          <div className="p-3">
            {turn.moderatorStatus === "idle" ? (
              <span className="text-xs text-amber-200/60 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full border border-amber-900 border-t-amber-400 animate-spin" />
                Waiting to compare…
              </span>
            ) : turn.moderatorStatus === "error" ? (
              <span className="text-xs text-red-300">
                {turn.moderatorError ?? "Moderator failed."}
              </span>
            ) : (
              <div className="text-xs text-amber-100/90">
                {turn.moderatorNote ? (
                  <p>{turn.moderatorNote}</p>
                ) : turn.moderatorOutput ? (
                  <p className="whitespace-pre-wrap">{turn.moderatorOutput}</p>
                ) : (
                  <span className="text-amber-200/60">
                    {turn.moderatorStatus === "streaming"
                      ? "Thinking…"
                      : "Analysis complete."}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Compare summary section
function CompareSummarySection({ turn }: { turn: CompareTurn }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] flex gap-3">
        <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-primary to-sky-600 flex items-center justify-center text-primary-foreground text-xs font-bold flex-shrink-0 mt-0.5">
          ∑
        </div>
        <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed text-foreground min-w-[120px]">
          {turn.summaryStatus === "idle" ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
              <span className="w-3 h-3 rounded-full border-2 border-border border-t-primary animate-spin" />
              Waiting for models…
            </span>
          ) : turn.summaryStatus === "error" ? (
            <span className="text-xs text-red-400">
              {turn.summaryError ?? "Summary failed."}
            </span>
          ) : (
            <>
              {turn.summaryThinking && (
                <details open className="mb-3 group">
                  <summary className="text-[11px] text-primary cursor-pointer hover:text-primary/85 select-none flex items-center gap-1.5 transition-colors font-medium">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="transition-transform group-open:rotate-90"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                    Reasoning
                    {turn.summaryStatus === "streaming" && !turn.summary && (
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    )}
                  </summary>
                  <AutoScrollBox
                    streaming={turn.summaryStatus === "streaming" && !turn.summary}
                    className="mt-2 p-3 bg-primary/15 border border-primary/35 rounded-lg text-xs text-muted-foreground leading-relaxed max-h-[10rem] overflow-y-auto"
                  >
                    <Markdown>{turn.summaryThinking}</Markdown>
                    {turn.summaryStatus === "streaming" && !turn.summary && (
                      <span className="inline-block w-1 h-3.5 bg-primary ml-0.5 animate-pulse align-text-bottom" />
                    )}
                  </AutoScrollBox>
                </details>
              )}
              {!turn.summary && turn.summaryStatus === "streaming" && !turn.summaryThinking ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
                  <span className="w-3 h-3 rounded-full border-2 border-border border-t-primary animate-spin" />
                  Thinking…
                </span>
              ) : !turn.summary && turn.summaryStatus === "streaming" && turn.summaryThinking ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  Writing response…
                </span>
              ) : (
                <Markdown>{turn.summary}</Markdown>
              )}
              {turn.summaryStatus === "streaming" && turn.summary && (
                <span className="inline-block w-1 h-4 bg-muted-foreground ml-0.5 animate-pulse align-text-bottom" />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Image turn component
function ImageTurnCard({
  turn,
  onRegenerate,
}: {
  turn: ImageTurn;
  onRegenerate?: () => void;
}) {
  const resolvedUrl = turn.imageId
    ? resolveApiUrl(`/api/images/${turn.imageId}/content`)
    : null;
  const [loading, setLoading] = useState(turn.status === "generating" || turn.status === "streaming");

  useEffect(() => {
    setLoading(turn.status === "generating");
  }, [turn.status]);

  return (
    <div className="bg-muted/50 border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-primary/15">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-primary"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15-5-5-4.5 4.5" />
        </svg>
        <span className="text-[11px] font-medium text-primary">
          AI Generated Image
        </span>
        {turn.provider && (
          <Badge
            variant="outline"
            className="text-[10px] border-primary/50 text-primary"
          >
            {turn.provider}
          </Badge>
        )}
        {turn.status === "generating" && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        )}
      </div>
      <div className="p-4">
        {turn.status === "error" ? (
          <div className="text-center py-8">
            <p className="text-red-400 text-sm">{turn.error ?? "Generation failed"}</p>
            {onRegenerate && (
              <Button
                onClick={onRegenerate}
                variant="outline"
                size="sm"
                className="mt-3"
              >
                Try Again
              </Button>
            )}
          </div>
        ) : turn.status === "generating" || loading ? (
          <div className="flex items-center justify-center min-h-[256px] bg-background/50 rounded-xl">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">Generating image…</p>
              <p className="text-muted-foreground/80 text-xs mt-1">
                {turn.enhancedPrompt ?? turn.originalPrompt}
              </p>
            </div>
          </div>
        ) : resolvedUrl ? (
          <div className="space-y-3">
            <div className="relative rounded-xl overflow-hidden bg-background">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolvedUrl}
                alt={turn.originalPrompt}
                className="w-full h-auto max-h-[512px] object-contain"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" className="text-xs h-8">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M9 9h6M9 12h6M9 15h4" />
                </svg>
                Variations
              </Button>
              <Button variant="outline" size="sm" className="text-xs h-8">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                Download
              </Button>
              <Button variant="outline" size="sm" className="text-xs h-8">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Edit Prompt
              </Button>
            </div>
            {turn.enhancedPrompt && (
              <details className="mt-2">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-muted-foreground">
                  View enhanced prompt
                </summary>
                <p className="text-xs text-muted-foreground mt-2 p-2 bg-muted/50 rounded">
                  {turn.enhancedPrompt}
                </p>
              </details>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No image to display
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  sessionId: string;
}

export default function UnifiedWorkspace({ sessionId }: Props) {
  const [, navigate] = useLocation();
  const [turns, setTurns] = useState<UnifiedTurn[]>([]);
  const [composerMode, setComposerMode] = useState<ComposerMode>("ask");
  const [selectedModel, setSelectedModel] = useState<ModelId>("gpt-5.2");
  const [selectedModels, setSelectedModels] = useState<Set<ModelId>>(
    new Set(["gpt-5.2", "claude-opus-4-6", "gemini-3.1-pro-preview"] as ModelId[]),
  );
  const [prompt, setPrompt] = useState("");
  const [appStatus, setAppStatus] = useState<"idle" | "streaming">("idle");
  const [fp, setFp] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedPanels, setExpandedPanels] = useState<Set<string>>(new Set());
  const [webSearch, setWebSearch] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const turnsRef = useRef(turns);
  const promptRef = useRef(prompt);
  turnsRef.current = turns;
  promptRef.current = prompt;

  // Check for mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Initialize fingerprint and load session
  useEffect(() => {
    getFingerprint().then((fingerprint) => {
      setFp(fingerprint);
      const stored = getSession(sessionId);
      if (stored && stored.fingerprint === fingerprint) {
        setTurns(stored.turns);
        setComposerMode(stored.composerMode);
        setSelectedModel(stored.selectedModel);
        setSelectedModels(new Set(stored.selectedModels));
        return;
      }
      if (stored && stored.fingerprint !== fingerprint) {
        setTurns([]);
        setComposerMode("ask");
        setSelectedModel("gpt-5.2");
        setSelectedModels(
          new Set(["gpt-5.2", "claude-opus-4-6", "gemini-3.1-pro-preview"] as ModelId[]),
        );
        setPrompt("");
        return;
      }
      // New session: fingerprint can resolve after the user already typed or sent — do not reset.
      if (
        !shouldApplyBlankDefaultsForNewSession({
          turnCount: turnsRef.current.length,
          promptTrimmedLength: promptRef.current.trim().length,
        })
      ) {
        return;
      }
      setTurns([]);
      setComposerMode("ask");
      setSelectedModel("gpt-5.2");
      setSelectedModels(
        new Set(["gpt-5.2", "claude-opus-4-6", "gemini-3.1-pro-preview"] as ModelId[]),
      );
      setPrompt("");
    });
  }, [sessionId]);

  // Persist session changes
  useEffect(() => {
    if (!fp || appStatus === "streaming") return;
    
    const stored = getSession(sessionId);
    if (stored && stored.fingerprint === fp) {
      const updated = updateStoredSession(stored, {
        turns,
        composerMode,
        selectedModel,
        selectedModels: Array.from(selectedModels) as ModelId[],
      });
      saveSession(updated);
    } else if (turns.length > 0) {
      // Create new session
      const newSession = createStoredSession(
        sessionId,
        fp,
        turns,
        composerMode,
        selectedModel,
        Array.from(selectedModels) as ModelId[],
      );
      saveSession(newSession);
    }
  }, [turns, composerMode, selectedModel, selectedModels, fp, sessionId, appStatus]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  // Toggle model for compare mode
  const toggleModel = useCallback(
    (id: ModelId) => {
      if (appStatus === "streaming") return;
      setSelectedModels((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          if (next.size <= 2) return prev;
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [appStatus],
  );

  // Handle text/compare API submission
  const handleTextSubmit = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || appStatus === "streaming") return;

    abortRef.current = new AbortController();
    setAppStatus("streaming");
    setPrompt("");

    const turnId = crypto.randomUUID();
    const isCompare = composerMode === "compare";

    let newTurn: UnifiedTurn;

    if (isCompare) {
      const modelIds = Array.from(selectedModels) as ModelId[];
      const initialModels: Partial<Record<ModelId, ModelState>> = {};
      for (const id of modelIds) {
        initialModels[id] = { content: "", status: "idle" };
      }

      newTurn = {
        id: turnId,
        type: "compare",
        prompt: trimmed,
        status: "streaming",
        selectedModels: modelIds,
        models: initialModels,
        moderatorStatus: "idle",
        summary: "",
        summaryThinking: "",
        summaryStatus: "idle",
        webSearch,
        searchStatus: webSearch ? "searching" : "idle",
        searchResults: [],
      };
    } else {
      newTurn = {
        id: turnId,
        type: "text",
        prompt: trimmed,
        status: "streaming",
        modelId: selectedModel,
        modelState: { content: "", status: "idle" },
        webSearch,
        searchStatus: webSearch ? "searching" : "idle",
        searchResults: [],
      };
    }

    const nextTurns = [...turns, newTurn];
    setTurns(nextTurns);

    const updateTurn = (updater: (t: UnifiedTurn) => UnifiedTurn) => {
      setTurns((prev) => prev.map((t) => (t.id === turnId ? updater(t) : t)));
    };

    let sawDoneEvent = false;

    // SSE event handler
    const handleEvent = (event: Record<string, unknown>) => {
      const modelId = event.model as ModelId | undefined;

      if (isCompare) {
        switch (event.type) {
          case "search_start":
            updateTurn((t) =>
              t.type === "compare"
                ? {
                    ...t,
                    searchStatus: "searching",
                    searchError: undefined,
                    searchResults: [],
                  }
                : t,
            );
            break;
          case "search_done":
            updateTurn((t) =>
              t.type === "compare"
                ? {
                    ...t,
                    searchStatus: "done",
                    searchError: undefined,
                    searchResults: Array.isArray(event.results)
                      ? (event.results as SearchResult[])
                      : [],
                  }
                : t,
            );
            break;
          case "search_error":
            updateTurn((t) =>
              t.type === "compare"
                ? {
                    ...t,
                    searchStatus: "error",
                    searchError: typeof event.error === "string" ? event.error : "Web search failed.",
                  }
                : t,
            );
            break;
          case "model_start":
            if (!modelId) break;
            updateTurn((t) =>
              t.type === "compare" && t.id === turnId
                ? {
                    ...t,
                    models: {
                      ...t.models,
                      [modelId]: { content: "", status: "streaming" },
                    },
                  }
                : t,
            );
            break;
          case "model_chunk":
            if (!modelId || typeof event.content !== "string") break;
            updateTurn((t) =>
              t.type === "compare" && t.id === turnId && t.models[modelId]
                ? {
                    ...t,
                    models: {
                      ...t.models,
                      [modelId]: {
                        ...t.models[modelId]!,
                        content: t.models[modelId]!.content + event.content,
                      },
                    },
                  }
                : t,
            );
            break;
          case "model_done":
            if (!modelId) break;
            updateTurn((t) =>
              t.type === "compare" && t.id === turnId && t.models[modelId]
                ? {
                    ...t,
                    models: {
                      ...t.models,
                      [modelId]: { ...t.models[modelId]!, status: "done" },
                    },
                  }
                : t,
            );
            break;
          case "model_error":
            if (!modelId) break;
            updateTurn((t) =>
              t.type === "compare" && t.id === turnId && t.models[modelId]
                ? {
                    ...t,
                    models: {
                      ...t.models,
                      [modelId]: {
                        ...t.models[modelId]!,
                        status: "error",
                        error: typeof event.error === "string" ? event.error : "Model failed.",
                      },
                    },
                  }
                : t,
            );
            break;
          case "moderator_start":
            updateTurn((t) =>
              t.type === "compare" && t.id === turnId
                ? { ...t, moderatorStatus: "streaming", moderatorError: undefined }
                : t,
            );
            break;
          case "moderator_chunk":
            if (typeof event.content !== "string") break;
            updateTurn((t) =>
              t.type === "compare" && t.id === turnId
                ? {
                    ...t,
                    moderatorOutput: ((t as CompareTurn).moderatorOutput ?? "") + event.content,
                  }
                : t,
            );
            break;
          case "moderator_done":
            updateTurn((t) =>
              t.type === "compare" && t.id === turnId
                ? {
                    ...t,
                    moderatorStatus: "done",
                    moderatorChoice: isModelId(event.choice)
                      ? event.choice
                      : (t as CompareTurn).moderatorChoice,
                    moderatorNote:
                      typeof event.note === "string" ? event.note : (t as CompareTurn).moderatorNote,
                  }
                : t,
            );
            break;
          case "moderator_error":
            updateTurn((t) =>
              t.type === "compare" && t.id === turnId
                ? {
                    ...t,
                    moderatorStatus: "error",
                    moderatorError: typeof event.error === "string" ? event.error : "Moderator failed.",
                  }
                : t,
            );
            break;
          case "summary_start":
            updateTurn((t) =>
              t.type === "compare" && t.id === turnId
                ? { ...t, summaryStatus: "streaming", summaryError: undefined }
                : t,
            );
            break;
          case "summary_thinking_chunk":
            if (typeof event.content !== "string") break;
            updateTurn((t) =>
              t.type === "compare" && t.id === turnId
                ? {
                    ...t,
                    summaryThinking: ((t as CompareTurn).summaryThinking ?? "") + event.content,
                  }
                : t,
            );
            break;
          case "summary_chunk":
            if (typeof event.content !== "string") break;
            updateTurn((t) =>
              t.type === "compare" && t.id === turnId
                ? { ...t, summary: (t as CompareTurn).summary + event.content }
                : t,
            );
            break;
          case "summary_done":
            updateTurn((t) =>
              t.type === "compare" && t.id === turnId
                ? { ...t, summaryStatus: "done" }
                : t,
            );
            break;
          case "summary_error":
            updateTurn((t) =>
              t.type === "compare" && t.id === turnId
                ? {
                    ...t,
                    summaryStatus: "error",
                    summaryError: typeof event.error === "string" ? event.error : "Summary failed.",
                  }
                : t,
            );
            break;
          case "done":
            sawDoneEvent = true;
            break;
        }
      } else {
        // Single model (text) mode
        switch (event.type) {
          case "search_start":
            updateTurn((t) =>
              t.type === "text" && t.id === turnId
                ? { ...t, searchStatus: "searching", searchError: undefined }
                : t,
            );
            break;
          case "search_done":
            updateTurn((t) =>
              t.type === "text" && t.id === turnId
                ? {
                    ...t,
                    searchStatus: "done",
                    searchResults: Array.isArray(event.results)
                      ? (event.results as SearchResult[])
                      : [],
                  }
                : t,
            );
            break;
          case "search_error":
            updateTurn((t) =>
              t.type === "text" && t.id === turnId
                ? {
                    ...t,
                    searchStatus: "error",
                    searchError: typeof event.error === "string" ? event.error : "Search failed.",
                  }
                : t,
            );
            break;
          case "start":
            updateTurn((t) =>
              t.type === "text" && t.id === turnId
                ? { ...t, modelState: { ...t.modelState, status: "streaming" } }
                : t,
            );
            break;
          case "chunk":
            if (typeof event.content !== "string") break;
            updateTurn((t) =>
              t.type === "text" && t.id === turnId
                ? {
                    ...t,
                    modelState: {
                      ...t.modelState,
                      content: t.modelState.content + event.content,
                    },
                  }
                : t,
            );
            break;
          case "done":
            updateTurn((t) =>
              t.type === "text" && t.id === turnId
                ? { ...t, status: "done", modelState: { ...t.modelState, status: "done" } }
                : t,
            );
            sawDoneEvent = true;
            break;
          case "error":
            updateTurn((t) =>
              t.type === "text" && t.id === turnId
                ? {
                    ...t,
                    status: "error",
                    modelState: {
                      ...t.modelState,
                      status: "error",
                      error: typeof event.error === "string" ? event.error : "Error",
                    },
                  }
                : t,
            );
            break;
        }
      }
    };

    const processSseChunk = (chunk: string) => {
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          handleEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
        } catch (e) {
          console.error("Failed to parse SSE:", e);
        }
      }
    };

    try {
      // Build history from previous turns
      const history = turns
        .filter((t) => t.status === "done")
        .flatMap((t) => {
          if (t.type === "text") {
            return [
              { role: "user" as const, content: t.prompt },
              { role: "assistant" as const, content: t.modelState.content },
            ];
          } else if (t.type === "compare" && (t as CompareTurn).summary) {
            return [
              { role: "user" as const, content: t.prompt },
              { role: "assistant" as const, content: (t as CompareTurn).summary },
            ];
          }
          return [];
        });

      // Determine which endpoint to call
      const endpoint = isCompare ? "/api/multi-chat" : "/api/chat";
      const body = isCompare
        ? {
            prompt: trimmed,
            models: Array.from(selectedModels),
            webSearch,
            history,
          }
        : {
            model: selectedModel,
            messages: [...history, { role: "user", content: trimmed }],
            webSearch,
          };

      const response = await fetch(resolveApiUrl(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        let detail = `Server error: ${response.status}`;
        try {
          const ct = response.headers.get("content-type") ?? "";
          if (ct.includes("application/json")) {
            const bodyJson = (await response.json()) as {
              error?: string;
              message?: string;
            };
            detail = bodyJson.message ?? bodyJson.error ?? detail;
          } else {
            const text = await response.text();
            if (text.trim()) detail = text.trim().slice(0, 400);
          }
        } catch {
          /* ignore body parse errors */
        }
        throw new Error(detail);
      }

      if (!response.body) {
        throw new Error("No response body from server");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          if (buffer) processSseChunk(buffer);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        processSseChunk(lines.join("\n"));
      }

      setTurns((prev) =>
        prev.map((t) => {
          if (t.id !== turnId) return t;
          if (t.type === "text") {
            if (t.modelState.status === "idle") {
              return {
                ...t,
                status: "error",
                modelState: {
                  content: "",
                  status: "error",
                  error:
                    "No assistant response was received. For local dev, run the API server and check the Vite proxy (API_SERVER_URL).",
                },
              };
            }
            if (t.status === "error") return t;
            return {
              ...t,
              status: "done",
              modelState: { ...t.modelState, status: "done" },
            };
          }
          if (t.type === "compare") {
            const models = { ...t.models };
            for (const id of t.selectedModels) {
              const ms = models[id];
              if (ms?.status === "idle") {
                models[id] = {
                  content: "",
                  status: "error",
                  error: MISSING_MODEL_TERMINAL_ERROR,
                };
              }
            }
            return { ...t, status: "done", models };
          }
          return t;
        }),
      );
      setAppStatus("idle");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setTurns((prev) =>
          prev.map((t) => {
            if (t.id !== turnId) return t;
            if (t.type === "text") {
              return {
                ...t,
                status: "error",
                modelState: {
                  ...t.modelState,
                  status: "error",
                  error: "Generation stopped.",
                },
              };
            }
            if (t.type === "compare") {
              const models = { ...t.models };
              for (const id of t.selectedModels) {
                const ms = models[id];
                if (ms?.status === "idle" || ms?.status === "streaming") {
                  models[id] = {
                    content: ms?.content ?? "",
                    status: "error",
                    error: "Stopped.",
                  };
                }
              }
              return {
                ...t,
                models,
                moderatorStatus:
                  t.moderatorStatus === "streaming" ? "error" : t.moderatorStatus,
                moderatorError:
                  t.moderatorStatus === "streaming"
                    ? "Stopped."
                    : t.moderatorError,
                summaryStatus:
                  t.summaryStatus === "streaming" ? "error" : t.summaryStatus,
                summaryError:
                  t.summaryStatus === "streaming" ? "Stopped." : t.summaryError,
              };
            }
            return t;
          }),
        );
        setAppStatus("idle");
        return;
      }
      const message = err instanceof Error ? err.message : "Request failed";
      setTurns((prev) =>
        prev.map((t) => {
          if (t.id !== turnId) return t;
          if (t.type === "text") {
            return {
              ...t,
              status: "error",
              modelState: {
                ...t.modelState,
                status: "error",
                error: message,
              },
            };
          }
          if (t.type === "compare") {
            return {
              ...t,
              summaryStatus: "error",
              summaryError: message,
            };
          }
          return t;
        }),
      );
      setAppStatus("idle");
    }
  }, [prompt, appStatus, composerMode, selectedModel, selectedModels, turns, webSearch]);

  // Handle image generation
  const handleImageSubmit = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || appStatus === "streaming") return;

    abortRef.current = new AbortController();
    setAppStatus("streaming");
    setPrompt("");

    const turnId = crypto.randomUUID();
    const ownerId = getOrCreateAnonymousOwnerId();

    const newTurn: ImageTurn = {
      id: turnId,
      type: "image",
      prompt: trimmed,
      status: "generating",
      originalPrompt: trimmed,
    };

    const nextTurns = [...turns, newTurn];
    setTurns(nextTurns);

    try {
      const response = await fetch(resolveApiUrl("/api/images/generations"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-anonymous-owner-id": ownerId,
        },
        body: JSON.stringify({ prompt: trimmed }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Generation failed" }));
        throw new Error(error.message || `Error: ${response.status}`);
      }

      const result: ImageGenerationResult = await response.json();

      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                status: "done",
                imageId: result.id,
                enhancedPrompt: result.enhancedPrompt,
                provider: result.provider,
                model: result.model,
                imageUrl: resolveApiUrl(`/api/images/${result.id}/content`),
              }
            : t,
        ),
      );
      setAppStatus("idle");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setAppStatus("idle");
        return;
      }

      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                status: "error",
                error: err instanceof Error ? err.message : "Generation failed",
              }
            : t,
        ),
      );
      setAppStatus("idle");
    }
  }, [prompt, appStatus, turns]);

  // Unified submit handler
  const handleSubmit = useCallback(() => {
    if (composerMode === "image") {
      handleImageSubmit();
    } else {
      handleTextSubmit();
    }
  }, [composerMode, handleImageSubmit, handleTextSubmit]);

  // Stop generation
  const handleStop = () => {
    abortRef.current?.abort();
    setAppStatus("idle");
  };

  // New session
  const handleNew = () => {
    const id = crypto.randomUUID();
    navigate(`/session/${id}`);
  };

  // Determine if submit is allowed
  const canSend =
    prompt.trim().length > 0 &&
    appStatus === "idle" &&
    (composerMode === "image" ||
      (composerMode === "ask" && selectedModel) ||
      (composerMode === "compare" && selectedModels.size >= 2));

  return (
    <div className="h-[100dvh] bg-background text-foreground flex flex-row overflow-hidden">
      <ChatSidebar
        collapsed={!sidebarOpen}
        onToggle={() => setSidebarOpen((o) => !o)}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="border-b border-border px-4 sm:px-6 py-3 flex flex-col gap-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="flex items-center gap-2.5 hover:opacity-80"
            >
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-sky-600 flex items-center justify-center text-primary-foreground font-bold text-sm">
                S
              </div>
              <div className="leading-tight text-left">
                <h1 className="text-sm font-semibold">Summachat</h1>
                <p className="text-[11px] text-muted-foreground">AI Workspace</p>
              </div>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            {appStatus === "streaming" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleStop}
                className="border-border bg-transparent text-foreground/90 hover:text-foreground hover:bg-muted h-10"
              >
                <span className="hidden sm:inline">Stop</span>
                <span className="sm:hidden">■</span>
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleNew}
              disabled={appStatus === "streaming"}
              className="text-muted-foreground hover:text-foreground/90 h-10"
            >
              <span className="hidden sm:inline">New Session</span>
              <span className="sm:hidden">+</span>
            </Button>
          </div>
        </div>

        {/* Mode selector - always visible */}
        <div className="flex items-center gap-2 flex-wrap">
          <ModeChip
            mode="ask"
            active={composerMode === "ask"}
            onClick={() => setComposerMode("ask")}
            disabled={appStatus === "streaming"}
          />
          <ModeChip
            mode="compare"
            active={composerMode === "compare"}
            onClick={() => setComposerMode("compare")}
            disabled={appStatus === "streaming"}
          />
          <ModeChip
            mode="image"
            active={composerMode === "image"}
            onClick={() => setComposerMode("image")}
            disabled={appStatus === "streaming"}
          />

          {/* Context-sensitive controls */}
          <div className="flex-1" />

          {composerMode === "ask" && (
            <SingleModelDropdown
              selectedModel={selectedModel}
              onChange={setSelectedModel}
              disabled={appStatus === "streaming"}
            />
          )}

          {composerMode === "compare" && (
            <MultiModelDropdown
              selectedModels={selectedModels}
              onToggle={toggleModel}
              disabled={appStatus === "streaming"}
            />
          )}
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {turns.length === 0 ? (
          <div className="h-full flex items-center justify-center px-4 py-16">
            <div className="text-center space-y-6 max-w-lg">
              {/* Mode cards */}
              <div className="flex items-stretch justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setComposerMode("ask")}
                  disabled={appStatus === "streaming"}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-xl border transition-all min-w-[100px]",
                    composerMode === "ask"
                      ? "bg-primary/20 border-primary text-primary"
                      : "bg-muted/30 border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground/90"
                  )}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <path d="M12 17h.01" />
                  </svg>
                  <span className="text-sm font-medium">Ask</span>
                </button>
                <button
                  type="button"
                  onClick={() => setComposerMode("compare")}
                  disabled={appStatus === "streaming"}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-xl border transition-all min-w-[100px]",
                    composerMode === "compare"
                      ? "bg-primary/20 border-primary text-primary"
                      : "bg-muted/30 border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground/90"
                  )}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                  <span className="text-sm font-medium">Precise</span>
                </button>
                <button
                  type="button"
                  onClick={() => setComposerMode("image")}
                  disabled={appStatus === "streaming"}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-xl border transition-all min-w-[100px]",
                    composerMode === "image"
                      ? "bg-primary/20 border-primary text-primary"
                      : "bg-muted/30 border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground/90"
                  )}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5-5 5" />
                  </svg>
                  <span className="text-sm font-medium">Image</span>
                </button>
              </div>

              {/* Dynamic content based on mode */}
              <div className="space-y-2">
                <p className="text-foreground/90 text-lg font-medium">
                  {composerMode === "ask" && "Ask a question"}
                  {composerMode === "compare" && "Precise Mode"}
                  {composerMode === "image" && "Generate an image"}
                </p>
                <p className="text-muted-foreground text-sm">
                  {composerMode === "ask" && "Get answers from GPT, Claude, or Gemini with optional web search."}
                  {composerMode === "compare" && "Uses multiple models to generate precise, near-perfect answers."}
                  {composerMode === "image" && "Describe what you want to see and let AI create it for you."}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
            {turns.map((turn) => (
              <div key={turn.id} className="space-y-4">
                {/* User prompt */}
                <div className="flex justify-end">
                  <div className="max-w-[75%] bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                    {turn.prompt}
                  </div>
                </div>

                {/* Response based on type */}
                {turn.type === "text" && (
                  <TextTurnCard
                    turn={turn}
                    isExpanded={expandedPanels.has(`${turn.id}-text`)}
                    onToggleExpand={() =>
                      setExpandedPanels((prev) => {
                        const next = new Set(prev);
                        next.add(`${turn.id}-text`);
                        return next;
                      })
                    }
                    isMobile={isMobile}
                  />
                )}

                {turn.type === "compare" && (
                  <>
                    <CompareTurnCard
                      turn={turn}
                      expandedPanels={expandedPanels}
                      setExpandedPanels={setExpandedPanels}
                      isMobile={isMobile}
                    />
                    <CompareSummarySection turn={turn} />
                  </>
                )}

                {turn.type === "image" && (
                  <ImageTurnCard turn={turn} />
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-muted/30 px-3 sm:px-4 py-3 flex-shrink-0">
        <div className="max-w-4xl mx-auto space-y-3">
          {/* Web search toggle for text modes */}
          {(composerMode === "ask" || composerMode === "compare") && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setWebSearch((v) => !v)}
                disabled={appStatus === "streaming"}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-full border text-xs font-medium transition-all",
                  webSearch
                    ? "bg-sky-900/60 border-sky-500 text-sky-300"
                    : "bg-muted/30 border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-muted-foreground",
                  appStatus === "streaming" && "opacity-50 cursor-not-allowed",
                )}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <span className="hidden sm:inline">Web Search</span>
                <span className="sm:hidden">Web</span>
              </button>
            </div>
          )}

          {/* Input row */}
          <div className="flex gap-2 sm:gap-3 items-end">
            <div className="flex-1 relative">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  if (e.shiftKey) return;
                  e.preventDefault();
                  if (canSend) handleSubmit();
                }}
                placeholder={
                  composerMode === "image"
                    ? "Describe the image you want to create..."
                    : composerMode === "compare"
                    ? "Ask all models to answer..."
                    : "Ask a question..."
                }
                className="bg-background/60 border-border text-foreground placeholder:text-muted-foreground/80 resize-none min-h-[48px] max-h-[120px] focus:border-primary focus:ring-primary/20 text-base"
                disabled={appStatus === "streaming"}
                style={{ paddingBottom: "12px", paddingTop: "12px", fieldSizing: "content", minHeight: "48px" }}
              />
            </div>
            <Button
              onClick={handleSubmit}
              disabled={!canSend}
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 sm:px-5 h-12 min-h-[48px] flex-shrink-0"
            >
              {composerMode === "image" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15-5-5-4.5 4.5" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              )}
            </Button>
          </div>

          {/* Hint text */}
          <p className="text-[10px] text-muted-foreground/80 text-center">
            Press Ctrl+Enter to send • {composerMode === "compare" ? "Multi-model synthesis for precise answers" : composerMode === "ask" ? "Sends to single model" : "Generates an image"}
          </p>
        </div>
      </div>
      </div>
    </div>
  );
}

// Helper to validate model ID
function isModelId(value: unknown): value is ModelId {
  return typeof value === "string" && value in MODEL_MAP;
}