/**
 * venue-map.js
 * -----------------------------------------------------------------------
 * Plots one marker per CITY (not per venue) over the same CricketUnions.geojson
 * used by union-map.js, so multiple venues sharing a town's coordinates don't
 * just silently overwrite each other. Clicking a single-venue city goes
 * straight to that venue's page; clicking a multi-venue city opens a small
 * inline popover listing every ground there.
 * -----------------------------------------------------------------------
 */

let _venueGeoDataPromise = null;
function loadVenueGeoData(geojsonUrl) {
    if (!_venueGeoDataPromise) {
        _venueGeoDataPromise = fetch(geojsonUrl).then((r) => {
            if (!r.ok) throw new Error(`Failed to load ${geojsonUrl}: ${r.status}`);
            return r.json();
        });
    }
    return _venueGeoDataPromise;
}

function groupVenuesByCity(venues) {
    const groups = new Map();
    venues.forEach((v) => {
        if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) return;
        const key = v.city ? v.city.trim() : `${v.lat},${v.lng}`;
        if (!groups.has(key)) {
            groups.set(key, { city: v.city || v.name, lat: v.lat, lng: v.lng, venues: [], homeTeams: {} });
        }
        const group = groups.get(key);
        group.venues.push(v.name);
        if (v.homeTeams && v.homeTeams.length) group.homeTeams[v.name] = v.homeTeams;
    });
    return Array.from(groups.values());
}

/**
 * Greedy screen-space clustering, run AFTER projection (threshold is in
 * pixels, not lat/lng degrees - the point is "do these look too close
 * together on screen", which varies with projection scale). Chains
 * transitively (A close to B, B close to C merges all three, even if A-C
 * alone exceeds the threshold). Only called when clustering is enabled;
 * homeTeams from every merged city are unioned together, so a cluster
 * containing any team's home ground still renders white, same meaning as
 * it has today for a single city.
 *
 * Distance alone isn't enough, though: Johannesburg and Pretoria sit close
 * together on a country-wide map, but they're genuinely distinct cities in
 * different cricket unions (Lions vs Titans) - merging them would actively
 * mislead, not just look slightly imprecise. So two cities only merge if
 * they resolve to the SAME union (via unionId, precomputed per group before
 * this function is called) - a real geographic/administrative boundary,
 * not an arbitrary threshold tweak. Groups with no resolvable union
 * (unionId null - shouldn't normally happen, but data can be messy) are
 * still allowed to cluster with each other, since we have no basis to say
 * they're definitely different places.
 */
function clusterNearbyGroups(projectedGroups, thresholdPx) {
    const used = new Array(projectedGroups.length).fill(false);
    const clusters = [];

    for (let i = 0; i < projectedGroups.length; i++) {
        if (used[i]) continue;
        const members = [projectedGroups[i]];
        used[i] = true;
        let grew = true;
        while (grew) {
            grew = false;
            for (let j = 0; j < projectedGroups.length; j++) {
                if (used[j]) continue;
                const closeToGroup = members.some(m => {
                    const sameUnion = m.unionId == null || projectedGroups[j].unionId == null
                        || m.unionId === projectedGroups[j].unionId;
                    if (!sameUnion) return false;
                    return Math.hypot(m.x - projectedGroups[j].x, m.y - projectedGroups[j].y) <= thresholdPx;
                });
                if (closeToGroup) {
                    members.push(projectedGroups[j]);
                    used[j] = true;
                    grew = true;
                }
            }
        }

        const homeTeams = {};
        members.forEach(m => Object.assign(homeTeams, m.homeTeams));

        clusters.push({
            cities: members.map(m => m.cities[0]),
            venues: members.flatMap(m => m.venues),
            venuesByCity: members.flatMap(m => m.venues.map(name => ({ name, city: m.cities[0] }))),
            homeTeams,
            x: members.reduce((s, m) => s + m.x, 0) / members.length,
            y: members.reduce((s, m) => s + m.y, 0) / members.length,
        });
    }
    return clusters;
}

/** Which union polygon (if any) a [lng,lat] point falls inside, using the
 * same CricketUnions.geojson already loaded for the background shading -
 * no new data needed. Returns null if the point doesn't resolve to any
 * union (e.g. missing coords, or genuinely outside all boundaries). */
function unionForPoint(lng, lat, geoFeatures) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    const hit = geoFeatures.find(f => d3.geoContains(f, [lng, lat]));
    return hit ? hit.properties.Union : null;
}

