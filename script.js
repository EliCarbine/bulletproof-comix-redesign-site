// ── DOM refs ──
const menuToggle = document.querySelector("[data-menu-toggle]");
const mobileMenu = document.querySelector("[data-mobile-menu]");
const filterButtons = document.querySelectorAll("[data-filter]");
const products = document.querySelectorAll("[data-category]");

// ── Icons ──
document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) window.lucide.createIcons();
});
if (window.lucide) window.lucide.createIcons();

// ── Mobile menu ──
menuToggle?.addEventListener("click", () => {
  const isOpen = mobileMenu.classList.toggle("is-open");
  menuToggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
});

mobileMenu?.addEventListener("click", (event) => {
  if (event.target instanceof HTMLAnchorElement) {
    mobileMenu.classList.remove("is-open");
    menuToggle?.setAttribute("aria-label", "Open menu");
  }
});

// ── Product filter ──
filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;
    filterButtons.forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    products.forEach((product) => {
      const categories = product.dataset.category?.split(" ") ?? [];
      product.hidden = filter !== "all" && !categories.includes(filter);
    });
  });
});

// ── Comic Vine search ──

const CV_KEY = "5c556fc0d1f8b81d60a5a8737e71a44cd9b9cd2b";
const CV_BASE = "https://comicvine.gamespot.com/api";

const CHAR_FIELDS = "id,name,real_name,aliases,deck,image,publisher,first_appeared_in_issue,count_of_issue_appearances";
const VOL_FIELDS  = "id,name,aliases,deck,count_of_issues,publisher,start_year,image,first_issue,last_issue";

const overlay     = document.querySelector("[data-search-overlay]");
const searchInput = document.querySelector("[data-search-input]");
const searchClose = document.querySelector("[data-search-close]");
const resultsEl   = document.querySelector("[data-search-results]");
const hintEl      = document.querySelector("[data-search-hint]");
const emptyEl     = document.querySelector("[data-search-empty]");
const errorEl     = document.querySelector("[data-search-error]");
const loadingEl   = document.querySelector("[data-search-loading]");
const tabButtons  = document.querySelectorAll("[data-tab]");

let searchTimer = null;
let jsonpCounter = 0;
let activeTab = "characters";

// ── Overlay open/close ──

function openSearch() {
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
  searchInput.focus();
  if (window.lucide) window.lucide.createIcons();
}

function closeSearch() {
  overlay.hidden = true;
  document.body.style.overflow = "";
  clearResults();
  searchInput.value = "";
}

// ── State helpers ──

function showOnly(el) {
  [hintEl, emptyEl, errorEl, loadingEl, resultsEl].forEach((e) => {
    e.hidden = e !== el;
  });
  if (el === resultsEl) el.hidden = false;
}

function clearResults() {
  document.querySelector(".char-detail")?.remove();
  document.querySelector(".vol-detail")?.remove();
  resultsEl.innerHTML = "";
  showOnly(hintEl);
}

function updatePlaceholder() {
  searchInput.placeholder = activeTab === "characters"
    ? "Search characters — Batman, Spider-Man, Storm…"
    : "Search volumes — X-Men, Saga, Detective Comics…";
}

// ── JSONP ──
// Comic Vine doesn't allow CORS from browsers; use their native JSONP support.
function jsonpFetch(url) {
  return new Promise((resolve, reject) => {
    const cbName = `_cvCb${++jsonpCounter}`;
    const script = document.createElement("script");
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Request timed out")); }, 10000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[cbName];
      script.remove();
    }

    window[cbName] = (data) => { cleanup(); resolve(data); };
    script.src = `${url}&format=jsonp&json_callback=${cbName}`;
    script.onerror = () => { cleanup(); reject(new Error("Network error")); };
    document.head.appendChild(script);
  });
}

// ── Shared utils ──

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function publisherClass(name) {
  if (!name) return "other";
  const lc = name.toLowerCase();
  if (lc.includes("marvel")) return "marvel";
  if (lc.includes("dc")) return "dc";
  return "other";
}

function pubBadge(name) {
  if (!name) return "";
  return `<span class="char-card-publisher ${publisherClass(name)}">${escHtml(name)}</span>`;
}

function detailTag(label, value) {
  if (!value) return "";
  return `<span class="char-detail-tag">${escHtml(label)}: ${escHtml(String(value))}</span>`;
}

function issueLabel(issue) {
  if (!issue) return "";
  const parts = [issue.volume?.name, issue.issue_number ? `#${issue.issue_number}` : issue.name].filter(Boolean);
  return parts.join(" ");
}

