/* ==========================================================================
   WCA Archive, shared data layer
   Every page on the site (Archive Viewer, Player/Team/Venue pages, Records
   pages) loads JSON through this module. Nothing else should call fetch()
   directly on a data/ path, keeps the "no data" rule and linking logic in
   one place.
   ========================================================================== */

const WCA = (() => {

    const DATA_BASE = "data"; // relative to site root

    const cache = new Map();

    /**
     * Fetch a JSON file under data/, with in-memory caching.
     * @param {string} relPath e.g. "players/json/AB de Villiers.json"
     * @returns {Promise<any>} parsed JSON, or null if the file 404s
     */
    async function fetchJSON(relPath) {
        if (cache.has(relPath)) return cache.get(relPath);
        const url = `${DATA_BASE}/${relPath}`;
        try {
            const res = await fetch(url);
            if (!res.ok) {
                cache.set(relPath, null);
                return null;
            }
            const json = await res.json();
            cache.set(relPath, json);
            return json;
        } catch (err) {
            console.error("WCA.fetchJSON failed:", url, err);
            cache.set(relPath, null);
            return null;
        }
    }

    /** Load a player by their exact Known_Name (filename, unencoded). */
    function fetchPlayer(name) {
        return fetchJSON(`players/json/${encodeURIComponent(name)}.json`);
    }
    function fetchTeam(name) {
        return fetchJSON(`teams/json/${encodeURIComponent(name)}.json`);
    }
    function fetchVenue(name) {
        return fetchJSON(`venues/json/${encodeURIComponent(name)}.json`);
    }
    function fetchRecord(section, file) {
        return fetchJSON(`records/${section}/json/${encodeURIComponent(file)}.json`);
    }
    function fetchSummary(name) {
        return fetchJSON(`summaries/json/${encodeURIComponent(name)}.json`);
    }
    function fetchRecordHolders() {
        return fetchJSON(`metadata/record_holders.json`);
    }
    function fetchStandings() {
        return fetchJSON(`standings/json/Standings.json`);
    }
    /** One match, by its slug (filename, no .json / no encoding needed - slugs are already URL-safe). */
    function fetchMatch(slug) {
        return fetchJSON(`matches/json/${slug}.json`);
    }
    /** Flat list of every match (season/format/venue/teams/result) - for seasons.html and team/venue "recent results". */
    function fetchMatchIndex() {
        return fetchJSON(`matches/index/MatchIndex.json`);
    }
    /** (Date|Opposition) -> slug reverse lookup, for linking a record row's Date cell to its match. */
    function fetchMatchLookupIndex() {
        return fetchJSON(`matches/index/DateOppositionIndex.json`);
    }
    /**
     * Resolve a record row's Date + Opposition to a match slug, or null on
     * a miss (old/low-quality match, or a record type not yet in scope for
     * this index - render plain text in that case, never a dead link).
     */
    async function resolveMatchSlug(date, opposition) {
        const index = await fetchMatchLookupIndex();
        if (!index) return null;
        return index[`${date}|${opposition}`] || null;
    }
    // One match.html template + a slug query param, same pattern as
    // player.html?name=/team.html?name= - NOT one physical HTML file per
    // match (that'd be ~1835 static files for no benefit; the slug already
    // keeps Match_ID out of the URL, which was the actual goal).
    function matchUrl(slug) {
        return `match.html?slug=${encodeURIComponent(slug)}`;
    }

    /**
     * "No data" rule: a section counts as empty if it's missing, or every
     * value inside it is an empty array / falsy. Handles all three shapes
     * documented in the handoff (missing key, {}/[], populated).
     */
    function hasData(section) {
        if (!section) return false;
        if (Array.isArray(section)) return section.length > 0;
        if (typeof section !== "object") return !!section;
        return Object.values(section).some(v =>
            Array.isArray(v) ? v.length > 0 : hasData(v)
        );
    }

    // ---------------------------------------------------------------------
    // Metadata indexes (data/metadata/*.csv), used by browse pages and the
    // map, since a static site can't list a data/ folder's contents itself.
    // These are plain single-column CSVs (one name per line), except
    // Venue_Master_Cleaned.csv which carries coordinates.
    // ---------------------------------------------------------------------

    function parseCsvLine(line) {
        // Minimal CSV cell splitter, handles quoted fields containing commas,
        // which is all these metadata files need (no escaped quotes inside).
        const cells = [];
        let cur = "", inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { inQuotes = !inQuotes; continue; }
            if (ch === "," && !inQuotes) { cells.push(cur); cur = ""; continue; }
            cur += ch;
        }
        cells.push(cur);
        return cells;
    }

    // Browsers' TextDecoder doesn't support "cp437" as a label at all (it's
    // not part of the WHATWG Encoding Standard, unlike windows-1252), so
    // the one metadata CSV that turned out to be saved in that old DOS/OEM
    // codepage needs a hand-rolled table instead of a built-in decoder.
    const CP437_HIGH = "\u00C7\u00FC\u00E9\u00E2\u00E4\u00E0\u00E5\u00E7\u00EA\u00EB\u00E8\u00EF\u00EE\u00EC\u00C4\u00C5" +
        "\u00C9\u00E6\u00C6\u00F4\u00F6\u00F2\u00FB\u00F9\u00FF\u00D6\u00DC\u00A2\u00A3\u00A5\u20A7\u0192" +
        "\u00E1\u00ED\u00F3\u00FA\u00F1\u00D1\u00AA\u00BA\u00BF\u2310\u00AC\u00BD\u00BC\u00A1\u00AB\u00BB" +
        "\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255D\u255C\u255B\u2510" +
        "\u2514\u2534\u252C\u251C\u2500\u253C\u255E\u255F\u255A\u2554\u2569\u2566\u2560\u2550\u256C\u2567" +
        "\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256B\u256A\u2518\u250C\u2588\u2584\u258C\u2590\u2580" +
        "\u03B1\u00DF\u0393\u03C0\u03A3\u03C3\u00B5\u03C4\u03A6\u0398\u03A9\u03B4\u221E\u03C6\u03B5\u2229" +
        "\u2261\u00B1\u2265\u2264\u2320\u2321\u00F7\u2248\u00B0\u2219\u00B7\u221A\u207F\u00B2\u25A0\u00A0";

    function decodeCp437(buffer) {
        const bytes = new Uint8Array(buffer);
        let out = "";
        for (let i = 0; i < bytes.length; i++) {
            out += bytes[i] < 0x80 ? String.fromCharCode(bytes[i]) : CP437_HIGH[bytes[i] - 0x80];
        }
        return out;
    }

    async function fetchCsvRows(relPath) {
        if (cache.has(relPath)) return cache.get(relPath);
        try {
            const res = await fetch(`${DATA_BASE}/${relPath}`);
            if (!res.ok) { cache.set(relPath, []); return []; }
            const buffer = await res.arrayBuffer();
            let text;
            try {
                // Strict UTF-8 first, throws on the first invalid byte
                // rather than silently substituting U+FFFD (�), which is
                // what a lenient decode does and is exactly the mojibake
                // this is meant to catch.
                text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
            } catch (e) {
                // Some of these metadata CSVs turned out to be saved in
                // CP437 (old DOS/OEM codepage) rather than UTF-8.
                text = decodeCp437(buffer);
            }
            const rows = text.split(/\r?\n/).filter(l => l.trim().length).map(parseCsvLine);
            cache.set(relPath, rows);
            return rows;
        } catch (err) {
            console.error("WCA.fetchCsvRows failed:", relPath, err);
            cache.set(relPath, []);
            return [];
        }
    }

    /** @param {"players"|"teams"|"venues"} kind */
    async function fetchNameIndex(kind) {
        const file = { players: "Known_Name", teams: "Team_Name", venues: "Venue_Name" }[kind];
        const rows = await fetchCsvRows(`metadata/${file}.csv`);
        return rows.map(r => r[0]).filter(Boolean);
    }

    /** Venue name -> {city, lat, lng}, keyed by the canonical Suggested_Name. */
    async function fetchVenueCoords() {
        const key = "metadata/Venue_Master_Cleaned.csv";
        if (cache.has(`parsed:${key}`)) return cache.get(`parsed:${key}`);
        const rows = await fetchCsvRows(key);
        const [header, ...data] = rows;
        const idx = {};
        header.forEach((h, i) => { idx[h.trim()] = i; });
        const map = {};
        data.forEach(r => {
            const name = r[idx["Suggested_Name"]];
            if (!name) return;
            map[name] = {
                city: r[idx["City"]],
                lat: parseFloat(r[idx["Latitude"]]),
                lng: parseFloat(r[idx["Longitude"]]),
            };
        });
        cache.set(`parsed:${key}`, map);
        return map;
    }

    /** Venue name -> array of team names whose home ground it is, built
        from each team.json's own Home Venue row (summary is a Metric/Value
        row array, not a plain object, since it's the same 2-column table
        team.html renders). Array-valued in case two teams ever share a
        ground, though in practice this is 1:1 for all 16 teams. */
    async function fetchHomeGrounds() {
        const key = "computed:homeGrounds";
        if (cache.has(key)) return cache.get(key);

        const teamNames = await fetchNameIndex("teams");
        const teams = await Promise.all(teamNames.map(name => fetchTeam(name)));

        const map = {};
        teamNames.forEach((teamName, i) => {
            const data = teams[i];
            const row = data && Array.isArray(data.summary)
                ? data.summary.find(r => r.Metric === "Home Venue")
                : null;
            if (row && row.Value) {
                (map[row.Value] = map[row.Value] || []).push(teamName);
            }
        });

        cache.set(key, map);
        return map;
    }

    /** Team_Name -> array of former/alias names, from metadata/Team_Strings.csv (Team_String, Team_Name columns). */
    async function fetchTeamAliases() {
        const key = "metadata/Team_Strings.csv";
        if (cache.has(`parsed:${key}`)) return cache.get(`parsed:${key}`);
        const rows = await fetchCsvRows(key);
        const [header, ...data] = rows;
        const idx = {};
        header.forEach((h, i) => { idx[h.trim()] = i; });
        const map = {};
        data.forEach(r => {
            const teamString = (r[idx["Team_String"]] || "").trim();
            const teamName = (r[idx["Team_Name"]] || "").trim();
            if (!teamString || !teamName || teamString === teamName) return; // not an alias, just the current name
            (map[teamName] = map[teamName] || []).push(teamString);
        });
        cache.set(`parsed:${key}`, map);
        return map;
    }

    // ---------------------------------------------------------------------
    // Entity link helpers, Player/Team/Venue name -> site URL
    // ---------------------------------------------------------------------

    function playerUrl(name) {
        return `player.html?name=${encodeURIComponent(name)}`;
    }
    function teamUrl(name) {
        return `team.html?name=${encodeURIComponent(name)}`;
    }
    function venueUrl(name) {
        return `venue.html?name=${encodeURIComponent(name)}`;
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, c => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    }

    // "OVERALL" is a real data value (meaning "combined"), not a placeholder
    //, comparisons against it elsewhere in the codebase must keep using the
    // literal all-caps string. This only governs what gets shown on screen.
    function displayValue(v) {
        return String(v).toUpperCase() === "OVERALL" ? "Overall" : v;
    }

    /** A single name -> an anchor tag pointing at the right page. */
    function entityLink(name, kind) {
        const clean = String(name).trim();
        if (!clean || clean === "-" || clean.toUpperCase() === "OVERALL") return escapeHtml(displayValue(clean));
        const url = kind === "player" ? playerUrl(clean)
                  : kind === "team" ? teamUrl(clean)
                  : venueUrl(clean);
        return `<a class="wca-entity-link" href="${url}">${escapeHtml(clean)}</a>`;
    }

    /**
     * Some columns hold combined values ("Badgers / Dragons", "Lizelle Lee &
     * Tazmin Brits"), split on & or / and link each piece separately,
     * rejoining with the original-style separator.
     */
    function entityLinkMulti(value, kind) {
        const raw = String(value);
        const parts = raw.split(/\s*[&,/]\s*/);
        if (parts.length === 1) return entityLink(raw, kind);
        const sep = raw.includes("&") ? " &amp; " : (raw.includes(",") ? ", " : " / ");
        return parts.map(p => entityLink(p, kind)).join(sep);
    }

    // Column-name -> how to render it. Checked case-sensitively against the
    // exact key from the JSON row. Extend as new column names turn up.
    const LINK_COLUMNS = {
        "Player": { kind: "player", multi: false },
        "Team": { kind: "team", multi: false },
        "Teams": { kind: "team", multi: true },
        "Team_Home": { kind: "team", multi: false },
        "Team_Away": { kind: "team", multi: false },
        "Bowling Team": { kind: "team", multi: false },
        "Batting Team": { kind: "team", multi: false },
        "Pair": { kind: "player", multi: true },
        "Venue": { kind: "venue", multi: false },
        "Opposition": { kind: "team", multi: false },
        "Opponent": { kind: "team", multi: false },
    };

    /** Render a single table cell's value, linking it if the column warrants it. */
    function renderCell(colName, value) {
        if (value === null || value === undefined || value === "") return "-";
        const rule = LINK_COLUMNS[colName];
        if (!rule) return escapeHtml(displayValue(value));
        return rule.multi ? entityLinkMulti(value, rule.kind) : entityLink(value, rule.kind);
    }

    // ---------------------------------------------------------------------
    // Dynamic stamp-column detection (Format / Season / *_Tier)
    // Record files are inconsistent about which of these exist, never
    // assume, always detect from the actual rows.
    // ---------------------------------------------------------------------

    function detectStampColumns(rows) {
        if (!rows || !rows.length) return { hasFormat: false, hasSeason: false, tierKey: null };
        const keys = Object.keys(rows[0]);
        const tierKey = keys.find(k => /_Tier$/.test(k)) || null;
        return {
            hasFormat: keys.includes("Format"),
            hasSeason: keys.includes("Season"),
            tierKey,
        };
    }

    // Friendly display labels for known raw column names. Anything not
    // listed falls back to a generic prettifier.
    const FRIENDLY_LABELS = {
        "Batting_Opposition_Tier": "Opposition Tier",
        "Bowling_Opposition_Tier": "Opposition Tier",
        "Fielding_Opposition_Tier": "Opposition Tier",
        "Part_Opposition_Tier": "Opposition Tier",
        "Strike-Rate": "Strike Rate",
        "BBI": "Best Bowling (Innings)",
        // Cosmetic overrides for typos/awkward phrasing already baked into
        // the exported data, fixed here at display time rather than in
        // the export, so this survives a re-export without needing to be
        // reapplied upstream.
        "WK DIsmissals": "WK Dismissals",
        "4-for's": "4-Wicket Hauls",
        "5-for's": "5-Wicket Hauls",
        "4 Wickets": "4-Wicket Hauls",
        "5 Wickets": "5-Wicket Hauls",
    };

    function friendlyLabel(key) {
        if (FRIENDLY_LABELS[key]) return FRIENDLY_LABELS[key];
        return String(key)
            .replace(/_/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    // Standings.json Finish_Type enum -> display label. LEAGUE_WINNER is
    // its own value (rather than being pre-collapsed into CHAMPION at build
    // time) because it means something distinct: the title was decided by
    // the league table alone, no playoffs were held that season. The two
    // "didn't advance" cases use parallel "___ Exit" phrasing instead of
    // leading with "Eliminated" every time, repeating that word down a
    // whole column of finishes reads worse than the stage name alone does.
    const FINISH_TYPE_LABELS = {
        CHAMPION: "Champion",
        LEAGUE_WINNER: "Champion (League Winner)",
        RUNNER_UP: "Runner-up",
        THIRD_PLACE: "Third Place",
        SEMI_FINALIST: "Semi-finalist",
        POOL_WINNER_ADVANCED: "Advanced from Pool",
        ELIMINATED_REGULAR_SEASON: "Regular Season Finish",
        ELIMINATED_POOL_STAGE: "Pool Stage Finish",
    };

    function finishTypeLabel(code) {
        return FINISH_TYPE_LABELS[code] || friendlyLabel(code);
    }

    // ---------------------------------------------------------------------
    // Match display copy, natural-language sentences built from structured
    // fields at render time (winner/decision/margin), not baked in at
    // export time. Keeps the export dumb/reusable and means a wording fix
    // is a one-function edit instead of a full re-export of ~1835 matches.
    // ---------------------------------------------------------------------

    /** @param {string|null} winner @param {string|null} decision */
    function tossLabel(winner, decision) {
        if (!winner || !decision) return "Toss: not recorded";
        return `${winner} won the toss and decided to ${decision.toLowerCase()}`;
    }

    /**
     * @param {string|null} winner
     * @param {string|number|null} margin
     * @param {string|null} marginType
     * @param {string|null} [outcome] - the match-level Match_Outcome value
     *   (e.g. "Abandoned", "No Result") read off a team row when no team's
     *   outcome is "Won". Abandoned/no-result matches ARE recorded, just
     *   not with a winner, so this is the real status rather than a blank -
     *   only fall back to "Result not recorded" when even that's missing.
     */
    function resultLabel(winner, margin, marginType, outcome) {
        if (!winner) return outcome || "Result not recorded";
        if (margin == null || margin === "" || !marginType) return `${winner} won`;
        const n = Number(margin);
        const unit = marginType.toLowerCase(); // "Runs" | "Wickets"
        const count = Number.isFinite(n) ? (n % 1 === 0 ? n : n.toFixed(1)) : margin;
        return `${winner} won by ${count} ${unit}`;
    }

    return {
        fetchJSON, fetchPlayer, fetchTeam, fetchVenue, fetchRecord, fetchSummary, fetchRecordHolders,
        fetchStandings,
        fetchMatch, fetchMatchIndex, fetchMatchLookupIndex, resolveMatchSlug, matchUrl,
        fetchNameIndex, fetchVenueCoords, fetchTeamAliases, fetchHomeGrounds,
        hasData, playerUrl, teamUrl, venueUrl, entityLink, entityLinkMulti,
        renderCell, detectStampColumns, friendlyLabel, finishTypeLabel, tossLabel, resultLabel, escapeHtml, displayValue,
    };
})();
