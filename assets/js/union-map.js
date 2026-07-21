/**
 * union-map.js
 * -----------------------------------------------------------------------
 * Reusable D3 component for the SA women's cricket provincial union map.
 * Built on CricketUnions.geojson (16 dissolved union boundaries, WGS84).
 *
 * Two entry points:
 *
 *   renderUnionMap(container, options)
 *     Full interactive country map. Hover shows the union name, click
 *     navigates to that union's team page.
 *
 *   renderUnionHighlight(container, unionName, options)
 *     Small static "pedigree" map for a single team page: whole country
 *     in muted grey, target union picked out in its official colour.
 *
 * Both share the same projection fit to the same GeoJSON, so a team's
 * highlighted shape is always at the same scale/position whether it's
 * shown on the full map or on its own team page.
 * -----------------------------------------------------------------------
 */

// Official union colours (from UnionColours.txt)
const UNION_COLORS = {
  Boland: "#E0B223",
  Iinyathi: "#90140A",
  EP: "#BAD22E",
  Eastern: "#010E45",
  Knights: "#F68634",
  Badgers: "#007918",
  Lions: "#F5BB1C",
  Kei: "#9EC6EB",
  Dolphins: "#019154",
  Tuskers: "#A0A0A0",
  Impalas: "#2A2F71",
  Rhinos: "#0064AA",
  Dragons: "#611927",
  Heat: "#064974",
  WP: "#072E65",
  Titans: "#6DBEEE",
};

// Real team-page links, built from the site's UNION_TO_TEAM_NAME table
// (assets/js/union-team-mapping.js, loaded before this file) rather than
// hardcoded per-union paths.
const UNION_PAGE_URLS = Object.fromEntries(
  Object.keys(UNION_COLORS).map((union) => {
    const teamName = (typeof UNION_TO_TEAM_NAME !== "undefined" && UNION_TO_TEAM_NAME[union]) || union;
    return [union, `team.html?name=${encodeURIComponent(teamName)}`];
  })
);

