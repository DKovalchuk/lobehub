import { countContextTokens, DEFAULT_DRIFT_MULTIPLIER } from '@lobechat/context-engine';
import type { UIChatMessage } from '@lobechat/types';

/**
 * Options for token counting and compression threshold calculation
 */
export interface TokenCountOptions {
  /**
   * Optional drift multiplier override forwarded to {@link countContextTokens}.
   * Default {@link DEFAULT_DRIFT_MULTIPLIER} (1.25).
   */
  driftMultiplier?: number;
  /**
   * Model's max output token count. Used to reserve room for the summary the
   * compression call itself has to produce — see {@link getCompressionThreshold}.
   */
  maxOutputToken?: number;
  /** Model's max context window token count */
  maxWindowToken?: number;
  /**
   * Explicit ratio override. When set, the threshold is exactly
   * `maxWindowToken × thresholdRatio` and the headroom formula is bypassed.
   * Leave unset unless a caller genuinely wants to compress earlier than the
   * window requires.
   */
  thresholdRatio?: number;
  /**
   * Optional top-level tool definitions for the upcoming LLM call. When
   * provided, tool definition tokens are counted toward the budget — matches
   * what the provider actually charges. Pass the same `tools` array that will
   * be sent in the request payload.
   */
  tools?: unknown[];
}

/** Default max context window (128k tokens) */
export const DEFAULT_MAX_CONTEXT = 128_000;

/**
 * Upper bound on the room reserved for the compression summary's own output.
 * A model that can emit 128k tokens will never spend anywhere near that on a
 * summary, so reserving its full `maxOutput` would waste most of the window.
 */
export const MAX_OUTPUT_RESERVE_TOKENS = 20_000;

/**
 * Safety buffer on top of the reserved output room, covering the drift between
 * our estimate and the provider's tokenizer plus the system prompt / tool
 * definitions that get appended after the check runs.
 */
export const COMPRESSION_BUFFER_TOKENS = 13_000;

/**
 * Floor for the headroom formula, as a fraction of the window. Small-window
 * models (≤ 32k) would otherwise produce a zero or negative threshold, which
 * reads as "always compress" and loops forever.
 */
export const MIN_THRESHOLD_RATIO = 0.5;

/**
 * Calculate the compression threshold for a model's context window.
 *
 * The budget is headroom-based, not a flat fraction: compression only needs to
 * fire late enough that the *next* request still fits, so we reserve room for
 * the summary output plus a safety buffer and let the conversation use
 * everything below that.
 *
 * ```text
 * threshold = maxWindowToken − min(maxOutputToken, 20k) − 13k
 * ```
 *
 * A flat ratio wastes most of a large window — at the previous 0.5 default a
 * 256k model compressed its whole history at ~102k raw tokens (40% of the
 * window, once the 1.25 drift multiplier is applied), then had to re-read
 * everything it had just summarized away.
 *
 * `thresholdRatio` remains available as an explicit override for callers that
 * deliberately want to compress earlier.
 */
export function getCompressionThreshold(options: TokenCountOptions = {}): number {
  const maxContext = options.maxWindowToken ?? DEFAULT_MAX_CONTEXT;

  // Explicit ratio wins outright — it's an opt-in override, not a cap.
  if (options.thresholdRatio !== undefined) {
    return Math.floor(maxContext * options.thresholdRatio);
  }

  // Unknown maxOutput reserves the full cap: over-reserving costs a little
  // window, under-reserving costs a failed request.
  const reservedForSummary = Math.min(
    options.maxOutputToken ?? MAX_OUTPUT_RESERVE_TOKENS,
    MAX_OUTPUT_RESERVE_TOKENS,
  );
  const headroom = maxContext - reservedForSummary - COMPRESSION_BUFFER_TOKENS;

  return Math.max(headroom, Math.floor(maxContext * MIN_THRESHOLD_RATIO));
}

/**
 * Result of compression check
 */
export interface CompressionCheckResult {
  /**
   * Best raw estimate of current input tokens (sum of message content +
   * tool calls + reasoning + tool_call_id + tool definitions).
   */
  currentTokenCount: number;
  /**
   * `true` when `adjustedTokenCount > threshold`. The adjusted count includes
   * a drift multiplier (default 1.25×) to compensate for the gap between
   * `tokenx`'s heuristic and provider tokenizers, so compression fires before
   * upstream tokenizers actually overflow the model's context window.
   */
  needsCompression: boolean;
  /** Compression threshold — see {@link getCompressionThreshold} */
  threshold: number;
}

/**
 * Check if messages need compression based on token count.
 *
 * Uses {@link countContextTokens} under the hood, so the input estimate
 * accounts for tool calls, reasoning, and tool definitions in addition to
 * `content` (see for the calibration data).
 */
export function shouldCompress(
  messages: UIChatMessage[],
  options: TokenCountOptions = {},
): CompressionCheckResult {
  const accounting = countContextTokens({
    messages,
    options: { driftMultiplier: options.driftMultiplier ?? DEFAULT_DRIFT_MULTIPLIER },
    tools: options.tools,
  });
  const threshold = getCompressionThreshold(options);

  return {
    currentTokenCount: accounting.rawTotal,
    needsCompression: accounting.adjustedTotal > threshold,
    threshold,
  };
}
