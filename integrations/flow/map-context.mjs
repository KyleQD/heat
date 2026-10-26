/** HEAT staging extension. Flow's upstream v1 contract remains unchanged. */
import { createHash } from 'node:crypto';
import { projectPublication } from './publication.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Pinned to packages/domain/src/index.ts at HEAT main 933943318a1d70f89468d0176837444b88bc9b10.
const categories = new Set(['music', 'nightlife', 'festival', 'sports', 'food', 'arts', 'community', 'convention', 'party', 'other']);
const contextFields = ['event_id', 'publication_revision', 'venue_id', 'heat_event_id', 'heat_venue_id', 'lat', 'lng', 'timezone', 'category'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exactKeys(value, keys) {
  if (!object(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) throw new TypeError('Invalid map envelope fields');
}
function validateContext(context, publication) {
  exactKeys(context, contextFields);
  if (publication.status !== 'public') throw new TypeError('Withdrawals cannot carry map context');
  for (const key of ['event_id', 'venue_id', 'heat_event_id', 'heat_venue_id']) if (typeof context[key] !== 'string' || !uuid.test(context[key])) throw new TypeError('Invalid context identity');
  if (context.event_id.toLowerCase() !== publication.event_id.toLowerCase() || context.venue_id.toLowerCase() !== publication.venue.venue_id.toLowerCase() || context.publication_revision !== publication.revision) throw new TypeError('Context is not bound to publication');
  for (const [key, min, max] of [['lat', -90, 90], ['lng', -180, 180]]) if (typeof context[key] !== 'number' || !Number.isFinite(context[key]) || context[key] < min || context[key] > max) throw new TypeError('Invalid coordinate');
  if (typeof context.timezone !== 'string' || context.timezone.length > 80) throw new TypeError('Invalid timezone');
  try { new Intl.DateTimeFormat('en', { timeZone: context.timezone }); }
  catch { throw new TypeError('Invalid timezone'); }
  if (!categories.has(context.category)) throw new TypeError('Invalid HEAT category');
}
const fingerprint = context => context === null ? null : createHash('sha256').update(JSON.stringify(Object.fromEntries(contextFields.map(key => [key, context[key]])))).digest('hex');

/** Transport v1 remains a plain Flow publication; v2 optionally supplies a context. */
export function decodeDelivery(input) {
  if (object(input) && Object.hasOwn(input, 'bridge_version')) {
    exactKeys(input, ['bridge_version', 'publication', 'map_context']);
    if (input.bridge_version !== 'heat-staging/1') throw new TypeError('Unsupported bridge version');
    projectPublication(null, input.publication);
    validateContext(input.map_context, input.publication);
    return { publication: input.publication, context: input.map_context };
  }
  projectPublication(null, input);
  return { publication: input, context: null };
}

export function projectDelivery(current, input) {
  const { publication, context } = decodeDelivery(input);
  const result = projectPublication(current, publication);
  if (result.effect === 'stale-ignored') return result;
  const contextHash = fingerprint(context);
  if (result.effect === 'duplicate-ignored') {
    if ((current.map_context_hash ?? null) !== contextHash) throw new Error('Conflicting event revision');
    return result;
  }
  const mapping = context ? { heat_event_id: context.heat_event_id.toLowerCase(), source_venue_id: context.venue_id.toLowerCase(), heat_venue_id: context.heat_venue_id.toLowerCase() } : current?.mapping ?? null;
  if (current?.mapping && context && (current.mapping.heat_event_id !== mapping.heat_event_id || (current.mapping.source_venue_id === mapping.source_venue_id && current.mapping.heat_venue_id !== mapping.heat_venue_id))) throw new Error('Conflicting canonical mapping');
  return { ...result, state: {
    ...result.state, mapping,
    map_context: context ? structuredClone(context) : null,
    map_context_hash: contextHash,
    readiness: result.state.published ? (context ? 'map-patch-ready' : 'needs-spatial-enrichment') : 'retracted',
  } };
}

/** Server-side write intent, not a mobile response. No SQL writes are performed. */
export function heatEventMutation(state) {
  if (!state?.published) return state?.mapping ? { action: 'hide', id: state.mapping.heat_event_id, visibility_status: 'hidden' } : null;
  // A newer publication without spatial proof must hide the previous map row.
  if (state.readiness !== 'map-patch-ready') return state.mapping ? { action: 'hide', id: state.mapping.heat_event_id, visibility_status: 'hidden' } : null;
  const p = state.publication; const c = state.map_context;
  return {
    action: 'update-mapped-event',
    event: {
      id: state.mapping.heat_event_id, venue_id: state.mapping.heat_venue_id,
      title: p.title, description: p.description ?? null,
      category_key: c.category, lat: c.lat, lng: c.lng, timezone: c.timezone,
      starts_at: p.starts_at, ends_at: p.ends_at,
      status: 'scheduled', visibility_status: 'published',
    },
  };
}
