/**
 * Source-side eligibility proposal for a future authorized Tourify outbox.
 * This is publication policy, NOT a substitute for API/tenant authorization.
 * Never export discovery rows using its legacy default-to-public behavior.
 */
export function publicationEligibility(table, row) {
  if (!['events', 'artist_events', 'events_v2'].includes(table)) throw new TypeError('Unknown Tourify event source');
  if (!row || typeof row !== 'object' || Array.isArray(row)) return { eligible: false, reason: 'missing-record' };
  const settings = table === 'events_v2' ? row.settings : row.producer_settings;
  if (settings !== undefined && settings !== null && (typeof settings !== 'object' || Array.isArray(settings))) return { eligible: false, reason: 'invalid-visibility' };
  const visibilities = [row.visibility, settings?.visibility].filter(v => v !== undefined && v !== null);
  const flags = [row.is_public, settings?.is_public].filter(v => v !== undefined && v !== null);
  // Explicitly private/unlisted wins even when another field claims public.
  if (visibilities.some(v => v !== 'public') || flags.some(v => v !== true)) return { eligible: false, reason: 'not-public' };
  if (visibilities.length === 0 && flags.length === 0) return { eligible: false, reason: 'publication-consent-missing' };
  const allowed = table === 'events_v2' ? ['confirmed', 'advancing', 'onsite'] : ['published'];
  if (!allowed.includes(row.status)) return { eligible: false, reason: 'not-published' };
  return { eligible: true, reason: 'explicitly-public' };
}
