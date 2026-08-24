/**
 * Deterministic Las Vegas fixture data (P0-014 / P2-009).
 * Titles are synthetic; venue coordinates are approximate public places.
 * Times are hour-offsets from seed time so NOW/TONIGHT always demo well.
 */

export interface VenueSeed {
  key: string;
  name: string;
  lat: number;
  lng: number;
  locality: string;
  address: string;
  capacity: number | null;
}

export const VENUES: VenueSeed[] = [
  { key: "sphere", name: "Sphere", lat: 36.1255, lng: -115.1688, locality: "Las Vegas", address: "255 Sands Ave", capacity: 18_600 },
  { key: "bleau-theatre", name: "BleauLive Theater", lat: 36.1271, lng: -115.1703, locality: "Las Vegas", address: "3000 S Las Vegas Blvd", capacity: 5_500 },
  { key: "liv", name: "LIV Las Vegas", lat: 36.1286, lng: -115.1660, locality: "Las Vegas", address: "3355 S Las Vegas Blvd", capacity: 2_800 },
  { key: "omnia", name: "Omnia Nightclub", lat: 36.1162, lng: -115.1745, locality: "Las Vegas", address: "3570 S Las Vegas Blvd", capacity: 3_200 },
  { key: "xs", name: "XS Nightclub", lat: 36.1267, lng: -115.1741, locality: "Las Vegas", address: "3131 S Las Vegas Blvd", capacity: 3_000 },
  { key: "zouk", name: "Zouk Group Las Vegas", lat: 36.1291, lng: -115.1621, locality: "Las Vegas", address: "3000 S Las Vegas Blvd", capacity: 2_600 },
  { key: "allegiant", name: "Allegiant Stadium", lat: 36.0908, lng: -115.1836, locality: "Las Vegas", address: "3333 Al Davis Way", capacity: 65_000 },
  { key: "t-mobile", name: "T-Mobile Arena", lat: 36.1027, lng: -115.1792, locality: "Las Vegas", address: "3780 S Las Vegas Blvd", capacity: 20_000 },
  { key: "fremont-country-club", name: "Fremont Country Club", lat: 36.1725, lng: -115.1396, locality: "Las Vegas", address: "601 E Fremont St", capacity: 900 },
  { key: "container-park", name: "Downtown Container Park", lat: 36.1692, lng: -115.1405, locality: "Las Vegas", address: "707 Fremont St", capacity: 1_200 },
  { key: "sand-dollar", name: "The Sand Dollar Lounge", lat: 36.1521, lng: -115.2014, locality: "Las Vegas", address: "3355 W Reno Ave", capacity: 250 },
  { key: "area15", name: "AREA15", lat: 36.1452, lng: -115.1873, locality: "Las Vegas", address: "3215 S Rancho Dr", capacity: 4_000 },
  { key: "brooklyn-bowl", name: "Brooklyn Bowl Las Vegas", lat: 36.1283, lng: -115.1571, locality: "Las Vegas", address: "3545 S Las Vegas Blvd", capacity: 2_000 },
  { key: "notoriety", name: "Notoriety Live", lat: 36.1701, lng: -115.1442, locality: "Las Vegas", address: "520 Fremont St", capacity: 400 },
  { key: "lvcc", name: "Las Vegas Convention Center", lat: 36.1313, lng: -115.1511, locality: "Las Vegas", address: "3150 Paradise Rd", capacity: 50_000 },
  { key: "sunset-park", name: "Sunset Park", lat: 36.1176, lng: -115.1915, locality: "Las Vegas", address: "2601 E Sunset Rd", capacity: 5_000 },
  { key: "arts-factory", name: "Arts Factory", lat: 36.1589, lng: -115.1463, locality: "Las Vegas", address: "107 E Charleston Blvd", capacity: 350 },
  { key: "valley-ballroom", name: "Valley Ballroom", lat: 36.1212, lng: -115.2088, locality: "Las Vegas", address: "8615 W Sahara Ave", capacity: 600 },
];

export interface EventSeed {
  key: string;
  title: string;
  category: string;
  venueKey?: string;
  lat?: number;
  lng?: number;
  /** Hours relative to seed time. */
  startH: number;
  endH: number | null;
  status?: "scheduled" | "canceled" | "postponed";
  heat: number;
  confidence: number | null;
  attLow?: number;
  attHigh?: number;
  attType?: string;
  priceMin?: number;
  priceMax?: number;
  ticketUrl?: string | null;
  description?: string;
  ageRestriction?: string;
  verification?: string;
  visibility?: string;
}

