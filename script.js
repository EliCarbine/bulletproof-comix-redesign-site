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

// ════════════════════════════════════════
// Comic Vine search
// ════════════════════════════════════════

const CV_KEY  = "5c556fc0d1f8b81d60a5a8737e71a44cd9b9cd2b";
const CV_BASE = "https://comicvine.gamespot.com/api";

const CHAR_FIELDS  = "id,name,real_name,aliases,deck,image,publisher,first_appeared_in_issue,count_of_issue_appearances";
const VOL_FIELDS   = "id,name,aliases,deck,count_of_issues,publisher,start_year,image,first_issue,last_issue";
const ISSUE_FIELDS = "id,name,issue_number,volume,image,cover_date,store_date,deck";

// ── DOM refs ──
const overlay       = document.querySelector("[data-search-overlay]");
const searchInput   = document.querySelector("[data-search-input]");
const searchClose   = document.querySelector("[data-search-close]");
const resultsEl     = document.querySelector("[data-search-results]");
const hintEl        = document.querySelector("[data-search-hint]");
const emptyEl       = document.querySelector("[data-search-empty]");
const errorEl       = document.querySelector("[data-search-error]");
const loadingEl     = document.querySelector("[data-search-loading]");
const filterPanel   = document.querySelector("[data-filter-panel]");
const filterToggle  = document.querySelector("[data-filter-toggle]");
const filterBadge   = document.querySelector("[data-filter-badge]");
const filterClear   = document.querySelector("[data-filter-clear]");

// ── State ──
let searchTimer  = null;
let jsonpCounter = 0;
let cachedResults = [];   // all fetched results, pre-filter
const activeFilters = { type: "all", publisher: "all", year: "all" };

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
  clearAll();
  searchInput.value = "";
}

// ── State helpers ──

function showOnly(el) {
  [hintEl, emptyEl, errorEl, loadingEl, resultsEl].forEach((e) => {
    e.hidden = e !== el;
  });
  if (el === resultsEl) el.hidden = false;
}

function clearAll() {
  document.querySelector(".char-detail")?.remove();
  resultsEl.innerHTML = "";
  cachedResults = [];
  showOnly(hintEl);
}

