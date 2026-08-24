import { describe, expect, it } from "vitest";
import { normalizeText, normalizeTitle, titleSimilarity } from "../src/lib/normalize.js";

describe("normalize", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalizeText("  Red Rocks   Revue! ")).toBe("red rocks revue");
  });

  it("strips marketing suffixes but keeps identity words", () => {
    expect(normalizeTitle("Red Rocks Revue Tickets")).toBe("red rocks revue");
    expect(normalizeTitle("Neon Nights Official")).toBe("neon nights");
  });

  it("title similarity detects near-duplicates (doc 06)", () => {
    expect(titleSimilarity("Red Rocks Revue", "Red Rock Revue!")).toBeGreaterThan(0.7);
    expect(titleSimilarity("Twilight Sessions: Early Set", "Twilight Sessions: Late Set")).toBeGreaterThan(0.3);
    expect(titleSimilarity("Completely Different Thing", "Red Rocks Revue")).toBeLessThan(0.4);
  });
});