// ── CHARACTER search ──

function renderCharCard(char) {
  const img = char.image?.medium_url || char.image?.small_url || "";
  const pub = char.publisher?.name || "";

  const card = document.createElement("article");
  card.className = "char-card";
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", char.name);
  card.innerHTML = `
    ${img
      ? `<img src="${escHtml(img)}" alt="${escHtml(char.name)}" loading="lazy" />`
      : `<div class="card-img-placeholder"></div>`}
    <div class="char-card-body">
      <h3 class="char-card-name">${escHtml(char.name)}</h3>
      ${pubBadge(pub)}
      ${char.deck ? `<p class="char-card-deck">${escHtml(char.deck)}</p>` : ""}
    </div>
  `;

  card.addEventListener("click", () => showCharDetail(char));
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") showCharDetail(char); });
  return card;
}

function showCharDetail(char) {
  document.querySelector(".char-detail")?.remove();
  document.querySelector(".vol-detail")?.remove();

  const img = char.image?.medium_url || char.image?.small_url || "";
  const pub = char.publisher?.name || "";
  const firstIssue = issueLabel(char.first_appeared_in_issue);
  const aliases = Array.isArray(char.aliases)
    ? char.aliases.filter(Boolean).join(", ")
    : (char.aliases || "").replace(/\n/g, ", ").trim();

  const tags = [
    pubBadge(pub),
    detailTag("Real name", char.real_name),
    aliases && `<span class="char-detail-tag">Aliases: ${escHtml(aliases)}</span>`,
    firstIssue && `<span class="char-detail-tag">First appeared: ${escHtml(firstIssue)}</span>`,
    char.count_of_issue_appearances && `<span class="char-detail-tag">${escHtml(String(char.count_of_issue_appearances))} issue appearances</span>`,
  ].filter(Boolean).join("");

  const detail = document.createElement("div");
  detail.className = "char-detail";
  detail.innerHTML = `
    ${img
      ? `<img class="char-detail-img" src="${escHtml(img)}" alt="${escHtml(char.name)}" />`
      : `<div class="detail-img-placeholder"></div>`}
    <div class="char-detail-info">
      <button class="char-detail-back" data-detail-back>
        <i data-lucide="arrow-left"></i> Back to results
      </button>
      <h2 class="char-detail-name">${escHtml(char.name)}</h2>
      ${char.real_name ? `<p class="char-detail-realname">${escHtml(char.real_name)}</p>` : ""}
      ${char.deck ? `<p class="char-detail-desc">${escHtml(char.deck)}</p>` : ""}
      <div class="char-detail-meta">${tags}</div>
    </div>
  `;

  detail.querySelector("[data-detail-back]").addEventListener("click", () => {
    detail.remove();
    resultsEl.hidden = false;
  });

  const body = document.querySelector("[data-search-body]");
  body.prepend(detail);
  resultsEl.hidden = true;
  detail.scrollIntoView({ behavior: "smooth", block: "start" });
  if (window.lucide) window.lucide.createIcons();
}

async function doCharSearch(query) {
  const url = `${CV_BASE}/characters/?api_key=${CV_KEY}&filter=name:${encodeURIComponent(query)}&field_list=${CHAR_FIELDS}&limit=20&sort=count_of_issue_appearances:desc`;
  const data = await jsonpFetch(url);
  if (data.status_code !== 1) { showOnly(errorEl); return; }
  const results = data.results || [];
  if (!results.length) { showOnly(emptyEl); return; }
  resultsEl.innerHTML = "";
  results.forEach((c) => resultsEl.appendChild(renderCharCard(c)));
  showOnly(resultsEl);
  if (window.lucide) window.lucide.createIcons();
}

// ── VOLUME search ──

function renderVolCard(vol) {
  const img = vol.image?.medium_url || vol.image?.small_url || "";
  const pub = vol.publisher?.name || "";

  const card = document.createElement("article");
  card.className = "char-card vol-card";
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", vol.name);
  card.innerHTML = `
    ${img
      ? `<img src="${escHtml(img)}" alt="${escHtml(vol.name)}" loading="lazy" />`
      : `<div class="card-img-placeholder"></div>`}
    <div class="char-card-body">
      <h3 class="char-card-name">${escHtml(vol.name)}</h3>
      ${vol.start_year ? `<span class="vol-year">${escHtml(String(vol.start_year))}</span>` : ""}
      ${pubBadge(pub)}
      ${vol.count_of_issues ? `<p class="vol-issue-count">${escHtml(String(vol.count_of_issues))} issues</p>` : ""}
      ${vol.deck ? `<p class="char-card-deck">${escHtml(vol.deck)}</p>` : ""}
    </div>
  `;

  card.addEventListener("click", () => showVolDetail(vol));
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") showVolDetail(vol); });
  return card;
}