/**
 * @param {string|HTMLElement} container
 * @param {Array<{name:string, lat:number, lng:number, city?:string, homeTeams?:string[]}>} venues
 *   homeTeams, if present and non-empty, marks this venue as a team's home
 *   ground: its dot renders white instead of gold, and its link inside a
 *   multi-venue popover renders white too, so it stands out from the other
 *   grounds in that city rather than needing a separate legend.
 * @param {object} options
 *   geojsonUrl   path to CricketUnions.geojson
 *   width,height viewBox size (default 760x760)
 *   linkFn(venueName) -> href, used to build links for both direct nav and the popover list
 */
function renderVenueMap(container, venues, options = {}) {
    const {
        geojsonUrl = "assets/geo/CricketUnions.geojson",
        width = 760,
        height = 760,
        linkFn = null,
        clustered = false,   // opt-in - false preserves the exact one-dot-per-city behavior this always had
        clusterPx = 16,      // screen-space distance (post-projection) below which nearby cities merge into one dot
    } = options;

    const root = typeof container === "string" ? document.querySelector(container) : container;
    root.innerHTML = "";
    root.classList.add("venue-map-root");

    const wrapper = d3.select(root).style("position", "relative");

    const svg = wrapper
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("width", "100%")
        .attr("height", "auto")
        .style("display", "block")
        .style("font-family", "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif");

    const tooltip = wrapper
        .append("div")
        .attr("class", "venue-map-tooltip")
        .style("position", "absolute")
        .style("pointer-events", "none")
        .style("opacity", 0)
        .style("background", "rgba(20, 20, 20, 0.92)")
        .style("color", "#fff")
        .style("padding", "5px 10px")
        .style("border-radius", "4px")
        .style("font-size", "13px")
        .style("font-weight", "600")
        .style("white-space", "nowrap")
        .style("transition", "opacity 120ms ease")
        .style("z-index", 10);

    const popover = wrapper
        .append("div")
        .attr("class", "venue-map-popover")
        .style("position", "absolute")
        .style("display", "none")
        .style("background", "#1e1e1e")
        .style("border", "1px solid rgba(255,255,255,0.15)")
        .style("border-radius", "6px")
        .style("padding", "8px 10px")
        .style("min-width", "160px")
        .style("box-shadow", "0 6px 18px rgba(0,0,0,0.5)")
        .style("z-index", 20);

    function closePopover() { popover.style("display", "none"); }
    document.addEventListener("click", (e) => {
        if (!root.contains(e.target)) closePopover();
    });

    loadVenueGeoData(geojsonUrl).then((geo) => {
        const projection = d3.geoMercator().fitSize([width, height], geo);
        const path = d3.geoPath(projection);

        svg
            .selectAll("path.union-bg")
            .data(geo.features)
            .join("path")
            .attr("class", "union-bg")
            .attr("d", path)
            .attr("fill", "#232323")
            .attr("stroke", "#3a3a3a")
            .attr("stroke-width", 1)
            // Clicking empty map background (not a marker) should close
            // whatever's open, same as clicking outside the whole widget,
            // rather than silently doing nothing.
            .on("click", () => { closePopover(); disarm(); });

        // Always project city groups to screen coords first - the unclustered
        // path uses them as-is (one dot per city, identical to before this
        // change), the clustered path feeds them through clusterNearbyGroups.
        // Normalizing both to the same shape (x, y, cities[], venues[],
        // venuesByCity[], homeTeams, unionId) means everything downstream
        // (hit targets, dots, tooltip, popover) never has to branch on
        // clustered vs not.
        const cityGroups = groupVenuesByCity(venues).map((g) => {
            const [x, y] = projection([g.lng, g.lat]);
            return {
                x, y,
                cities: [g.city],
                venues: g.venues,
                venuesByCity: g.venues.map(name => ({ name, city: g.city })),
                homeTeams: g.homeTeams,
                unionId: unionForPoint(g.lng, g.lat, geo.features),
            };
        });
        const dots = clustered ? clusterNearbyGroups(cityGroups, clusterPx) : cityGroups;

        // Real mouse hover lets you preview a dot before committing (move
        // off if it's the wrong one); touch has no hover at all, so a tap
        // there goes straight to navigation with no way to check first.
        // That's worse specifically where dots sit close together, tapping
        // the wrong neighbour in a cluster is an instant, hard-to-undo
        // mistake. Fix: on devices with no real hover, the first tap on a
        // dot only shows its label (armed); a second tap on that same
        // (already-armed) dot is what actually navigates/opens the list.
        // Tapping elsewhere disarms it. Mouse users are unaffected, their
        // hover already previews before the click commits.
        const noHover = window.matchMedia("(hover: none)").matches;
        let armedCity = null;

        function disarm() {
            armedCity = null;
            tooltip.style("opacity", 0);
        }
        document.addEventListener("click", (e) => {
            if (!root.contains(e.target)) disarm();
        });

        function showTooltipFor(event, d) {
            const label = d.cities.length > 1
                ? `${d.cities.length} towns, ${d.venues.length} grounds`
                : (d.venues.length > 1 ? `${d.cities[0]} (${d.venues.length} grounds)` : d.venues[0]);
            tooltip.style("opacity", 1).text(label);
            const [x, y] = d3.pointer(event, root);
            tooltip.style("left", `${x + 14}px`).style("top", `${y + 6}px`);
        }

        function commit(event, d) {
            tooltip.style("opacity", 0);
            armedCity = null;

            if (d.venues.length === 1) {
                if (linkFn) window.location.href = linkFn(d.venues[0]);
                return;
            }

            const [x, y] = d3.pointer(event, root);
            const listHtml = d.cities.length > 1
                // Cluster spans more than one town - group venues under a
                // small city sub-header each, so it's clear this dot isn't
                // just one busy town. isHome styling (white/bold) is
                // preserved exactly as the single-city case below.
                ? d.cities.map(city => `
                    <div style="font-family: var(--wca-font-body, sans-serif); font-size: 12px; color: #9c9c9c; margin: 6px 0 2px;">${city}</div>
                    ${d.venuesByCity.filter(v => v.city === city).map(v => {
                        const isHome = !!d.homeTeams[v.name];
                        return `<a href="${linkFn ? linkFn(v.name) : "#"}" style="display:block; padding:3px 0; color:${isHome ? "#ffffff" : "#ffc107"}; font-family: var(--wca-font-body, sans-serif); font-size: 13px; text-decoration:none; font-weight:${isHome ? "700" : "400"};">${v.name}</a>`;
                    }).join("")}
                `).join("")
                // Single city, multiple grounds - unchanged from before.
                : `
                    <div style="font-family: var(--wca-font-body, sans-serif); font-size: 12px; color: #9c9c9c; margin-bottom: 4px;">${d.cities[0]}</div>
                    ${d.venues.map(name => {
                        const isHome = !!d.homeTeams[name];
                        return `<a href="${linkFn ? linkFn(name) : "#"}" style="display:block; padding:3px 0; color:${isHome ? "#ffffff" : "#ffc107"}; font-family: var(--wca-font-body, sans-serif); font-size: 13px; text-decoration:none; font-weight:${isHome ? "700" : "400"};">${name}</a>`;
                    }).join("")}
                `;
            popover.html(listHtml);
            popover.style("left", `${x + 14}px`).style("top", `${y + 6}px`).style("display", "block");
        }

        // Invisible larger hit target, same position as the visible dot,
        // just bigger, so an imprecise click/tap in a tight cluster is
        // more likely to land on the intended city rather than a neighbour.
        svg
            .selectAll("circle.venue-hit")
            .data(dots)
            .join("circle")
            .attr("class", "venue-hit")
            .attr("cx", (d) => d.x)
            .attr("cy", (d) => d.y)
            .attr("r", 11)
            .attr("fill", "transparent")
            .style("cursor", "pointer")
            .on("mouseenter", function (event, d) {
                if (noHover) return;
                svg.selectAll("circle.venue-dot").filter(dd => dd === d)
                    .attr("r", (d.venues.length > 1 ? 9 : 7));
                showTooltipFor(event, d);
            })
            .on("mousemove", (event, d) => {
                if (noHover) return;
                showTooltipFor(event, d);
            })
            .on("mouseleave", function (event, d) {
                if (noHover) return;
                svg.selectAll("circle.venue-dot").filter(dd => dd === d)
                    .attr("r", (d.venues.length > 1 ? 6.5 : 4.5));
                tooltip.style("opacity", 0);
            })
            .on("click", function (event, d) {
                event.stopPropagation();
                if (noHover) {
                    if (armedCity !== d) {
                        armedCity = d;
                        showTooltipFor(event, d);
                        return;
                    }
                }
                commit(event, d);
            });

        svg
            .selectAll("circle.venue-dot")
            .data(dots)
            .join("circle")
            .attr("class", "venue-dot")
            .attr("cx", (d) => d.x)
            .attr("cy", (d) => d.y)
            .attr("r", (d) => (d.venues.length > 1 ? 6.5 : 4.5))
            .attr("fill", (d) => Object.keys(d.homeTeams).length ? "#ffffff" : "#ffc107")
            .attr("stroke", "#101010")
            .attr("stroke-width", 1)
            .style("pointer-events", "none")
            .style("transition", "r 120ms ease");
    });
}

if (typeof window !== "undefined") {
    window.renderVenueMap = renderVenueMap;
}