// Cache the parsed GeoJSON + a projection fitted once to its full extent,
// so every map (full or mini) lines up identically.
let _geoDataPromise = null;
function loadGeoData(geojsonUrl) {
  if (!_geoDataPromise) {
    _geoDataPromise = fetch(geojsonUrl).then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${geojsonUrl}: ${r.status}`);
      return r.json();
    });
  }
  return _geoDataPromise;
}

function darken(hex, amount = 0.18) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) * (1 - amount));
  const g = Math.max(0, ((n >> 8) & 255) * (1 - amount));
  const b = Math.max(0, (n & 255) * (1 - amount));
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}

/**
 * Full interactive clickable map.
 *
 * @param {string|HTMLElement} container  CSS selector or element to render into.
 * @param {object} options
 *   geojsonUrl   path to CricketUnions.geojson (default "CricketUnions.geojson")
 *   width,height viewBox size (default 760x760, scales responsively via CSS)
 *   onSelect(unionName)  called on click instead of navigating, if provided
 */
function renderUnionMap(container, options = {}) {
  const {
    geojsonUrl = "CricketUnions.geojson",
    width = 760,
    height = 760,
    onSelect = null,
  } = options;

  const root =
    typeof container === "string" ? document.querySelector(container) : container;
  root.innerHTML = "";
  root.classList.add("union-map-root");

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
    .attr("class", "union-map-tooltip")
    .style("position", "absolute")
    .style("pointer-events", "none")
    .style("opacity", 0)
    .style("background", "rgba(20, 20, 20, 0.92)")
    .style("color", "#fff")
    .style("padding", "5px 10px")
    .style("border-radius", "4px")
    .style("font-size", "13px")
    .style("font-weight", "600")
    .style("letter-spacing", "0.01em")
    .style("transition", "opacity 120ms ease")
    .style("white-space", "nowrap")
    .style("z-index", 10);

  loadGeoData(geojsonUrl).then((geo) => {
    const projection = d3.geoMercator().fitSize([width, height], geo);
    const path = d3.geoPath(projection);

    // Same touch/hover gap as venue-map.js: a mouse can hover a union to
    // see its name before clicking, touch has no hover at all. Here that's
    // more consequential than usual because each union is a real <a href>,
    // so an unmodified tap would navigate immediately, not just "click".
    // On no-hover devices, the first tap previews (and suppresses the
    // navigation); a second tap on that same, already-armed union commits.
    const noHover = window.matchMedia("(hover: none)").matches;
    let armedUnion = null;

    function unionLabel(d) {
      return (typeof UNION_TO_TEAM_NAME !== "undefined" && UNION_TO_TEAM_NAME[d.properties.Union]) || d.properties.Union;
    }

    document.addEventListener("click", (e) => {
      if (!root.contains(e.target)) {
        armedUnion = null;
        tooltip.style("opacity", 0);
      }
    });

    // Each union is a real SVG <a> wrapping its <path>, gives native browser
    // link behavior (cmd/ctrl-click opens a new tab, right-click "copy link",
    // status-bar URL preview, screen-reader announces it as a link) instead
    // of a JS-only click handler.
    const linkGroups = svg
      .selectAll("a.union-link")
      .data(geo.features)
      .join("a")
      .attr("class", "union-link")
      .attr("xlink:href", (d) =>
        onSelect ? null : UNION_PAGE_URLS[d.properties.Union] || null
      )
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        if (noHover && armedUnion !== d) {
          event.preventDefault();
          armedUnion = d;
          tooltip.style("opacity", 1).text(unionLabel(d));
          const [x, y] = d3.pointer(event, root);
          tooltip.style("left", `${x + 14}px`).style("top", `${y + 6}px`);
          return;
        }
        armedUnion = null;
        tooltip.style("opacity", 0);

        // onSelect mode: caller handles routing themselves (e.g. client-side
        // router), so suppress the native href navigation.
        if (onSelect) {
          event.preventDefault();
          onSelect(d.properties.Union);
        }
      });

    linkGroups
      .append("path")
      .attr("class", "union-shape")
      .attr("d", path)
      .attr("fill", (d) => UNION_COLORS[d.properties.Union] || "#ccc")
      .attr("stroke", "#fbfbfb")
      .attr("stroke-width", 1.25)
      .style("transition", "fill 120ms ease, stroke-width 120ms ease")
      .on("mouseenter", function (event, d) {
        if (noHover) return;
        const base = UNION_COLORS[d.properties.Union] || "#ccc";
        d3.select(this).attr("fill", darken(base)).attr("stroke-width", 2);
        tooltip.style("opacity", 1).text(unionLabel(d));
      })
      .on("mousemove", (event) => {
        if (noHover) return;
        const [x, y] = d3.pointer(event, root);
        tooltip.style("left", `${x + 14}px`).style("top", `${y + 6}px`);
      })
      .on("mouseleave", function (event, d) {
        if (noHover) return;
        const base = UNION_COLORS[d.properties.Union] || "#ccc";
        d3.select(this).attr("fill", base).attr("stroke-width", 1.25);
        tooltip.style("opacity", 0);
      });
  });
}

// Unions whose territory is too small/crowded to read at full-country zoom
// get pinned to a fixed geographic quadrant instead, always a real,
// recognizable chunk of the country (actual coastline, actual neighbours),
// rather than a tight crop around just the shape itself which loses all
// sense of "where in the country is this". Everyone else gets the full map.
// Quadrants confirmed against each union's actual centroid.
const HIGHLIGHT_QUADRANT = {
  WP: "SW",
  Titans: "NE",
  Lions: "NE",
  Eastern: "NE",
};

let _countryBoundsCache = null;
function quadrantExtent(geo, quadrant) {
  if (!_countryBoundsCache) _countryBoundsCache = d3.geoBounds(geo);
  const [[minLon, minLat], [maxLon, maxLat]] = _countryBoundsCache;
  const midLon = (minLon + maxLon) / 2;
  const midLat = (minLat + maxLat) / 2;
  const lon0 = quadrant.includes("W") ? minLon : midLon;
  const lon1 = quadrant.includes("W") ? midLon : maxLon;
  const lat0 = quadrant.includes("S") ? minLat : midLat;
  const lat1 = quadrant.includes("S") ? midLat : maxLat;
  return { type: "Feature", geometry: { type: "MultiPoint", coordinates: [[lon0, lat0], [lon1, lat1]] } };
}

/**
 * Small static highlight map for a single team page.
 *
 * @param {string|HTMLElement} container
 * @param {string} unionName   must match a key in UNION_COLORS / the geojson's Union property
 * @param {object} options
 *   geojsonUrl   path to CricketUnions.geojson
 *   size         square viewBox size in px (default 220)
 */
function renderUnionHighlight(container, unionName, options = {}) {
  const { geojsonUrl = "CricketUnions.geojson", size = 220 } = options;

  // Accept either a raw union code ("WP") or the site's Team_Name ("Western
  // Province"), translate the latter down to the geojson's code.
  const resolvedUnion =
    (typeof TEAM_NAME_TO_UNION !== "undefined" && TEAM_NAME_TO_UNION[unionName]) || unionName;

  const root =
    typeof container === "string" ? document.querySelector(container) : container;
  root.innerHTML = "";

  const svg = d3
    .select(root)
    .append("svg")
    .attr("viewBox", `0 0 ${size} ${size}`)
    .attr("width", "100%")
    .attr("height", "auto")
    .style("display", "block");

  loadGeoData(geojsonUrl).then((geo) => {
    const quadrant = HIGHLIGHT_QUADRANT[resolvedUnion];
    const pad = size * 0.08;
    const projection = quadrant
      ? d3.geoMercator().fitExtent([[pad, pad], [size - pad, size - pad]], quadrantExtent(geo, quadrant))
      : d3.geoMercator().fitSize([size, size], geo);
    const path = d3.geoPath(projection);

    svg
      .selectAll("path")
      .data(geo.features)
      .join("path")
      .attr("d", path)
      .attr("fill", (d) =>
        d.properties.Union === resolvedUnion
          ? UNION_COLORS[resolvedUnion] || "#333"
          : "#e4e4e4"
      )
      .attr("stroke", "#fff")
      .attr("stroke-width", (d) => (d.properties.Union === resolvedUnion ? 1.5 : 1));
  });
}

/** Which union polygon (if any) a [lng,lat] point falls inside. Same idea
 * as venue-map.js's clustering fix (kept local here rather than a
 * cross-file dependency, since union-map.js is also used standalone on
 * team.html without venue-map.js loaded). */
function unionForGeoPoint(lng, lat, geoFeatures) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const hit = geoFeatures.find((f) => d3.geoContains(f, [lng, lat]));
  return hit ? hit.properties.Union : null;
}

/**
 * Small static "where in the country is this" map for a single venue page -
 * same shape as renderUnionHighlight (whole country muted, one union in its
 * official colour, same crowded-corner quadrant fix), plus a single marker
 * dropped at the venue's own coordinates. The venue's union is resolved
 * automatically via point-in-polygon rather than needing to be passed in -
 * venue data doesn't carry a Union field directly.
 *
 * @param {string|HTMLElement} container
 * @param {{lat:number,lng:number}} point   venue's own coordinates
 * @param {object} options
 *   geojsonUrl   path to CricketUnions.geojson
 *   size         square viewBox size in px (default 220)
 */
function renderVenueHighlight(container, point, options = {}) {
  const { geojsonUrl = "CricketUnions.geojson", size = 220 } = options;
  const { lat, lng } = point || {};

  const root =
    typeof container === "string" ? document.querySelector(container) : container;
  root.innerHTML = "";

  const svg = d3
    .select(root)
    .append("svg")
    .attr("viewBox", `0 0 ${size} ${size}`)
    .attr("width", "100%")
    .attr("height", "auto")
    .style("display", "block");

  loadGeoData(geojsonUrl).then((geo) => {
    const resolvedUnion = unionForGeoPoint(lng, lat, geo.features);

    // Same crowded-corner fix as renderUnionHighlight - if this venue's
    // union is one of the small/crowded ones, crop to a real geographic
    // quadrant rather than the whole country, so the highlighted shape
    // (and the marker inside it) is actually legible rather than a
    // pinprick in a tiny sliver.
    const quadrant = resolvedUnion ? HIGHLIGHT_QUADRANT[resolvedUnion] : null;
    const pad = size * 0.08;
    const projection = quadrant
      ? d3.geoMercator().fitExtent([[pad, pad], [size - pad, size - pad]], quadrantExtent(geo, quadrant))
      : d3.geoMercator().fitSize([size, size], geo);
    const path = d3.geoPath(projection);

    svg
      .selectAll("path")
      .data(geo.features)
      .join("path")
      .attr("d", path)
      .attr("fill", (d) =>
        d.properties.Union === resolvedUnion
          ? UNION_COLORS[resolvedUnion] || "#333"
          : "#e4e4e4"
      )
      .attr("stroke", "#fff")
      .attr("stroke-width", (d) => (d.properties.Union === resolvedUnion ? 1.5 : 1));

    // Coordinates missing/unresolved - still show the (unhighlighted,
    // full-country) map rather than nothing, just skip the marker itself,
    // same "genuinely nothing there" convention used elsewhere on the site.
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const [x, y] = projection([lng, lat]);
      svg
        .append("circle")
        .attr("cx", x)
        .attr("cy", y)
        .attr("r", 5)
        .attr("fill", "#ffc107")
        .attr("stroke", "#101010")
        .attr("stroke-width", 1.25);
    }
  });
}

// Expose globally for plain <script> usage; also fine to import as ES module.
if (typeof window !== "undefined") {
  window.renderUnionMap = renderUnionMap;
  window.renderUnionHighlight = renderUnionHighlight;
  window.renderVenueHighlight = renderVenueHighlight;
  window.UNION_COLORS = UNION_COLORS;
  window.UNION_PAGE_URLS = UNION_PAGE_URLS;
}