function showVolDetail(vol) {
  document.querySelector(".char-detail")?.remove();
  document.querySelector(".vol-detail")?.remove();

  const img = vol.image?.medium_url || vol.image?.small_url || "";
  const pub = vol.publisher?.name || "";
  const firstIssue = issueLabel(vol.first_issue) || (vol.first_issue?.name ?? "");
  const lastIssue  = issueLabel(vol.last_issue)  || (vol.last_issue?.name  ?? "");
  const aliases = (vol.aliases || "").replace(/\n/g, ", ").trim();

  const tags = [
    pubBadge(pub),
    vol.start_year  && `<span class="char-detail-tag">Start year: ${escHtml(String(vol.start_year))}</span>`,
    vol.count_of_issues && `<span class="char-detail-tag">${escHtml(String(vol.count_of_issues))} issues</span>`,
    firstIssue && `<span class="char-detail-tag">First issue: ${escHtml(firstIssue)}</span>`,
    lastIssue  && `<span class="char-detail-tag">Last issue: ${escHtml(lastIssue)}</span>`,
    aliases    && `<span class="char-detail-tag">Aliases: ${escHtml(aliases)}</span>`,
  ].filter(Boolean).join("");

  const detail = document.createElement("div");
  detail.className = "char-detail vol-detail";
  detail.innerHTML = `
    ${img
      ? `<img class="char-detail-img" src="${escHtml(img)}" alt="${escHtml(vol.name)}" />`
      : `<div class="detail-img-placeholder"></div>`}
    <div class="char-detail-info">
      <button class="char-detail-back" data-detail-back>
        <i data-lucide="arrow-left"></i> Back to results
      </button>
      <h2 class="char-detail-name">${escHtml(vol.name)}</h2>
      ${vol.start_year ? `<p class="char-detail-realname">Started ${escHtml(String(vol.start_year))}</p>` : ""}
      ${vol.deck ? `<p class="char-detail-desc">${escHtml(vol.deck)}</p>` : ""}
      <div class="char-detail-meta">${tags}</div>
    </div>
  `;

  detail.querySelector("[data-detail-back]").addEventListener("click", () => {
    detail.remove();
    resultsEl.hidden = false;
  });

  const body = document.querySelector("[data-search-body]");
  body.prepend(detail);
  resultsEl.hidden = true;
  detail.scrollIntoView({ behavior: "smooth", block: "start" });
  if (window.lucide) window.lucide.createIcons();
}

async function doVolSearch(query) {
  const url = `${CV_BASE}/volumes/?api_key=${CV_KEY}&filter=name:${encodeURIComponent(query)}&field_list=${VOL_FIELDS}&limit=20&sort=count_of_issues:desc`;
  const data = await jsonpFetch(url);
  if (data.status_code !== 1) { showOnly(errorEl); return; }
  const results = data.results || [];
  if (!results.length) { showOnly(emptyEl); return; }
  resultsEl.innerHTML = "";
  results.forEach((v) => resultsEl.appendChild(renderVolCard(v)));
  showOnly(resultsEl);
  if (window.lucide) window.lucide.createIcons();
}

// ── Dispatch ──

async function doSearch(query) {
  if (!query.trim()) { clearResults(); return; }
  showOnly(loadingEl);
  try {
    if (activeTab === "volumes") {
      await doVolSearch(query);
    } else {
      await doCharSearch(query);
    }
  } catch (err) {
    console.error("Search error:", err);
    showOnly(errorEl);
  }
}

// ── Tab switching ──

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab;
    tabButtons.forEach((b) => {
      b.classList.toggle("is-active", b === btn);
      b.setAttribute("aria-selected", b === btn ? "true" : "false");
    });
    updatePlaceholder();
    clearResults();
    const q = searchInput.value.trim();
    if (q) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => doSearch(q), 0);
    }
  });
});

// ── Search event bindings ──

document.querySelector('[aria-label="Search"]')?.addEventListener("click", openSearch);

searchClose?.addEventListener("click", closeSearch);

overlay?.addEventListener("click", (e) => {
  if (e.target === overlay) closeSearch();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !overlay?.hidden) closeSearch();
});

searchInput?.addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q) { clearResults(); return; }
  searchTimer = setTimeout(() => doSearch(q), 420);
});
