/** Offline HEAT-101 adapter. No HTTP/auth/database integration is enabled here. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const schema = JSON.parse(readFileSync(new URL('./event-publication.schema.json', import.meta.url), 'utf8'));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// Deliberately supports only the keywords in the pinned publication schema.
function validate(rule, value) {
  if (rule.const !== undefined && value !== rule.const) throw new TypeError('Invalid source');
  if (rule.enum && !rule.enum.includes(value)) throw new TypeError('Invalid status');
  if (rule.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected object');
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) throw new TypeError('Missing ' + key);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(rule.properties, key)) throw new TypeError('Unexpected field: ' + key);
      validate(rule.properties[key], value[key]);
    }
  }
  if (rule.type === 'integer' && (!Number.isSafeInteger(value) || value < rule.minimum)) throw new TypeError('Invalid revision');
  if (rule.type === 'string') {
    if (typeof value !== 'string') throw new TypeError('Expected string');
    const length = [...value].length;
    if (length < (rule.minLength ?? 0) || length > (rule.maxLength ?? Infinity)) throw new TypeError('Invalid string length');
    if (rule.format === 'uuid' && !uuid.test(value)) throw new TypeError('Invalid UUID');
    if (rule.format === 'date-time' && (!timestamp.test(value) || !Number.isFinite(Date.parse(value)))) throw new TypeError('Invalid timestamp');
    if (rule.format === 'uri') {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) throw new TypeError('Expected public HTTPS URL');
    }
  }
}

const canonical = value => {
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
};
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/**
 * Reduce a trusted publication into a HEAT staging projection.
 * Caller must verify source transport and publication authorization first.
 * No caller-provided boolean is accepted as authentication evidence.
 * Persistence must serialize updates by source_ref and retain tombstones.
 */
export function projectPublication(current, input) {
  validate(schema, input);
  if (input.status === 'public') {
    for (const key of ['title', 'starts_at', 'ends_at', 'venue']) if (!Object.hasOwn(input, key)) throw new TypeError('Public event missing ' + key);
    if (!input.title.trim() || !input.venue.name.trim()) throw new TypeError('Empty display name');
    if (Date.parse(input.ends_at) <= Date.parse(input.starts_at)) throw new TypeError('Invalid schedule');
  }
  const sourceRef = `tourify:event:${input.event_id.toLowerCase()}`;
  if (current && current.source_ref !== sourceRef) throw new Error('Event identity mismatch');
  if (current && current.revision > input.revision) return { effect: 'stale-ignored', state: current };
  const hash = digest(input);
  if (current && current.revision === input.revision) {
    if (current.content_hash !== hash) throw new Error('Conflicting event revision');
    return { effect: 'duplicate-ignored', state: current };
  }
  // Keep only revision/hash for retractions; never retain withdrawn public text.
  const published = input.status === 'public';
  const state = {
    source_ref: sourceRef,
    revision: input.revision,
    content_hash: hash,
    published,
    publication: published ? structuredClone(input) : null,
    // Flow v1 has no coordinates/timezone/category. Do not invent map data.
    readiness: published ? 'needs-spatial-enrichment' : 'retracted',
  };
  return { effect: published ? 'published' : 'retracted', state };
}

export function publicPublication(state) {
  return state?.published ? structuredClone(state.publication) : null;
}
