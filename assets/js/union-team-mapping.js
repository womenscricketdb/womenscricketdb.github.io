/* ==========================================================================
   ASSUMPTION, please confirm before relying on the map for navigation.

   CricketUnions.geojson (and union-map.js's UNION_COLORS) key everything by
   a short union code ("WP", "EP", "Eastern", "Impalas", etc.), but the
   site's actual team pages are keyed by the full Team_Name values from
   data/metadata/Team_Name.csv (e.g. "Western Province", "Eastern Storm").

   12 of the 16 codes match a Team_Name exactly (Badgers, Boland, Dolphins,
   Dragons, Heat, Iinyathi, Kei, Knights, Lions, Rhinos, Titans, Tuskers), left out of this table since no translation is needed. The 4 below were
   inferred from general SA domestic cricket naming and need a sanity check:

     WP       -> Western Province
     EP       -> Warriors
     Eastern  -> Eastern Storm
     Impalas  -> Limpopo Lillies

   If any of those four are wrong, fix them here, every map/highlight page
   reads from this one table.
   ========================================================================== */

const UNION_TO_TEAM_NAME = {
    Boland: "Boland",
    Badgers: "Badgers",
    WP: "Western Province",
    EP: "Warriors",
    Iinyathi: "Iinyathi",
    Kei: "Kei",
    Heat: "Heat",
    Dolphins: "Dolphins",
    Tuskers: "Tuskers",
    Knights: "Knights",
    Dragons: "Dragons",
    Rhinos: "Rhinos",
    Lions: "Lions",
    Eastern: "Eastern Storm",
    Titans: "Titans",
    Impalas: "Limpopo Lillies",
};

// Reverse lookup, Team_Name -> union code, used by team.html to find
// which shape to highlight for a given team.
const TEAM_NAME_TO_UNION = Object.fromEntries(
    Object.entries(UNION_TO_TEAM_NAME).map(([union, team]) => [team, union])
);
