import { countContextTokens } from '@lobechat/context-engine';
import type { UIChatMessage } from '@lobechat/types';

/**
 * Fraction of the compression threshold the preserved tail may occupy.
 *
 * Small enough that compression still frees the bulk of the window, large
 * enough that the model keeps the step it was in the middle of — the tool
 * results and edits it just produced, which a prose summary reliably loses.
 */
export const DEFAULT_TAIL_PRESERVE_RATIO = 0.2;

/**
 * Absolute cap on the preserved tail. Without it a 1M-token window would carry
 * ~180k of raw history past every compaction, which defeats the point.
 */
export const MAX_TAIL_PRESERVE_TOKENS = 32_000;

/**
 * Token budget for the preserved tail, derived from the compression threshold.
 */
export const getTailPreserveBudget = (
  threshold: number,
  ratio: number = DEFAULT_TAIL_PRESERVE_RATIO,
): number => Math.min(Math.floor(threshold * ratio), MAX_TAIL_PRESERVE_TOKENS);

/**
 * The message that triggered this turn must never be summarized away, even
 * when it alone blows the budget.
 */
const lastUserMessageOnly = (messages: UIChatMessage[]): UIChatMessage[] => {
  const last = messages.at(-1);
  return last?.role === 'user' ? [last] : [];
};

/**
 * Pick the longest suffix of `messages` that fits in `maxTokens`.
 *
 * Compression replaces history with a summary; whatever this returns is kept
 * verbatim alongside it. Preserving the tail is what lets the model continue
 * the step it was in rather than restarting from a paraphrase — without it,
 * an agent that compresses mid-loop loses every tool result it just gathered
 * and goes back to re-reading the same files.
 *
 * Two invariants:
 * - at least one message is always left to compress, so the pass is never a
 *   no-op that re-triggers on the next step;
 * - the segment never *starts* on a `tool` message, whose originating
 *   assistant `tool_calls` would have been summarized away — most providers
 *   reject that orphaned pairing.
 */
export function selectPreservedTail(messages: UIChatMessage[], maxTokens: number): UIChatMessage[] {
  if (messages.length <= 1) return [];
  if (maxTokens <= 0) return lastUserMessageOnly(messages);

  const { messages: breakdown } = countContextTokens({ messages });

  // Walk backwards while the suffix still fits. `i >= 1` keeps index 0 out of
  // the tail so there is always something left to summarize.
  let start = messages.length;
  let used = 0;
  for (let i = messages.length - 1; i >= 1; i--) {
    const cost = breakdown[i]?.total ?? 0;
    if (used + cost > maxTokens) break;
    used += cost;
    start = i;
  }

  // Drop orphaned tool results at the head of the segment.
  while (start < messages.length && messages[start]?.role === 'tool') start++;

  const tail = messages.slice(start);

  return tail.length > 0 ? tail : lastUserMessageOnly(messages);
}
