/**
 * Token-efficient output formatting for tool results.
 *
 * MCP tool results land in the LLM's context as text. For list-shaped
 * responses (arrays of objects with consistent keys — flow lists, run
 * lists, connection lists, connector operation tables), Token-Oriented
 * Object Notation (TOON) is 30–50% cheaper than indented JSON. The
 * library writes one header row plus one row per record instead of
 * repeating the same keys on every object.
 *
 * For deeply nested heterogeneous data (Logic Apps definitions,
 * single flow rows expanded with inputs/outputs trees), TOON's wins
 * shrink and JSON readability is more useful — so we keep JSON there.
 *
 * Three modes:
 *   - 'auto' (default for opt-in tools) → TOON when the payload's
 *     largest tabular sub-shape exceeds a threshold; JSON otherwise.
 *   - 'toon'  → always TOON, even for small payloads. Useful for
 *               benchmarking or when the caller knows the cost shape.
 *   - 'json'  → always indented JSON. Use when a non-LLM consumer
 *               (e.g. a script piping tool output to `jq`) calls the
 *               MCP and expects JSON.
 */

import { encode as encodeToon } from '@toon-format/toon';
import { z } from 'zod';

export type ResponseFormat = 'auto' | 'toon' | 'json';

export const responseFormatSchema = z
  .enum(['auto', 'toon', 'json'])
  .default('auto')
  .describe(
    "Output format for the response text. 'auto' (default) uses TOON for tabular payloads (lists of records) and JSON otherwise — TOON is 30-50% fewer tokens than indented JSON for tables. 'toon' forces TOON. 'json' forces indented JSON; pass this when a non-LLM caller pipes the result to a tool that expects JSON.",
  );

interface FormatResult {
  text: string;
  format: 'toon' | 'json';
}

const TOON_AUTO_MIN_ROWS = 3;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Walk the payload looking for an array of plain objects whose first
 * row's keys match across all rows (TOON's tabular sweet spot).
 * Returns true if we find a row count ≥ TOON_AUTO_MIN_ROWS.
 */
const hasTabularSubshape = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    if (value.length < TOON_AUTO_MIN_ROWS) return false;
    if (!value.every(isPlainObject)) return false;
    const firstKeys = Object.keys(value[0] as Record<string, unknown>).sort().join(',');
    return value.every(
      (row) => Object.keys(row as Record<string, unknown>).sort().join(',') === firstKeys,
    );
  }
  if (isPlainObject(value)) {
    return Object.values(value).some((child) => hasTabularSubshape(child));
  }
  return false;
};

export const selectFormat = (payload: unknown, requested: ResponseFormat): 'toon' | 'json' => {
  if (requested === 'toon') return 'toon';
  if (requested === 'json') return 'json';
  return hasTabularSubshape(payload) ? 'toon' : 'json';
};

export const formatPayload = (
  payload: unknown,
  requested: ResponseFormat = 'auto',
): FormatResult => {
  const format = selectFormat(payload, requested);
  if (format === 'toon') {
    return { text: encodeToon(payload as never), format };
  }
  return { text: JSON.stringify(payload, null, 2), format };
};