export const EVENTS: EventSeed[] = [
  // --- Active now ---
  { key: "active-arena-show", title: "Neon Skyline World Tour", category: "music", venueKey: "sphere", startH: -1.5, endH: 2.5, heat: 91, confidence: 78, attLow: 12_400, attHigh: 15_800, attType: "pre_event_forecast", priceMin: 89, priceMax: 340, ticketUrl: "https://tickets.example.com/neon-skyline", ageRestriction: "All ages", verification: "multi_source_verified" },
  { key: "active-nightclub", title: "Midnight Gold Residency", category: "nightlife", venueKey: "liv", startH: -1, endH: 5, heat: 84, confidence: 62, attLow: 1_150, attHigh: 1_650, attType: "intent_adjusted_forecast", priceMin: 40, priceMax: 120, ticketUrl: "https://tickets.example.com/midnight-gold", ageRestriction: "21+", verification: "source_verified" },
  { key: "active-community", title: "Sunset Park Community Picnic", category: "community", venueKey: "sunset-park", startH: -2, endH: 3, heat: 22, confidence: 40, attType: "unknown", verification: "community" },

  // --- Starting soon / tonight ---
  { key: "soon-lounge-set", title: "Desert Soul Live Trio", category: "music", venueKey: "sand-dollar", startH: 0.75, endH: 3.25, heat: 47, confidence: 55, attLow: 120, attHigh: 210, attType: "pre_event_forecast", priceMin: 15, priceMax: 25, ticketUrl: "https://tickets.example.com/desert-soul", verification: "community" },
  { key: "tonight-club-a", title: "After Dark: Neon Nights", category: "nightlife", venueKey: "omnia", startH: 5, endH: 10, heat: 76, confidence: 58, attLow: 1_800, attHigh: 2_400, attType: "intent_adjusted_forecast", priceMin: 30, priceMax: 100, ageRestriction: "21+", verification: "source_verified" },
  { key: "tonight-arena-game", title: "Valley Kings vs Coastal Sharks", category: "sports", venueKey: "t-mobile", startH: 4, endH: 7, heat: 88, confidence: 80, attLow: 17_500, attHigh: 19_800, attType: "pre_event_forecast", priceMin: 65, priceMax: 420, verification: "multi_source_verified" },
  { key: "after-midnight", title: "Late Night Vinyl Sessions", category: "party", venueKey: "fremont-country-club", startH: 7, endH: 11, heat: 58, confidence: 45, attLow: 350, attHigh: 700, attType: "intent_adjusted_forecast", priceMin: 10, priceMax: 20, verification: "community" },
  { key: "no-end-time", title: "Open Decks Rooftop Social", category: "party", venueKey: "container-park", startH: 6, endH: null, heat: 41, confidence: 35, attType: "unknown", verification: "community" },
  { key: "immersive-area15", title: "Wanderland Immersive Experience", category: "arts", venueKey: "area15", startH: 3, endH: 9, heat: 63, confidence: 52, attLow: 900, attHigh: 1_600, attType: "pre_event_forecast", priceMin: 49, priceMax: 99, verification: "source_verified" },
  { key: "comedy-notoriety", title: "Standup Under the Lights", category: "arts", venueKey: "notoriety", startH: 5.5, endH: 8, heat: 39, confidence: 48, attLow: 180, attHigh: 320, attType: "pre_event_forecast", priceMin: 25, priceMax: 45, ageRestriction: "18+", verification: "community" },
  { key: "bowl-concert", title: "Strike & Sound: Indie Night", category: "music", venueKey: "brooklyn-bowl", startH: 6.5, endH: 10.5, heat: 66, confidence: 57, attLow: 900, attHigh: 1_500, attType: "intent_adjusted_forecast", priceMin: 20, priceMax: 60, ticketUrl: "https://tickets.example.com/strike-sound", verification: "source_verified" },
  { key: "xs-tonight", title: "Poolside Afterhours", category: "nightlife", venueKey: "xs", startH: 8, endH: 13, heat: 71, confidence: 50, attLow: 1_200, attHigh: 2_100, attType: "pre_event_forecast", priceMin: 30, priceMax: 150, ageRestriction: "21+", verification: "source_verified" },
  { key: "zouk-tonight", title: "Basement Beats Vol. 12", category: "nightlife", venueKey: "zouk", startH: 5.5, endH: 10.5, heat: 79, confidence: 61, attLow: 1_400, attHigh: 2_000, attType: "intent_adjusted_forecast", priceMin: 35, priceMax: 125, ageRestriction: "21+", verification: "source_verified" },
  { key: "bleau-residency", title: "Velvet Mic Residency Finale", category: "music", venueKey: "bleau-theatre", startH: 4.5, endH: 7.5, heat: 82, confidence: 72, attLow: 3_900, attHigh: 5_100, attType: "pre_event_forecast", priceMin: 95, priceMax: 450, ticketUrl: "https://tickets.example.com/velvet-mic", verification: "multi_source_verified" },

  // --- Tomorrow / far future ---
  { key: "tomorrow-food", title: "First Friday Food Truck Rally", category: "food", venueKey: "arts-factory", startH: 26, endH: 32, heat: 44, confidence: 42, attLow: 600, attHigh: 1_100, attType: "pre_event_forecast", verification: "community" },
  { key: "convention-tech", title: "Silver State Tech Summit — Day One", category: "convention", venueKey: "lvcc", startH: 16, endH: 24, heat: 54, confidence: 66, attLow: 18_000, attHigh: 26_000, attType: "pre_event_forecast", ticketUrl: "https://tickets.example.com/ssts", verification: "source_verified" },
  { key: "far-festival", title: "Canyon Lights Music Festival", category: "festival", venueKey: "allegiant", startH: 72, endH: 84, heat: 87, confidence: 70, attLow: 38_000, attHigh: 52_000, attType: "pre_event_forecast", priceMin: 129, priceMax: 899, verification: "multi_source_verified" },
  { key: "far-stadium", title: "Silver Cup Championship", category: "sports", venueKey: "allegiant", startH: 96, endH: 101, heat: 93, confidence: 74, attLow: 55_000, attHigh: 64_500, attType: "pre_event_forecast", priceMin: 180, priceMax: 2400, verification: "multi_source_verified" },

  // --- Canceled / postponed (clearly marked) ---
  { key: "canceled-show", title: "Harbor Lights Acoustic Evening", category: "music", venueKey: "notoriety", startH: 6, endH: 8.5, status: "canceled", heat: 12, confidence: 90, attType: "unknown", verification: "source_verified" },
  { key: "postponed-panel", title: "Creator Economy Panel Night", category: "community", venueKey: "container-park", startH: 30, endH: 32, status: "postponed", heat: 15, confidence: 85, attType: "unknown", verification: "community" },

  // --- Same venue pair + duplicate-like titles for resolution tests ---
  { key: "samevenue-early", title: "Twilight Sessions: Early Set", category: "music", venueKey: "brooklyn-bowl", startH: 3, endH: 5.5, heat: 52, confidence: 55, attLow: 700, attHigh: 1_100, attType: "pre_event_forecast", verification: "source_verified" },
  { key: "samevenue-late", title: "Twilight Sessions: Late Set", category: "music", venueKey: "brooklyn-bowl", startH: 6.5, endH: 10, heat: 68, confidence: 59, attLow: 900, attHigh: 1_400, attType: "pre_event_forecast", ticketUrl: "https://tickets.example.com/twilight-late", verification: "source_verified" },
  { key: "dup-like-a", title: "Red Rocks Revue", category: "music", venueKey: "sand-dollar", startH: 8, endH: 10.5, heat: 36, confidence: 44, attType: "unknown", verification: "community" },
  { key: "dup-like-b", title: "Red Rock Revue!", category: "music", venueKey: "sand-dollar", startH: 8.25, endH: 10.75, heat: 34, confidence: 44, attType: "unknown", verification: "community" },

  // --- Long title / sparse event (TC-P4-001) ---
  { key: "long-title", title: "An Evening of Jazz Standards and Stories with the Midnight Quartet and Special Guests", category: "music", venueKey: "valley-ballroom", startH: 28, endH: 31, heat: 29, confidence: 40, attType: "unknown", verification: "community" },
  { key: "sparse-native", title: "Pickup Soccer at the Park", category: "sports", lat: 36.1051, lng: -115.2082, startH: 22, endH: 24, heat: 9, confidence: null, attType: "unknown", verification: "community" },

  // --- Hidden example (moderation baseline) ---
  { key: "hidden-spam", title: "CRYPTO ALPHA MEETUP!!!", category: "other", venueKey: "area15", startH: 12, endH: 13, heat: 3, confidence: 10, attType: "unknown", visibility: "hidden", verification: "community" },
];