// ── JSONP ──
function jsonpFetch(url) {
  return new Promise((resolve, reject) => {
    const cbName = `_cvCb${++jsonpCounter}`;
    const script = document.createElement("script");
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Timed out")); }, 12000);

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

// ── Query normalization ──
// Generates variants to handle hyphens and spaces so "Spider Man" finds
// "Spider-Man" and vice versa.
function queryVariants(q) {
  const base = q.trim();
  const variants = new Set([base]);
  if (base.includes(" "))  variants.add(base.replace(/\s+/g, "-"));
  if (base.includes("-"))  variants.add(base.replace(/-/g, " "));
  if (base.includes("-"))  variants.add(base.replace(/-/g, ""));
  return [...variants];
}

// ── Year extraction ──
function extractYear(item) {
  if (item._type === "volume")    return parseInt(item.start_year) || 0;
  if (item._type === "issue") {
    const d = item.cover_date || item.store_date || "";
    return parseInt(d.slice(0, 4)) || 0;
  }
  // character: parse "(YYYY)" from first_appeared_in_issue.name
  const name = item.first_appeared_in_issue?.name || "";
  const m = name.match(/\((\d{4})\)/);
  return m ? parseInt(m[1]) : 0;
}

// ── Publisher normalization ──
function publisherName(item) {
  if (item._type === "issue") return item.volume?.publisher?.name || "";
  return item.publisher?.name || "";
}

function publisherClass(name) {
  if (!name) return "other";
  const lc = name.toLowerCase();
  if (lc.includes("marvel")) return "marvel";
  if (lc.includes("dc"))     return "dc";
  return "other";
}

// ── Shared render utils ──

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

// ── Card renderer ──

function typeLabel(type) {
  return { character: "Character", volume: "Volume", issue: "Issue" }[type] || type;
}

function renderCard(item) {
  const img  = item.image?.medium_url || item.image?.small_url || "";
  const pub  = publisherName(item);
  const year = extractYear(item);
  const type = item._type;

  const card = document.createElement("article");
  card.className = "char-card";
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", item.name);

  const typeBadge = `<span class="type-badge type-${type}">${typeLabel(type)}</span>`;

  let mainTitle = escHtml(item.name);
  let meta = "";

  if (type === "issue") {
    const series = item.volume?.name || "";
    const issueNum = item.issue_number ? `#${item.issue_number}` : "";
    mainTitle = series
      ? `${escHtml(series)} ${escHtml(issueNum)}`
      : escHtml(item.name);
    meta = year ? `<span class="vol-year">${year}</span>` : "";
  } else if (type === "volume") {
    meta = `${item.start_year ? `<span class="vol-year">${escHtml(String(item.start_year))}</span>` : ""}
            ${item.count_of_issues ? `<p class="vol-issue-count">${escHtml(String(item.count_of_issues))} issues</p>` : ""}`;
  } else {
    meta = year ? `<span class="vol-year">${year}</span>` : "";
  }

  card.innerHTML = `
    ${img
      ? `<img src="${escHtml(img)}" alt="${escHtml(item.name)}" loading="lazy" />`
      : `<div class="card-img-placeholder"></div>`}
    <div class="char-card-body">
      <div class="card-badges">${typeBadge}${pubBadge(pub)}</div>
      <h3 class="char-card-name">${mainTitle}</h3>
      ${meta}
      ${item.deck ? `<p class="char-card-deck">${escHtml(item.deck)}</p>` : ""}
    </div>
  `;

  card.addEventListener("click", () => showDetail(item));
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") showDetail(item); });
  return card;
}

// ── Detail panel ──

function showDetail(item) {
  document.querySelector(".char-detail")?.remove();

  const img  = item.image?.medium_url || item.image?.small_url || "";
  const pub  = publisherName(item);
  const year = extractYear(item);
  const type = item._type;

  let heading = escHtml(item.name);
  let subtitle = "";
  let tags = "";

  if (type === "issue") {
    const series   = item.volume?.name || "";
    const issueNum = item.issue_number ? `#${item.issue_number}` : "";
    heading  = series ? `${escHtml(series)} ${escHtml(issueNum)}` : escHtml(item.name);
    subtitle = item.name !== heading ? item.name : "";
    tags = [
      pubBadge(pub),
      `<span class="type-badge type-issue">Issue</span>`,
      year                 && detailTag("Cover date", year),
      item.issue_number    && detailTag("Issue", `#${item.issue_number}`),
      series               && detailTag("Series", series),
    ].filter(Boolean).join("");
  } else if (type === "volume") {
    const aliases    = (item.aliases || "").replace(/\n/g, ", ").trim();
    const firstIssue = issueLabel(item.first_issue) || item.first_issue?.name || "";
    const lastIssue  = issueLabel(item.last_issue)  || item.last_issue?.name  || "";
    subtitle = item.start_year ? `Started ${item.start_year}` : "";
    tags = [
      pubBadge(pub),
      `<span class="type-badge type-volume">Volume</span>`,
      item.start_year      && detailTag("Start year", item.start_year),
      item.count_of_issues && `<span class="char-detail-tag">${escHtml(String(item.count_of_issues))} issues</span>`,
      firstIssue           && detailTag("First issue", firstIssue),
      lastIssue            && detailTag("Last issue",  lastIssue),
      aliases              && detailTag("Aliases", aliases),
    ].filter(Boolean).join("");
  } else {
    // character
    const rawAliases = Array.isArray(item.aliases)
      ? item.aliases.filter(Boolean).join(", ")
      : (item.aliases || "").replace(/\n/g, ", ").trim();
    const firstIssue = issueLabel(item.first_appeared_in_issue)
      || item.first_appeared_in_issue?.name || "";
    subtitle = item.real_name || "";
    tags = [
      pubBadge(pub),
      `<span class="type-badge type-character">Character</span>`,
      item.real_name                  && detailTag("Real name", item.real_name),
      rawAliases                      && detailTag("Aliases", rawAliases),
      firstIssue                      && detailTag("First appeared", firstIssue),
      year                            && detailTag("Era", year),
      item.count_of_issue_appearances && `<span class="char-detail-tag">${escHtml(String(item.count_of_issue_appearances))} issue appearances</span>`,
    ].filter(Boolean).join("");
  }

  const detail = document.createElement("div");
  detail.className = "char-detail";
  detail.innerHTML = `
    ${img
      ? `<img class="char-detail-img" src="${escHtml(img)}" alt="${escHtml(item.name)}" />`
      : `<div class="detail-img-placeholder"></div>`}
    <div class="char-detail-info">
      <button class="char-detail-back" data-detail-back>
        <i data-lucide="arrow-left"></i> Back to results
      </button>
      <h2 class="char-detail-name">${heading}</h2>
      ${subtitle ? `<p class="char-detail-realname">${escHtml(subtitle)}</p>` : ""}
      ${item.deck ? `<p class="char-detail-desc">${escHtml(item.deck)}</p>` : ""}
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

// ── Filter logic ──

function matchesFilters(item) {
  const { type, publisher, year } = activeFilters;

  if (type !== "all" && item._type !== type) return false;

  if (publisher !== "all") {
    const pub = publisherName(item).toLowerCase();
    if (publisher === "marvel" && !pub.includes("marvel")) return false;
    if (publisher === "dc"     && !pub.includes("dc"))     return false;
    if (publisher === "other"  && (pub.includes("marvel") || pub.includes("dc"))) return false;
  }

  if (year !== "all") {
    const y = extractYear(item);
    if (!y) return false;
    if (year === "pre1960") {
      if (y >= 1960) return false;
    } else {
      const decade = parseInt(year);
      if (y < decade || y >= decade + 10) return false;
    }
  }

  return true;
}

function renderFiltered() {
  document.querySelector(".char-detail")?.remove();
  const filtered = cachedResults.filter(matchesFilters);

  if (!filtered.length) {
    resultsEl.innerHTML = "";
    showOnly(cachedResults.length ? emptyEl : hintEl);
    return;
  }

  resultsEl.innerHTML = "";
  filtered.forEach((item) => resultsEl.appendChild(renderCard(item)));
  showOnly(resultsEl);
  if (window.lucide) window.lucide.createIcons();
}

function updateFilterBadge() {
  const count = [
    activeFilters.type      !== "all",
    activeFilters.publisher !== "all",
    activeFilters.year      !== "all",
  ].filter(Boolean).length;

  filterBadge.textContent = count;
  filterBadge.hidden = count === 0;
  filterToggle.setAttribute("aria-expanded", !filterPanel.hidden ? "true" : "false");
}

// ── API fetchers ──

async function fetchCharacters(query) {
  const variants = queryVariants(query);
  const reqs = variants.map((v) => {
    const url = `${CV_BASE}/search/?api_key=${CV_KEY}&query=${encodeURIComponent(v)}&resources=character&field_list=${CHAR_FIELDS}&limit=20`;
    return jsonpFetch(url).then((d) => (d.status_code === 1 ? d.results || [] : [])).catch(() => []);
  });
  const batches = await Promise.all(reqs);
  const seen = new Set();
  return batches.flat().filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; })
    .map((c) => ({ ...c, _type: "character" }));
}

async function fetchVolumes(query) {
  const variants = queryVariants(query);
  const reqs = variants.map((v) => {
    const url = `${CV_BASE}/volumes/?api_key=${CV_KEY}&filter=name:${encodeURIComponent(v)}&field_list=${VOL_FIELDS}&limit=20&sort=start_year:desc`;
    return jsonpFetch(url).then((d) => (d.status_code === 1 ? d.results || [] : [])).catch(() => []);
  });
  const batches = await Promise.all(reqs);
  const seen = new Set();
  return batches.flat().filter((v) => { if (seen.has(v.id)) return false; seen.add(v.id); return true; })
    .map((v) => ({ ...v, _type: "volume" }));
}

async function fetchIssues(query) {
  const variants = queryVariants(query);
  const reqs = variants.map((v) => {
    const url = `${CV_BASE}/issues/?api_key=${CV_KEY}&filter=name:${encodeURIComponent(v)}&field_list=${ISSUE_FIELDS}&limit=20&sort=cover_date:desc`;
    return jsonpFetch(url).then((d) => (d.status_code === 1 ? d.results || [] : [])).catch(() => []);
  });
  const batches = await Promise.all(reqs);
  const seen = new Set();
  return batches.flat().filter((i) => { if (seen.has(i.id)) return false; seen.add(i.id); return true; })
    .map((i) => ({ ...i, _type: "issue" }));
}

// ── Main search ──

async function doSearch(query) {
  if (!query.trim()) { clearAll(); return; }
  showOnly(loadingEl);

  try {
    const [characters, volumes, issues] = await Promise.all([
      fetchCharacters(query),
      fetchVolumes(query),
      fetchIssues(query),
    ]);

    const merged = [...characters, ...volumes, ...issues];

    // Sort latest era → oldest; unknown year falls to end
    merged.sort((a, b) => {
      const ya = extractYear(a), yb = extractYear(b);
      if (!ya && !yb) return 0;
      if (!ya) return 1;
      if (!yb) return -1;
      return yb - ya;
    });

    cachedResults = merged;

    if (!merged.length) { showOnly(emptyEl); return; }
    renderFiltered();
  } catch (err) {
    console.error("Search error:", err);
    showOnly(errorEl);
  }
}

// ── Filter panel events ──

filterToggle?.addEventListener("click", () => {
  const isOpen = filterPanel.hidden;
  filterPanel.hidden = !isOpen;
  filterToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
});

// Type chips
document.querySelectorAll("[data-ftype]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-ftype]").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    activeFilters.type = btn.dataset.ftype;
    updateFilterBadge();
    renderFiltered();
  });
});

// Publisher chips
document.querySelectorAll("[data-fpub]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-fpub]").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    activeFilters.publisher = btn.dataset.fpub;
    updateFilterBadge();
    renderFiltered();
  });
});

// Year chips
document.querySelectorAll("[data-fyear]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-fyear]").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    activeFilters.year = btn.dataset.fyear;
    updateFilterBadge();
    renderFiltered();
  });
});

// Clear all filters
filterClear?.addEventListener("click", () => {
  activeFilters.type = "all";
  activeFilters.publisher = "all";
  activeFilters.year = "all";
  document.querySelectorAll("[data-ftype]")[0]?.classList.add("is-active");
  document.querySelectorAll("[data-ftype]").forEach((b, i) => b.classList.toggle("is-active", i === 0));
  document.querySelectorAll("[data-fpub]").forEach((b, i) => b.classList.toggle("is-active", i === 0));
  document.querySelectorAll("[data-fyear]").forEach((b, i) => b.classList.toggle("is-active", i === 0));
  updateFilterBadge();
  renderFiltered();
});

// ── Search input ──

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
  if (!q) { clearAll(); return; }
  searchTimer = setTimeout(() => doSearch(q), 420);
});
