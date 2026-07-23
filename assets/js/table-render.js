/* ==========================================================================
   WCA Archive, shared table renderer
   Renders a rows-array (flat JSON array of objects) into a DataTable with:
     - columns inferred from the first row's keys, in their original order
     - entity-linked cells (Player/Team/Venue/Pair) via WCA.renderCell
     - Format / Season / *_Tier filter dropdowns, only shown when that
       column actually exists on this data (never assumed), those columns
       are filterable but hidden from the table itself, same as the old
       Archive Viewer's STAMPED_COLS behaviour
     - correct sorting for cricket-specific formats: "3/24" bowling figures,
       "78*" not-out scores, thousands separators
   Any page with a rows array can call WCA_TABLE.render(el, rows, opts), the table itself is rebuilt fresh each call, so callers don't need to
   manage DataTables destroy/init lifecycle themselves.
   ========================================================================== */

const WCA_TABLE = (() => {

    let seq = 0; // unique id suffix, so multiple tables can exist on one page
    const containerTables = new WeakMap(); // container element -> its current DataTable instance

    const LINK_KEYS = {
        Player: 1, Team: 1, Teams: 1, Team_Home: 1, Team_Away: 1,
        "Bowling Team": 1, "Batting Team": 1,
        Pair: 1, Venue: 1, Opposition: 1, Opponent: 1,
    };

    // Single-match record files carry a Date column (or, in one file so
    // far, Match_Date) alongside an Opposition-like column (or, in one
    // file so far, Opponent), never hardcode which literal name is
    // present, detect it per-file the same way detectStampColumns does
    // for Format/Season/*_Tier. Only files with BOTH present are eligible
    // for the Date -> match link (opts.linkMatchDate must also be true;
    // this is opt-in per table, not automatic, since it's scoped to a
    // known-clean subset of record files for now).
    const DATE_KEY_CANDIDATES = ["Date", "Match_Date"];
    const PAIR_KEY_CANDIDATES = ["Opposition", "Opponent"];

    function detectMatchDateLink(rows, opts) {
        if (!opts.linkMatchDate || !rows || !rows.length) return null;
        const keys = Object.keys(rows[0]);
        const dateKey = DATE_KEY_CANDIDATES.find(k => keys.includes(k));
        const pairKey = PAIR_KEY_CANDIDATES.find(k => keys.includes(k));
        if (!dateKey || !pairKey) return null; // e.g. Teams-based aggregate records, on ice, no link
        return { dateKey, pairKey };
    }

    function columnsFromRows(rows, stamp, opts) {
        if (!rows || !rows.length) return [];
        const hiddenKeys = new Set();
        if (!opts.showStampColumns) {
            if (stamp.hasFormat) hiddenKeys.add("Format");
            // In seasonLeaderboard mode, Season is the whole point of the
            // view (which season each ranked row belongs to) - never
            // hidden there, regardless of showStampColumns.
            if (stamp.hasSeason && !opts.seasonLeaderboard) hiddenKeys.add("Season");
            if (stamp.tierKey) hiddenKeys.add(stamp.tierKey);
        }
        // "Career Span" is a real, correct column in Career Totals mode
        // (a player's whole first-to-last-match range), but in
        // seasonLeaderboard mode each row is only ONE season - the value
        // becomes that season's own calendar-year bounds (e.g. "2022 -
        // 2023" for 22/23), a redundant, differently-formatted restatement
        // of the Season column sitting right next to it, and actively
        // mislabelled ("Career Span" implying a multi-season range that
        // isn't there). Hidden here rather than relabelled, since Season
        // already conveys the same fact more precisely.
        if (opts.seasonLeaderboard) hiddenKeys.add("Career Span");
        const keys = Object.keys(rows[0]).filter(key => !hiddenKeys.has(key));
        // Rank always leads, wherever it happens to sit in the source data.
        const rankIdx = keys.indexOf("Rank");
        if (rankIdx > 0) keys.unshift(keys.splice(rankIdx, 1)[0]);
        const dateLink = detectMatchDateLink(rows, opts);
        return keys.map(key => ({
            key,
            label: WCA.friendlyLabel(key),
            isLinked: !!LINK_KEYS[key],
            isDateLink: !!(dateLink && key === dateLink.dateKey),
            pairKey: dateLink ? dateLink.pairKey : null,
        }));
    }

    /** Parse a raw cell value into a value DataTables can sort numerically. */
    function sortValue(key, raw) {
        if (raw === null || raw === undefined) return null;
        const val = String(raw).trim();
        if (val === "" || val === "-") return null;

        // Bowling figures like "3/24", sort by wickets first, runs second.
        if (/^BBI$|Best.?Bowl/i.test(key) && val.includes("/")) {
            const parts = val.split("/");
            if (parts.length === 2) {
                const w = parseInt(parts[0], 10), r = parseInt(parts[1], 10);
                if (!isNaN(w) && !isNaN(r)) return (w * 10000) - r;
            }
        }

        // Not-out scores like "78*", sort fractionally above the plain score.
        if (val.includes("*")) {
            const num = parseFloat(val.replace("*", "").replace(/,/g, ""));
            if (!isNaN(num)) return num + 0.001;
        }

        const parsed = parseFloat(val.replace(/,/g, ""));
        return isNaN(parsed) ? val : parsed;
    }

    function isNumericColumn(key, rows) {
        if (LINK_KEYS[key]) return false;
        let numeric = 0, total = 0;
        for (const row of rows) {
            const v = row[key];
            if (v === null || v === undefined || v === "" || v === "-") continue;
            total += 1;
            const parsed = sortValue(key, v);
            if (typeof parsed === "number") numeric += 1;
        }
        return total > 0 && numeric / total > 0.6;
    }

    /**
     * @param {HTMLElement} container - element to render into (its contents are replaced)
     * @param {Array<Object>} rows - flat array of row objects
     * @param {Object} [opts]
     * @param {string}  [opts.emptyMessage]        shown when rows is empty
     * @param {number}  [opts.pageLength=25]
     * @param {boolean} [opts.showStampColumns]     show Format/Season/Tier as visible columns (default false, filter-only)
     * @param {{col:string,dir:'asc'|'desc'}} [opts.defaultSort]
     * @param {string[]} [opts.lowerIsBetterCols]   columns where ascending is the "best first" direction (e.g. bowling Economy)
     * @param {boolean} [opts.enableThresholdFilter] adds a "column >= value" numeric filter control
     * @param {boolean} [opts.compact]              hide DataTables paging/search/info chrome, for short fixed tables
     * @param {boolean} [opts.noFilters]             suppress the filter line entirely (use when Format/Season/Tier
     *                                                is shown as a normal visible column instead, e.g. a table
     *                                                that's deliberately one row per format, where filtering to
     *                                                one row at a time would remove the point of the table)
     * @param {boolean} [opts.compact2col]            hide the header row, for genuine 2-column key/value tables
     *                                                (e.g. Metric/Value) where the header is pure decoration,
     *                                                since one column already names itself. Not for anything
     *                                                with 3+ meaningfully different columns.
     */
    function render(container, rows, opts = {}) {
        seq += 1;
        const tableId = `wcaTable${seq}`;

        // Tear down any previous table bound to this container properly
        // (fires DataTables' 'destroy' event, which cleans up the custom
        // search function below) before wiping its DOM.
        const prevDt = containerTables.get(container);
        if (prevDt) {
            try { prevDt.destroy(); } catch (e) { /* table DOM already gone */ }
            containerTables.delete(container);
        }
        container.innerHTML = "";

        // "By Season" mode: compare every individual player-season row
        // against every other, rather than the default "one row per
        // player, whole career" view. OVERALL rows are the career
        // aggregate, not a real season, so they'd misleadingly dominate
        // a stat-sorted list alongside genuine single-season figures -
        // excluded here, before the empty-rows check below, so a type
        // with no real per-season rows correctly falls to the empty
        // state rather than silently showing career totals unlabelled.
        if (opts.seasonLeaderboard && rows && rows.length) {
            rows = rows.filter(r => String(r.Season).toUpperCase() !== "OVERALL");
        }

        if (!rows || !rows.length) {
            const div = document.createElement("div");
            div.className = "wca-empty-state";
            div.textContent = opts.emptyMessage || "No data available for this selection.";
            container.appendChild(div);
            return null;
        }

        const stamp = WCA.detectStampColumns(rows);
        const cols = columnsFromRows(rows, stamp, opts);
        const lowerIsBetter = new Set(opts.lowerIsBetterCols || []);

        // --- filter line: labeled Format / Season / Opposition Tier selects,
        // plus an optional "Minimum: <column> >= <value>" threshold filter.
        // Each segment is a real <select>, just styled to sit inline rather
        // than as a row of boxes, still fully functional/keyboard-accessible.
        const filterDefs = [];
        if (!opts.noFilters) {
            if (stamp.hasFormat) filterDefs.push({ key: "Format", label: "Format" });
            // Not offered in seasonLeaderboard mode - filtering to one
            // season would defeat the point of comparing every season
            // against every other at once.
            if (stamp.hasSeason && !opts.seasonLeaderboard) filterDefs.push({ key: "Season", label: "Season" });
            if (stamp.tierKey) {
                const tierLabel = WCA.friendlyLabel(stamp.tierKey);
                filterDefs.push({ key: stamp.tierKey, label: tierLabel });
            }
        }

        const numericCols = (opts.enableThresholdFilter && !opts.noFilters)
            ? cols.filter(c => isNumericColumn(c.key, rows))
            : [];

        // A filterDef's column can exist in the schema (detectStampColumns
        // only checks the key is present) while every value for THIS
        // particular row set is blank (e.g. a short-career player whose
        // opposition breakdown has no Opposition Tier data for the
        // seasons/opponents involved) - drop those here, before building
        // any HTML, so filterDefs and the <select> elements that actually
        // end up in the DOM stay in lockstep. Previously this was only
        // checked when building the segment HTML (silently skipping via
        // `return null`), while the listener-wiring loop further down
        // still iterated the original, larger filterDefs - looking for a
        // <select> that was never created and throwing on .addEventListener,
        // which aborted every render() call still queued after this one.
        const filterValues = new Map();
        filterDefs.forEach(f => {
            const values = Array.from(new Set(rows.map(r => r[f.key]).filter(v => v !== undefined && v !== null && v !== ""))).sort();
            filterValues.set(f.key, values);
        });
        const activeFilterDefs = filterDefs.filter(f => filterValues.get(f.key).length > 0);
        filterDefs.length = 0;
        filterDefs.push(...activeFilterDefs);

        let filterLineHtml = "";
        if (filterDefs.length || numericCols.length) {
            const segments = filterDefs.map(f => {
                const values = filterValues.get(f.key);
                // No blank "All X" option any more - OVERALL already exists
                // as a real, always-present value serving that same role,
                // so every filter always has a concrete value selected from
                // first render rather than an unfiltered/blank state.
                const defaultVal = values.includes("OVERALL") ? "OVERALL" : values[0];
                const options = values.map(v => `<option value="${WCA.escapeHtml(v)}" ${v === defaultVal ? "selected" : ""}>${WCA.escapeHtml(WCA.displayValue(v))}</option>`).join("");
                // The Opposition Tier filter gets an info icon explaining
                // "proxy" tiers (seasons with no official division use a
                // standings-based stand-in), every *_Opposition_Tier
                // column means the same thing, so this applies whenever
                // f.key is a tier column, not just one specific file.
                const isTier = /_Opposition_Tier$/.test(f.key);
                const tooltip = isTier
                    ? ` <i class="bi bi-info-circle-fill text-warning" data-bs-toggle="tooltip" data-bs-placement="top"
                           title="For some seasons, official divisions did not exist. Selecting Div 1 or Div 2 applies a &#39;Proxy Opposition Tier&#39; based on end-of-season standings. This can be used to distinguish the standard of opposition rather than the official competition structure. See the About page for more information."></i>`
                    : "";
                return `<span class="wca-filter-label">${WCA.escapeHtml(f.label)}${tooltip}:</span>
                    <select class="wca-inline-select wca-filter-select" data-col-key="${f.key}" aria-label="${WCA.escapeHtml(f.label)}">
                        ${options}
                    </select>`;
            }).filter(Boolean);

            if (numericCols.length) {
                segments.push(`<span class="wca-filter-label">Minimum:</span>
                    <select class="wca-inline-select" id="${tableId}ThresholdCol" aria-label="Filter column">
                    <option value="">no column filter</option>
                    ${numericCols.map(c => `<option value="${c.key}">${WCA.escapeHtml(c.label)}</option>`).join("")}
                </select>
                <span class="wca-filter-line-op">&ge;</span>
                <input type="number" class="wca-inline-number" id="${tableId}ThresholdVal" placeholder="value" aria-label="Minimum value">`);
            }

            filterLineHtml = `<p class="wca-filter-line">${segments.join(" <span class=\"wca-filter-line-sep\">·</span> ")}</p>`;
        }

        const dtDom = opts.compact
            ? "t"
            : "<'d-flex flex-wrap justify-content-between align-items-center mb-3'lf>rt<'d-flex flex-wrap justify-content-between align-items-center mt-2'ip>";

        container.innerHTML = `
        <div class="wca-table-container">
            ${filterLineHtml}
            <div class="table-responsive">
                <table id="${tableId}" class="table table-dark table-striped table-hover wca-datatable ${opts.compact2col ? "wca-no-header" : ""}" style="width:100%">
                    <thead>
                        <tr>${cols.map(c => `<th>${WCA.escapeHtml(c.label)}</th>`).join("")}</tr>
                    </thead>
                </table>
            </div>
        </div>`;

        // Only the Opposition Tier filter carries a tooltip icon, but this
        // stays generic, bootstrap.bundle.min.js isn't loaded on every
        // page that calls WCA_TABLE.render, so guard rather than assume.
        if (typeof bootstrap !== "undefined" && bootstrap.Tooltip) {
            container.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => new bootstrap.Tooltip(el));
        }

        const pageLength = opts.pageLength || (opts.compact ? rows.length : 25);

        const dt = $(`#${tableId}`).DataTable({
            data: rows,
            columns: cols.map(c => ({
                // DataTables treats an unescaped "." in a data path as a
                // nested-property separator (row["a"]["b"] for "a.b"), not
                // a literal character - a key like "No-Results/Aban." would
                // otherwise throw "Requested unknown parameter". Escaping
                // protects any current or future column name containing a
                // literal dot, not just this one.
                data: c.key.replace(/\./g, "\\."),
                className: (c.isLinked || c.isDateLink) ? "wrap-text" : "text-center",
                orderSequence: (c.isLinked || c.isDateLink) ? ["asc", "desc"] : (lowerIsBetter.has(c.key) ? ["asc", "desc"] : ["desc", "asc"]),
                // Full row (3rd arg) is needed for isDateLink, the link
                // target depends on this row's Opposition/Opponent value
                // alongside this cell's own Date value, not the cell alone.
                render: function (data, dtType, row) {
                    if (dtType === "display") {
                        if (c.isDateLink) {
                            const slug = opts.matchDateLink && opts.matchDateLink.index
                                ? opts.matchDateLink.index[`${data}|${row[c.pairKey]}`]
                                : null;
                            if (data === null || data === undefined || data === "") return "-";
                            return slug
                                ? `<a class="wca-entity-link" href="${WCA.matchUrl(slug)}">${WCA.escapeHtml(data)}</a>`
                                : WCA.escapeHtml(data); // miss, plain text, never a dead link
                        }
                        if (c.isLinked) return WCA.renderCell(c.key, data);
                        return (data === null || data === undefined || data === "") ? "-" : WCA.escapeHtml(data);
                    }
                    if (dtType === "sort" || dtType === "type") {
                        return (c.isLinked || c.isDateLink) ? String(data || "") : sortValue(c.key, data);
                    }
                    return data;
                },
            })),
            paging: !opts.compact,
            ordering: !opts.compact2col,
            searching: true, // must stay on even in compact mode, it gates the whole
                              // custom-filter pipeline (Format/Season/threshold), not just
                              // the visible search box, which is hidden via the dom string instead
            info: !opts.compact,
            pageLength: pageLength,
            lengthMenu: [25, 50, 100, 500],
            order: (() => {
                if (!opts.defaultSort) return [];
                const idx = cols.findIndex(c => c.key === opts.defaultSort.col);
                return idx === -1 ? [] : [[idx, opts.defaultSort.dir || "desc"]];
            })(),
            dom: dtDom,
            language: {
                // Default DataTables behaviour appends "(filtered from N
                // total entries)" whenever a filter reduces the row count;
                // that's an internal detail (how big the raw dataset is
                // before filtering), not something a visitor needs to know.
                infoFiltered: "",
            },
        });

        // Only show pagination controls once there's genuinely more than one
        // page of DISPLAYED data - not raw dataset size (a "top 25 per
        // Format/Season/Tier" record file can easily total more than 25 rows
        // across every combination stacked together, even though the default
        // OVERALL filter only ever shows <=25 at once). Recalculated on
        // every draw, so switching to a filter combination that genuinely
        // has more rows (or fewer) correctly shows/hides pagination to match
        // what's actually on screen, not what's sitting in memory.
        function updatePaginationVisibility() {
            const info = dt.page.info();
            const wrapper = container.querySelector(".dataTables_paginate");
            if (wrapper) wrapper.style.display = info.recordsDisplay > info.length ? "" : "none";
        }
        dt.on("draw", updatePaginationVisibility);
        updatePaginationVisibility(); // reflect the constructor's own initial draw, which happened before this listener existed

        // wire Format/Season/Tier dropdowns to DataTables' column search (against the
        // underlying row data, even though the column itself may be hidden)
        filterDefs.forEach(f => {
            const select = container.querySelector(`.wca-filter-select[data-col-key="${f.key}"]`);
            select.addEventListener("change", applyCustomFilter);
        });

        // numeric threshold filter, plugged into DataTables' custom search API
        const thresholdColSel = document.getElementById(`${tableId}ThresholdCol`);
        const thresholdValInput = document.getElementById(`${tableId}ThresholdVal`);
        if (thresholdColSel) thresholdColSel.addEventListener("change", applyCustomFilter);
        if (thresholdValInput) thresholdValInput.addEventListener("keyup", applyCustomFilter);

        const customFilterFn = function (settings, searchData, dataIndex, rowData) {
            if (settings.nTable !== dt.table().node()) return true; // don't affect other tables on the page
            for (const f of filterDefs) {
                const select = container.querySelector(`.wca-filter-select[data-col-key="${f.key}"]`);
                if (select && select.value && rowData[f.key] !== select.value) return false;
            }
            if (thresholdColSel && thresholdColSel.value && thresholdValInput.value !== "") {
                const min = parseFloat(thresholdValInput.value);
                const raw = rowData[thresholdColSel.value];
                const val = sortValue(thresholdColSel.value, raw);
                if (typeof val !== "number" || isNaN(min) || val < min) return false;
            }
            return true;
        };
        $.fn.dataTable.ext.search.push(customFilterFn);

        // The initial draw during $().DataTable() above ran BEFORE this
        // search function existed, so it always showed every row regardless
        // of any pre-selected filter value (e.g. defaultToOverall). Redraw
        // once now that the search function is actually registered.
        dt.draw();

        function applyCustomFilter() { dt.draw(); }

        // clean up this table's custom search function when the container is
        // re-rendered (caller calls render() again), otherwise filters from
        // stale tables silently keep affecting new ones.
        dt.on("destroy", () => {
            const i = $.fn.dataTable.ext.search.indexOf(customFilterFn);
            if (i !== -1) $.fn.dataTable.ext.search.splice(i, 1);
        });

        containerTables.set(container, dt);

        return dt;
    }

    /** Strip a key from every row, used to drop a redundant Format column once a table's already been filtered/split by format. */
    function omitKey(rows, key) {
        return rows.map(r => {
            const copy = { ...r };
            delete copy[key];
            return copy;
        });
    }

    /**
     * A table that defaults to showing only Format: "List A" rows, with a
     * small toggle to switch format if more than one is present in the
     * data, used anywhere a table would otherwise be cluttered by showing
     * every format's rows interleaved (opposition/venue breakdowns, team
     * leaderboards). For tables with few enough rows that seeing every
     * format side-by-side is actually useful (e.g. a 2-row "career span"
     * table), render with { showStampColumns: true, noFilters: true }
     * instead, this helper is for the "too many rows to interleave" case.
     *
     * @param {HTMLElement} container
     * @param {string|null} title - subtable heading, or null for none
     * @param {Array<Object>} rows - must include a "Format" key
     * @param {Object} [tableOpts] - forwarded to render() for the inner table (e.g. compact)
     */
    function renderFormatToggleTable(container, title, rows, tableOpts = {}) {
        if (!rows || !rows.length) return;
        const formats = Array.from(new Set(rows.map(r => r.Format).filter(Boolean)));

        if (title) {
            const heading = document.createElement("div");
            heading.className = "wca-subtable-title";
            heading.textContent = title;
            container.appendChild(heading);
        }

        if (formats.length <= 1) {
            const tableRoot = document.createElement("div");
            container.appendChild(tableRoot);
            render(tableRoot, formats.length ? omitKey(rows, "Format") : rows, tableOpts);
            return;
        }

        let current = formats.includes("List A") ? "List A" : formats[0];

        const toggle = document.createElement("div");
        toggle.className = "wca-format-toggle";
        formats.forEach(fmt => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = fmt;
            btn.className = fmt === current ? "active" : "";
            btn.addEventListener("click", () => {
                current = fmt;
                [...toggle.children].forEach(b => b.classList.toggle("active", b === btn));
                draw();
            });
            toggle.appendChild(btn);
        });
        container.appendChild(toggle);

        const tableRoot = document.createElement("div");
        container.appendChild(tableRoot);

        function draw() {
            render(tableRoot, omitKey(rows.filter(r => r.Format === current), "Format"), tableOpts);
        }
        draw();
    }

    /**
     * Splits rows into one table per distinct value of splitKey (e.g. "Most
     * Runs" / "Most Wickets" / "Most Catches" all interleaved under one
     * "Type" or "Record" column), each resulting table also gets the
     * List-A-default format toggle via renderFormatToggleTable, since a
     * record type can still span multiple formats within its own group.
     * Use this for any section where a column names WHICH record a row
     * belongs to, rather than every row being the same kind of thing.
     *
     * @param {HTMLElement} container
     * @param {Array<Object>} rows
     * @param {string} splitKey - column name identifying which record type a row is (e.g. "Record", "Type")
     * @param {Object} [tableOpts] - forwarded to the inner table render (e.g. compact)
     */
    // Preferred lead-in order for record-type groups, batting, bowling,
    // fielding, general, roughly. Anything not in this list falls back to
    // alphabetical, after the prioritized ones.
    const GROUP_PRIORITY = ["Most Runs", "Most Wickets", "Most Catches", "Most Matches"];

    function renderRecordGroups(container, rows, splitKey, tableOpts = {}) {
        if (!rows || !rows.length) return;
        const groups = Array.from(new Set(rows.map(r => r[splitKey]).filter(Boolean)));
        groups.sort((a, b) => {
            const ia = GROUP_PRIORITY.indexOf(a);
            const ib = GROUP_PRIORITY.indexOf(b);
            if (ia !== -1 || ib !== -1) {
                if (ia === -1) return 1;
                if (ib === -1) return -1;
                return ia - ib;
            }
            return a.localeCompare(b);
        });
        groups.forEach(groupVal => {
            const subset = omitKey(rows.filter(r => r[splitKey] === groupVal), splitKey);
            renderFormatToggleTable(container, groupVal, subset, tableOpts);
        });
    }

    return { render, columnsFromRows, sortValue, omitKey, renderFormatToggleTable, renderRecordGroups };
})();
