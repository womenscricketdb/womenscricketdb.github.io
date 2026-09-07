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
    // wickets-only column, worse than not offering it at all. Date is here
    // for a different reason: it's stored as a plain numeric serial value,
    // so it clears the >80%-numeric bar in numericMetrics() easily, but
    // it's an identifier/axis-role column (what a row happened *on*), not
    // a stat that's meaningful to plot on the Y-axis.
    const EXCLUDE_METRICS = new Set(["Season", "Format", "Teams", "BBI", "Date"]);

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

    /**
     * beginAtZero (true): leave min/max undefined and let Chart.js's own
     * beginAtZero handle it, unchanged from before this toggle existed.
     * beginAtZero (false): zoom to the data's own range so genuine swings
     * are visible, but with padding -- zooming to the exact min/max would
     * put the highest and lowest points right on the plot's edge, easy to
     * misread as "still rising/falling" when the line simply ran out of
     * room. 15% of the data's own range on each side; a flat/near-flat
     * series (range near 0) falls back to a small fixed pad instead of
     * padding-of-nothing collapsing back to a zero-height range.
     */
    function computeYRange(dataPoints, beginAtZero) {
        if (beginAtZero) return { min: undefined, max: undefined };
        const nums = dataPoints.filter(v => v !== null && v !== undefined && !isNaN(v));
        if (!nums.length) return { min: undefined, max: undefined };
        const dataMin = Math.min(...nums);
        const dataMax = Math.max(...nums);
        const range = dataMax - dataMin;
        const pad = range > 0 ? range * 0.15 : Math.max(Math.abs(dataMax) * 0.1, 1);
        return { min: dataMin - pad, max: dataMax + pad };
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
        let beginAtZero = true;

        const pickerRow = document.createElement("div");
        pickerRow.className = "wca-chart-metric-picker";

        if (metrics.length > 1) {
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
        }

        // Zero-axis toggle - independent of how many metrics exist, so it
        // shows even for a single-metric chart. Checked (the default)
        // matches every chart's behavior before this toggle existed;
        // unchecked zooms to the data's own (padded) range, which is what
        // actually surfaces a real swing that's small relative to the
        // metric's own scale (e.g. bowling average 16.5->19) rather than
        // letting it get visually absorbed by a fixed 0-based axis.
        const zeroWrap = document.createElement("div");
        zeroWrap.className = "wca-chart-zero-toggle form-check form-check-sm";
        const zeroCheckbox = document.createElement("input");
        zeroCheckbox.type = "checkbox";
        zeroCheckbox.className = "form-check-input";
        const zeroId = `wcaChartZero${Math.random().toString(36).slice(2, 8)}`;
        zeroCheckbox.id = zeroId;
        zeroCheckbox.checked = true;
        const zeroLabel = document.createElement("label");
        zeroLabel.className = "form-check-label";
        zeroLabel.setAttribute("for", zeroId);
        zeroLabel.textContent = "Start axis at zero";
        zeroCheckbox.addEventListener("change", () => {
            beginAtZero = zeroCheckbox.checked;
            draw();
        });
        zeroWrap.appendChild(zeroCheckbox);
        zeroWrap.appendChild(zeroLabel);
        pickerRow.appendChild(zeroWrap);

        wrap.appendChild(pickerRow);

        // Last-N-innings window - only offered when it would actually
        // trim something (a preset >= total row count is pointless, and
        // on a short career every preset might be). "All" only appears
        // alongside at least one real preset, so a chart with too few
        // rows for any preset to matter shows no window controls at all,
        // same as the metric picker being skipped for a single-metric
        // chart above.
        const WINDOW_PRESETS = [10, 20, 30];
        const availablePresets = WINDOW_PRESETS.filter(n => rows.length > n);
        let windowSize = null; // null = All rows

        if (availablePresets.length) {
            const windowRow = document.createElement("div");
            // Reuses wca-chart-metric-picker for the label+row layout
            // (same flex/gap/label styling as the Metric row above) and
            // wca-format-toggle for the buttons themselves - the exact
            // class the List A/T20/Overall switch already uses, so this
            // reads as the same control rather than a one-off that
            // doesn't quite match anything else on the page.
            windowRow.className = "wca-chart-metric-picker";

            const windowLabel = document.createElement("label");
            // Generic against whatever xKey this chart was given, same
            // reasoning as the tooltip title callback below - "Innings"
            // on the Career Prog chart, "Season" here, rather than a
            // label hardcoded for one specific chart.
            windowLabel.textContent = WCA.friendlyLabel(xKey);
            windowRow.appendChild(windowLabel);

            const windowToggle = document.createElement("div");
            windowToggle.className = "wca-format-toggle";

            function makeWindowButton(label, size) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.textContent = label;
                btn.className = size === windowSize ? "active" : "";
                btn.addEventListener("click", () => {
                    windowSize = size;
                    [...windowToggle.children].forEach(b => b.classList.toggle("active", b === btn));
                    draw();
                });
                windowToggle.appendChild(btn);
                return btn;
            }

            makeWindowButton("All", null);
            availablePresets.forEach(n => makeWindowButton(`Last ${n}`, n));

            windowRow.appendChild(windowToggle);
            wrap.appendChild(windowRow);
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

    /**
     * When "start axis at zero" is on, Chart.js's own beginAtZero handles
     * everything and no explicit min/max is needed. Off, the axis zooms
     * to the data's own range so a real swing that's small relative to
     * the metric's overall scale (bowling average 16.5->19, say) is
     * actually visible rather than getting visually absorbed by a fixed
     * 0-based scale -- but padded by 10% of the range (or a flat +/-1 if
     * every visible point happens to be identical, so the line isn't
     * drawn as a single edge-to-edge flat stroke) so points don't sit
     * flush against the plot's top/bottom edges. Floored at 0 regardless
     * of padding, since none of the metrics charted here (Runs, Wickets,
     * Average, etc.) are ever meaningfully negative.
     */
    function yAxisRange(dataPoints, beginAtZero) {
        if (beginAtZero) return { beginAtZero: true, min: undefined, max: undefined };
        const finite = dataPoints.filter(v => v !== null && v !== undefined && !isNaN(v));
        if (!finite.length) return { beginAtZero: true, min: undefined, max: undefined };
        const dataMin = Math.min(...finite);
        const dataMax = Math.max(...finite);
        const range = dataMax - dataMin;
        const pad = range > 0 ? range * 0.1 : Math.max(Math.abs(dataMax) * 0.1, 1);
        return {
            beginAtZero: false,
            min: Math.max(0, dataMin - pad),
            max: dataMax + pad,
        };
    }

    function draw() {
            const sourceRows = windowSize ? rows.slice(-windowSize) : rows;
            const filled = fillSeasonGaps(sourceRows, xKey);
            const labels = filled.map(r => r[xKey]);
            const dataPoints = filled.map(r => parseMetricValue(r[currentMetric]));
            const metricLabel = WCA.friendlyLabel(currentMetric);
            const yRange = yAxisRange(dataPoints, beginAtZero);

            if (chart) {
                // Same canvas, new metric - update in place rather than
                // destroy/recreate, avoids a "Canvas is already in use"
                // Chart.js error and is cheaper than a full re-init.
                chart.data.labels = labels;
                chart.data.datasets[0].data = dataPoints;
                chart.data.datasets[0].label = metricLabel;
                chart.options.scales.y.title.text = metricLabel;
                chart.options.scales.y.beginAtZero = yRange.beginAtZero;
                chart.options.scales.y.min = yRange.min;
                chart.options.scales.y.max = yRange.max;
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
                        // Straight segments, not a smoothed Bezier curve.
                        // These are discrete per-innings/per-season points
                        // with nothing real interpolated between them, and
                        // several of the metrics charted here (career
                        // running Average especially) are already smooth
                        // by construction -- curve smoothing on top of that
                        // doesn't reduce noise, it just visually flattens
                        // genuine sharp swings (e.g. a real run of poor
                        // form dragging a cumulative average up quickly)
                        // into a gentle-looking curve that understates them.
                        tension: 0,
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
                            // Generic against whatever xKey this chart was
                            // given - "Season 15/16" here, "Innings 52" on
                            // the Career Prog chart, rather than a Season
                            // label hardcoded onto every chart regardless
                            // of what's actually being plotted.
                            callbacks: { title: items => `${WCA.friendlyLabel(xKey)} ${items[0].label}` },
                        },
                    },
                    scales: {
                        x: {
                            grid: { color: border },
                            ticks: { color: textDim },
                        },
                        y: {
                            beginAtZero: yRange.beginAtZero,
                            min: yRange.min,
                            max: yRange.max,
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
