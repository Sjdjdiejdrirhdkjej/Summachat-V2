type GuardedStreamStatus =
  | "success"
  | "timed_out"
  | "aborted"
  | "errored"
  | "empty";

type GuardedStreamLogger = {
  info: (bindings: Record<string, unknown>, message?: string) => void;
  warn: (bindings: Record<string, unknown>, message?: string) => void;
  error: (bindings: Record<string, unknown>, message?: string) => void;
};

type GuardedStreamFactoryResult<TChunk> = {
  stream: AsyncIterable<TChunk>;
  abort?: () => void;
};

export type GuardedProviderStreamResult = {
  status: GuardedStreamStatus;
  output: string;
  firstChunkMs: number | null;
  totalMs: number;
  error?: Error;
};

export type GuardedProviderStreamOptions<TChunk> = {
  provider: string;
  requestId?: string;
  logger: GuardedStreamLogger;
  overallTimeoutMs: number;
  firstChunkTimeoutMs: number;
  externalAbortSignal?: AbortSignal;
  startStream: (context: {
    signal: AbortSignal;
  }) => Promise<GuardedStreamFactoryResult<TChunk>>;
  getChunkText: (chunk: TChunk) => string | null | undefined;
  onChunk: (text: string) => void;
};

const OVERALL_TIMEOUT_REASON = "overall_timeout";
const FIRST_CHUNK_TIMEOUT_REASON = "first_chunk_timeout";
const EXTERNAL_ABORT_REASON = "external_abort";

function normalizeError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("Unknown provider stream error");
}

function classifyAborted(
  signal: AbortSignal,
): Exclude<GuardedStreamStatus, "success" | "empty" | "errored"> {
  if (
    signal.reason === OVERALL_TIMEOUT_REASON ||
    signal.reason === FIRST_CHUNK_TIMEOUT_REASON
  ) {
    return "timed_out";
  }
  return "aborted";
}

export function toTerminalError(
  result: GuardedProviderStreamResult,
): string | null {
  if (result.status === "success") return null;
  if (result.status === "timed_out") return "Provider stream timed out";
  if (result.status === "aborted") return "Provider stream aborted";
  if (result.status === "empty") return "Provider returned empty output";
  return result.error?.message ?? "Provider stream failed";
}

export async function runGuardedProviderStream<TChunk>(
  options: GuardedProviderStreamOptions<TChunk>,
): Promise<GuardedProviderStreamResult> {
  const {
    provider,
    requestId,
    logger,
    overallTimeoutMs,
    firstChunkTimeoutMs,
    externalAbortSignal,
    startStream,
    getChunkText,
    onChunk,
  } = options;

  const startAt = Date.now();
  const controller = new AbortController();
  let providerAbort: (() => void) | undefined;
  let firstChunkAt: number | null = null;
  let output = "";

  const abortWithReason = (reason: string) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };

  const onExternalAbort = () => {
    abortWithReason(EXTERNAL_ABORT_REASON);
  };

  if (externalAbortSignal?.aborted) {
    onExternalAbort();
  }

  if (externalAbortSignal) {
    externalAbortSignal.addEventListener("abort", onExternalAbort, {
      once: true,
    });
  }

  const overallTimeoutHandle = setTimeout(() => {
    abortWithReason(OVERALL_TIMEOUT_REASON);
  }, overallTimeoutMs);
  const firstChunkTimeoutHandle = setTimeout(() => {
    abortWithReason(FIRST_CHUNK_TIMEOUT_REASON);
  }, firstChunkTimeoutMs);

  try {
    logger.info(
      {
        requestId,
        provider,
        overallTimeoutMs,
        firstChunkTimeoutMs,
      },
      "provider_stream_started",
    );

    const started = await startStream({ signal: controller.signal });
    providerAbort = started.abort;

    const onGuardAbort = () => {
      providerAbort?.();
    };
    controller.signal.addEventListener("abort", onGuardAbort);

    try {
      for await (const chunk of started.stream) {
        const text = getChunkText(chunk);
        if (!text) {
          continue;
        }

        if (firstChunkAt === null) {
          firstChunkAt = Date.now();
          clearTimeout(firstChunkTimeoutHandle);
          logger.info(
            {
              requestId,
              provider,
              firstChunkMs: firstChunkAt - startAt,
            },
            "provider_stream_first_chunk",
          );
        }

        output += text;
        onChunk(text);
      }
    } finally {
      controller.signal.removeEventListener("abort", onGuardAbort);
    }

    const totalMs = Date.now() - startAt;
    if (controller.signal.aborted) {
      const status = classifyAborted(controller.signal);
      logger.warn(
        {
          requestId,
          provider,
          status,
          reason: controller.signal.reason,
          totalMs,
        },
        status === "timed_out"
          ? "provider_stream_timed_out"
          : "provider_stream_aborted",
      );
      return {
        status,
        output,
        firstChunkMs: firstChunkAt === null ? null : firstChunkAt - startAt,
        totalMs,
      };
    }

    if (output.length === 0) {
      logger.warn(
        { requestId, provider, totalMs },
        "provider_stream_empty_output",
      );
      return {
        status: "empty",
        output,
        firstChunkMs: null,
        totalMs,
      };
    }

    logger.info(
      {
        requestId,
        provider,
        totalMs,
        firstChunkMs: firstChunkAt === null ? null : firstChunkAt - startAt,
        outputLength: output.length,
      },
      "provider_stream_completed",
    );
    return {
      status: "success",
      output,
      firstChunkMs: firstChunkAt === null ? null : firstChunkAt - startAt,
      totalMs,
    };
  } catch (error) {
    const totalMs = Date.now() - startAt;
    const normalizedError = normalizeError(error);

    if (controller.signal.aborted) {
      const status = classifyAborted(controller.signal);
      logger.warn(
        {
          requestId,
          provider,
          status,
          reason: controller.signal.reason,
          totalMs,
          err: normalizedError,
        },
        status === "timed_out"
          ? "provider_stream_timed_out"
          : "provider_stream_aborted",
      );
      return {
        status,
        output,
        firstChunkMs: firstChunkAt === null ? null : firstChunkAt - startAt,
        totalMs,
        error: normalizedError,
      };
    }

    logger.error(
      {
        requestId,
        provider,
        totalMs,
        err: normalizedError,
      },
      "provider_stream_errored",
    );
    return {
      status: "errored",
      output,
      firstChunkMs: firstChunkAt === null ? null : firstChunkAt - startAt,
      totalMs,
      error: normalizedError,
    };
  } finally {
    clearTimeout(overallTimeoutHandle);
    clearTimeout(firstChunkTimeoutHandle);
    if (externalAbortSignal) {
      externalAbortSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}
