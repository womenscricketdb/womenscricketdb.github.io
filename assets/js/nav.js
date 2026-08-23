/* ==========================================================================
   Shared header + nav, injected into <div id="wca-header-root">.
   Call WCA_NAV.render("archive") on each page, passing the key of the item
   that should show as active (or omit for none).
   ========================================================================== */

const WCA_NAV = (() => {

    // Cloudflare Web Analytics — loaded here once, rather than pasted into
    // every page, since every page already includes this script.
    (function loadCloudflareBeacon() {
        const beacon = document.createElement('script');
        beacon.type = 'module';
        beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
        beacon.setAttribute('data-cf-beacon', '{"token": "25cbfdd432e047e5b6e622d14ec72bba"}');
        document.head.appendChild(beacon);
    })();

    const ITEMS = [
        { key: "archive", label: "Archive Viewer", href: "archive.html" },
        { key: "players", label: "Players", href: "players.html" },
        { key: "teams", label: "Teams", href: "teams.html" },
        { key: "venues", label: "Venues", href: "venues.html" },
        { key: "records", label: "Records", href: "records.html" },
        { key: "seasons", label: "Seasons", href: "seasons.html" },
        { key: "quiz", label: "Quiz", href: "quiz.html" },
        { key: "about", label: "About", href: "about.html" },
    ];

    function render(activeKey) {
        const root = document.getElementById("wca-header-root");
        if (!root) return;

        const links = ITEMS.map(item => {
            const cls = item.key === activeKey ? "active" : "";
            return `<a href="${item.href}" class="${cls}">${item.label}</a>`;
        }).join("");

        root.innerHTML = `
        <header class="wca-header">
            <div class="wca-header-pattern" id="wcaHeaderPattern" aria-hidden="true"></div>
            <div class="container d-flex align-items-center justify-content-between wca-header-row">
                <a href="index.html" class="wca-brand text-decoration-none">
                    <img src="assets/images/logo.svg" alt="Women's Provincial Cricket Database" class="wca-logo">
                </a>
                <nav class="wca-nav" id="wcaNav">${links}</nav>
                <button class="wca-nav-toggle" id="wcaNavToggle" type="button" aria-expanded="false" aria-controls="wcaNav">
                    <i class="bi bi-list"></i> Menu
                </button>
            </div>
        </header>`;

        paintHeaderPattern();

        const toggle = document.getElementById("wcaNavToggle");
        const nav = document.getElementById("wcaNav");
        if (toggle && nav) {
            toggle.addEventListener("click", () => {
                const open = nav.classList.toggle("wca-nav-open");
                toggle.setAttribute("aria-expanded", open ? "true" : "false");
            });
        }
    }

    // Deterministic PRNG (mulberry32) seeded from today's date, so the
    // mosaic is identical across every page/visitor for a given day, but
    // redraws itself the next. Avoids Math.random(), which would make the
    // header visibly "jump" between different triangle patterns as
    // someone clicks between pages on this multi-page site.
    function mulberry32(seed) {
        return function () {
            seed |= 0;
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function seedFromDateString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
        }
        return hash;
    }

    function hexToRgb(hex) {
        hex = hex.replace("#", "").trim();
        if (hex.length === 3) hex = hex.split("").map(ch => ch + ch).join("");
        const num = parseInt(hex, 16);
        return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    }

    // Low-poly triangle mosaic behind the header, redrawn once per calendar
    // day (local time). Reads the header/gold colours straight from the CSS
    // custom properties, so a future palette tweak in site.css is picked up
    // automatically without touching this file.
    function paintHeaderPattern() {
        const layer = document.getElementById("wcaHeaderPattern");
        if (!layer) return;

        const todayKey = new Date().toDateString(); // e.g. "Thu Aug 20 2026"
        const rand = mulberry32(seedFromDateString(todayKey));

        const NS = "http://www.w3.org/2000/svg";
        const TILE = 26;
        const GRID = 7;
        const size = TILE * GRID;
        const GOLD_CHANCE = 0.012;

        const goldVar = getComputedStyle(document.documentElement)
            .getPropertyValue("--wca-gold").trim() || "#ffc107";
        const gold = hexToRgb(goldVar);

        const shades = [
            "rgba(255,255,255,0.03)",
            "rgba(255,255,255,0.05)",
            "rgba(255,255,255,0.07)",
            "rgba(255,255,255,0.10)",
            "rgba(0,0,0,0.14)",
            "rgba(0,0,0,0.22)",
            "rgba(0,0,0,0.08)",
        ];

        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("xmlns", NS);
        svg.setAttribute("width", size);
        svg.setAttribute("height", size);
        svg.setAttribute("viewBox", `0 0 ${size} ${size}`);

        for (let r = 0; r < GRID; r++) {
            for (let c = 0; c < GRID; c++) {
                const x = c * TILE, y = r * TILE;
                const flip = rand() < 0.5;
                const triA = flip
                    ? [[x, y], [x + TILE, y], [x, y + TILE]]
                    : [[x, y], [x + TILE, y], [x + TILE, y + TILE]];
                const triB = flip
                    ? [[x + TILE, y], [x + TILE, y + TILE], [x, y + TILE]]
                    : [[x, y], [x + TILE, y + TILE], [x, y + TILE]];

                [triA, triB].forEach(tri => {
                    const poly = document.createElementNS(NS, "polygon");
                    poly.setAttribute("points", tri.map(p => p.join(",")).join(" "));
                    const fill = rand() < GOLD_CHANCE
                        ? `rgba(${gold.r},${gold.g},${gold.b},0.16)`
                        : shades[Math.floor(rand() * shades.length)];
                    poly.setAttribute("fill", fill);
                    svg.appendChild(poly);
                });
            }
        }

        const serialised = new XMLSerializer().serializeToString(svg);
        layer.style.backgroundImage = `url("data:image/svg+xml;utf8,${encodeURIComponent(serialised)}")`;
        layer.style.backgroundSize = size + "px " + size + "px";
    }

    function renderFooter() {
        const root = document.getElementById("wca-footer-root");
        if (!root) return;
        const year = new Date().getFullYear();
        root.innerHTML = `<footer class="wca-footer"><div class="container">© ${year} Women's Provincial Cricket Database</div></footer>`;

        // "Data correct as of" - a manual QlikView export, not a live feed,
        // so this matters for anyone wondering how current the numbers
        // are. Fetched after the initial footer render (rather than
        // blocking it) so a slow/failed fetch never delays or breaks the
        // copyright line every page already depends on.
        fetch("data/metadata/site_meta.json")
            .then(r => r.ok ? r.json() : null)
            .then(meta => {
                if (!meta || !meta.last_match_date) return;
                const container = root.querySelector(".container");
                if (!container) return;
                const note = document.createElement("div");
                note.className = "wca-footer-note";
                note.textContent = `Data correct as of ${meta.last_match_date}`;
                container.appendChild(note);
            })
            .catch(() => {}); // silent - a missing/broken metadata file shouldn't break every page's footer
    }

    return { render, renderFooter };
})();
