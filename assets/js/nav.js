/* ==========================================================================
   Shared header + nav, injected into <div id="wca-header-root">.
   Call WCA_NAV.render("archive") on each page, passing the key of the item
   that should show as active (or omit for none).
   ========================================================================== */

const WCA_NAV = (() => {

    const ITEMS = [
        { key: "archive", label: "Archive Viewer", href: "archive.html" },
        { key: "players", label: "Players", href: "players.html" },
        { key: "teams", label: "Teams", href: "teams.html" },
        { key: "venues", label: "Venues", href: "venues.html" },
        { key: "records", label: "Records", href: "records.html" },
        { key: "seasons", label: "Seasons", href: "seasons.html" },
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

        const toggle = document.getElementById("wcaNavToggle");
        const nav = document.getElementById("wcaNav");
        if (toggle && nav) {
            toggle.addEventListener("click", () => {
                const open = nav.classList.toggle("wca-nav-open");
                toggle.setAttribute("aria-expanded", open ? "true" : "false");
            });
        }
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
