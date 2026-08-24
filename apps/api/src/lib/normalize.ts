/**
 * Canonical normalization helpers (P2-007).
 * Used for duplicate detection and search. Original titles are always
 * preserved on the event row; only normalized forms feed matching.
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining marks
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MARKETING_SUFFIXES = [
  "tickets",
  "ticket",
  "vip experience",
  "official",
  "presented by",
  "live in concert",
  "in concert",
];

export function normalizeTitle(title: string): string {
  let t = normalizeText(title);
  for (const suffix of MARKETING_SUFFIXES) {
    if (t.endsWith(` ${suffix}`)) {
      t = t.slice(0, t.length - suffix.length - 1).trim();
    }
  }
  return t;
}

/** Token-set Jaccard on normalized titles... */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1;
  const tokenScore = tokenJaccard(na, nb);
  const trigramScore = trigramJaccard(na, nb);
  return Math.max(tokenScore, trigramScore);
}

function tokenJaccard(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const tok of ta) if (tb.has(tok)) intersection += 1;
  const union = new Set([...ta, ...tb]).size;
  return intersection / union;
}

/** Character-trigram Jaccard (pg_trgm-like); catches singular/plural drift. */
function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) {
    set.add(padded.slice(i, i + 3));
  }
  return set;
}

function trigramJaccard(a: string, b: string): number {
  const ga = trigrams(a);
  const gb = trigrams(b);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter += 1;
  const union = new Set([...ga, ...gb]).size;
  return union === 0 ? 0 : inter / union;
}
