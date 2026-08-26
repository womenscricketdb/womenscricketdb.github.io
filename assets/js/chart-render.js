/* ==========================================================================
   WCA Archive, shared chart renderer
   Draws a Chart.js line chart from the same rows-array shape table-render.js
   works with. Built specifically to plug into WCA_TABLE.renderChartableTable
   as its chartOpts.render callback:

       WCA_TABLE.renderChartableTable(container, title, rows, tableOpts, {
           render: (el, rows) => WCA_CHART.renderLineChart(el, rows, {
               xKey: "Season",
           }),
           minRows: 2,
       });

   table-render.js stays chart-library-agnostic on purpose (see its own
   comment on renderChartableTable) - this file is the other half of that
   split, and is the only place in the codebase that knows Chart.js exists.

   Numeric-metric detection deliberately does NOT reuse WCA_TABLE.sortValue:
   that function adds a small fudge factor to not-out scores ("78*" ->
   78.001) so DataTables sorts them fractionally above a plain "78" - exactly
   right for sort order, but wrong to feed into a chart, where the fudge
   would show up as a rounding artefact in a tooltip. parseMetricValue()
   below strips "*" cleanly instead, with no sort-only fudge attached.
   ========================================================================== */

const WCA_CHART = (() => {

    // Columns that are never sensible as a chart Y-axis, even though some
    // of them (BBI) can be partially parsed as a number - "3/24" parsing to
    // "3" via parseFloat would silently drop the runs half and look like a
    // wickets-only column, worse than not offering it at all.
    const EXCLUDE_METRICS = new Set(["Season", "Format", "Teams", "BBI"]);

    // Preferred first-shown metric per stat type, falls back to whatever
    // numeric column comes first in the data when none of these are present
    // (e.g. a page charting a stat this list doesn't know about yet).
    // Average leads because it's stable across a career regardless of how
    // much a player played that season - Runs/Wickets are raw season
    // totals, so a season with fewer matches (illness, a short tour squad,
    // early-career fringe selection) reads as a trough that's really just
    // "played less", not "played worse". Average isolates the latter.
    const PREFERRED_METRIC_ORDER = [
        "Average", "Runs", "Wickets", "Strike-Rate", "Economy",
        "Highest Score", "Innings", "Matches",
    ];

    function parseMetricValue(raw) {
        if (raw === null || raw === undefined) return null;
        const val = String(raw).trim();
        if (val === "" || val === "-") return null;
        const num = parseFloat(val.replace("*", "").replace(/,/g, ""));
        return isNaN(num) ? null : num;
    }

    /** Columns where every row parses as a number often enough to chart (>80% of non-blank values). */
    function numericMetrics(rows) {
        if (!rows || !rows.length) return [];
        const keys = Object.keys(rows[0]).filter(k => !EXCLUDE_METRICS.has(k));
        return keys.filter(k => {
            let numeric = 0, total = 0;
            for (const row of rows) {
                const v = row[k];
                if (v === null || v === undefined || v === "" || v === "-") continue;
                total += 1;
                if (parseMetricValue(v) !== null) numeric += 1;
            }
            return total > 0 && numeric / total > 0.8;
        });
    }

    function defaultMetric(metrics) {
        for (const preferred of PREFERRED_METRIC_ORDER) {
            if (metrics.includes(preferred)) return preferred;
        }
        return metrics[0];
    }

    function cssVar(name, fallback) {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
    }

    // Seasons in this dataset are always "YY/YY" pairs (05/06 ... 25/26,
    // no earlier ones exist - see build_player_season_stats() in
    // consolidate.py). Stepping through them as plain two-digit ints
    // (rather than tracking a real century) is the same simplification
    // the rest of the codebase already relies on for lexical Season
    // sorting - fine across the actual data range, and would only misbehave
    // exactly at a 99/00 -> 00/01 century wrap, which nothing here has
    // reached or is likely to for a while yet.
    function seasonToInt(season) {
        const m = /^(\d{2})\/(\d{2})$/.exec(String(season || ""));
        return m ? parseInt(m[1], 10) : null;
    }
    function intToSeason(n) {
        const start = ((n % 100) + 100) % 100;
        const pad = v => String(v).padStart(2, "0");
        return `${pad(start)}/${pad((start + 1) % 100)}`;
    }

    /**
     * A player's bySeason rows only exist for seasons she actually
     * qualified in (see the Innings>0 filter in consolidate.py) - which
     * means a plain plot of those rows, one point per row, silently
     * treats "16/17 next to 18/19" as adjacent, indistinguishable from a
     * real back-to-back 16/17-17/18. A gap from injury, unavailability,
     * or a format simply not being played that year would vanish rather
     * than show as a gap. This fills in every season between the first
     * and last one present (inclusive) with a placeholder row - real rows
     * pass through untouched, missing ones get null values everywhere
     * except the axis label - so the chart's spanGaps + segment styling
     * (see renderLineChart) can dash specifically the stretches of line
     * that cross one of these gaps, instead of drawing a smooth, solid
     * line straight through a season that didn't happen as if it were
     * adjacent to the ones either side of it.
     * Falls back to the rows as given, unchanged, if Season isn't in the
     * "YY/YY" shape this function knows how to step through (defensive -
     * this file is written to be reusable for a non-season X axis too).
     */
    function fillSeasonGaps(rows, xKey) {
        const ints = rows.map(r => seasonToInt(r[xKey]));
        if (ints.some(n => n === null)) return rows;
        const minN = Math.min(...ints), maxN = Math.max(...ints);
        const bySeason = new Map(rows.map(r => [r[xKey], r]));
        const filled = [];
        for (let n = minN; n <= maxN; n++) {
            const label = intToSeason(n);
            filled.push(bySeason.get(label) || { [xKey]: label });
        }
        return filled;
    }

    /**
     * @param {HTMLElement} container - cleared and populated fresh (a canvas
     *   plus, when there's more than one chartable column, a metric picker
     *   above it). Matches WCA_TABLE.render's own "caller doesn't need to
     *   manage lifecycle, container is rebuilt each call" contract.
     * @param {Array<Object>} rows - flat row objects, already filtered/sorted
     *   into the order they should appear left-to-right on the X axis (this
     *   function doesn't re-sort - season data is sorted chronologically
     *   ascending at the pipeline stage, and re-sorting here would just be
     *   re-deciding something already decided upstream).
     * @param {Object} [opts]
     * @param {string} [opts.xKey="Season"] - column used for X-axis labels.
     */
    function renderLineChart(container, rows, opts = {}) {
        const xKey = opts.xKey || "Season";
        container.innerHTML = "";

        const metrics = numericMetrics(rows).filter(k => k !== xKey);
        if (!rows.length || !metrics.length) {
            container.innerHTML = `<div class="wca-empty-state">Not enough numeric data to chart.</div>`;
            return;
        }

        const wrap = document.createElement("div");
        wrap.className = "wca-chart-wrap";

        let currentMetric = defaultMetric(metrics);

        if (metrics.length > 1) {
            const pickerRow = document.createElement("div");
            pickerRow.className = "wca-chart-metric-picker";

            const label = document.createElement("label");
            label.textContent = "Metric";
            const selectId = `wcaChartMetric${Math.random().toString(36).slice(2, 8)}`;
            label.setAttribute("for", selectId);

            const select = document.createElement("select");
            select.id = selectId;
            select.className = "form-select form-select-sm";
            metrics.forEach(m => {
                const opt = document.createElement("option");
                opt.value = m;
                opt.textContent = WCA.friendlyLabel(m);
                if (m === currentMetric) opt.selected = true;
                select.appendChild(opt);
            });
            select.addEventListener("change", () => {
                currentMetric = select.value;
                draw();
            });

            pickerRow.appendChild(label);
            pickerRow.appendChild(select);
            wrap.appendChild(pickerRow);
        }

        const canvasHolder = document.createElement("div");
        canvasHolder.className = "wca-chart-canvas-holder";
        const canvas = document.createElement("canvas");
        canvasHolder.appendChild(canvas);
        wrap.appendChild(canvasHolder);
        container.appendChild(wrap);

        const gold = cssVar("--wca-gold", "#ffc107");
        const textDim = cssVar("--wca-text-dim", "#9c9c9c");
        const border = cssVar("--wca-border", "rgba(255,255,255,0.08)");

        let chart = null;

        function draw() {
            const filled = fillSeasonGaps(rows, xKey);
            const labels = filled.map(r => r[xKey]);
            const dataPoints = filled.map(r => parseMetricValue(r[currentMetric]));
            const metricLabel = WCA.friendlyLabel(currentMetric);

            if (chart) {
                // Same canvas, new metric - update in place rather than
                // destroy/recreate, avoids a "Canvas is already in use"
                // Chart.js error and is cheaper than a full re-init.
                chart.data.labels = labels;
                chart.data.datasets[0].data = dataPoints;
                chart.data.datasets[0].label = metricLabel;
                chart.options.scales.y.title.text = metricLabel;
                chart.update();
                return;
            }

            chart = new Chart(canvas.getContext("2d"), {
                type: "line",
                data: {
                    labels,
                    datasets: [{
                        label: metricLabel,
                        data: dataPoints,
                        borderColor: gold,
                        backgroundColor: "rgba(255, 193, 7, 0.15)",
                        pointBackgroundColor: gold,
                        pointRadius: 3,
                        pointHoverRadius: 5,
                        borderWidth: 2,
                        tension: 0.25,
                        // Filled area under the line looked fine when gaps
                        // were bridged as a smooth hill across the whole
                        // width, but reads oddly once real gaps exist -
                        // there's no real "area under wickets-per-season"
                        // quantity being represented either way, so it's
                        // left off regardless of how the gaps themselves
                        // are drawn.
                        fill: false,
                        // spanGaps:true so a single continuous line still
                        // runs the full width - but see `segment` below,
                        // which dashes specifically the stretches that
                        // cross a missing season, so a real gap still
                        // reads as "this bit isn't real data", just without
                        // a jarring hard break in the line either.
                        spanGaps: true,
                        segment: {
                            borderDash: ctx => (ctx.p0.skip || ctx.p1.skip) ? [6, 6] : undefined,
                            borderColor: ctx => (ctx.p0.skip || ctx.p1.skip) ? "rgba(255, 193, 7, 0.45)" : undefined,
                        },
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: { title: items => `Season ${items[0].label}` },
                        },
                    },
                    scales: {
                        x: {
                            grid: { color: border },
                            ticks: { color: textDim },
                        },
                        y: {
                            beginAtZero: true,
                            grid: { color: border },
                            ticks: { color: textDim },
                            title: { display: true, text: metricLabel, color: textDim },
                        },
                    },
                },
            });
        }

        draw();
    }

    return { renderLineChart, parseMetricValue, numericMetrics };
})();
