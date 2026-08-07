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

// The /search/ endpoint returns first_appeared_in_issue with only {id, name, issue_number}
// — no volume, no cover_date. We batch-fetch cover_dates via /issues/?filter=id:X|Y|Z
// after the initial character search.
const CHAR_FIELDS  = "id,name,real_name,aliases,deck,image,publisher,first_appeared_in_issue,count_of_issue_appearances";
const VOL_FIELDS   = "id,name,aliases,deck,count_of_issues,publisher,start_year,image,first_issue,last_issue";
const ISSUE_FIELDS = "id,name,issue_number,volume,image,cover_date,store_date,deck";

// ── DOM refs ──
const overlay      = document.querySelector("[data-search-overlay]");
const searchInput  = document.querySelector("[data-search-input]");
const searchClose  = document.querySelector("[data-search-close]");
const resultsEl    = document.querySelector("[data-search-results]");
const hintEl       = document.querySelector("[data-search-hint]");
const emptyEl      = document.querySelector("[data-search-empty]");
const errorEl      = document.querySelector("[data-search-error]");
const loadingEl    = document.querySelector("[data-search-loading]");
const filterPanel  = document.querySelector("[data-filter-panel]");
const filterToggle = document.querySelector("[data-filter-toggle]");
const filterBadge  = document.querySelector("[data-filter-badge]");
const filterClear  = document.querySelector("[data-filter-clear]");

// ── State ──
let searchTimer   = null;
let jsonpCounter  = 0;
let cachedResults = [];
const activeFilters = { type: "all", publisher: "all", year: "all" };

// ── Overlay ──

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

function showOnly(el) {
  [hintEl, emptyEl, errorEl, loadingEl, resultsEl].forEach((e) => { e.hidden = e !== el; });
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
    const script  = document.createElement("script");
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
// Generates search variants for hyphen/space flexibility:
//   "Spider Man" → ["Spider Man", "Spider-Man"]
//   "Spider-Man" → ["Spider-Man", "Spider Man", "SpiderMan"]
function queryVariants(q) {
  const base = q.trim();
  const set  = new Set([base]);
  if (base.includes(" "))  set.add(base.replace(/\s+/g, "-"));
  if (base.includes("-"))  set.add(base.replace(/-/g, " "));
  if (base.includes("-"))  set.add(base.replace(/-/g, ""));
  return [...set];
}

// ── Year extraction ──
//
// Edge cases:
//   cover_date / store_date can be null, "0000-00-00", or missing → year = 0
//   first_appeared_in_issue from /search/ endpoint has no volume/cover_date field
//   Characters with no first_appeared_in_issue entry at all → year = 0
//   Items with year = 0 are sortable (pushed to end) but excluded from decade filters
//
// Characters are enriched by a secondary batch fetch (enrichCharacterYears)
// that injects ._firstIssueDate from the actual issue's cover_date.
function safeYear(val) {
  const y = parseInt(String(val ?? "").slice(0, 4));
  return (y >= 1900 && y <= 2100) ? y : 0;
}

function extractYear(item) {
  if (item._type === "volume")    return safeYear(item.start_year);
  if (item._type === "issue")     return safeYear(item.cover_date || item.store_date);

  // character: prefer enriched cover_date injected by enrichCharacterYears
  if (item._firstIssueDate) return safeYear(item._firstIssueDate);

  // fallback: parse "(YYYY)" from issue/volume name if present
  // (only reliable when volume name includes the year, e.g. "Detective Comics (1937)")
  const fi = item.first_appeared_in_issue;
  if (fi) {
    for (const src of [fi.name || "", fi.volume?.name || ""]) {
      const m = src.match(/\((\d{4})\)/);
      if (m) {
        const y = parseInt(m[1]);
        if (y >= 1900 && y <= 2100) return y;
      }
    }
  }

  return 0; // unknown era; sorted to end, excluded from decade filters
}

// ── Batch-enrich character years ──
// The /search/ endpoint returns first_appeared_in_issue without cover_date.
// For every character whose year is still 0, we batch their issue IDs and
// call /issues/?filter=id:A|B|C to get cover_dates in as few requests as possible.
async function enrichCharacterYears(chars) {
  const BATCH = 30;
  const todo  = chars.filter((c) => !extractYear(c) && c.first_appeared_in_issue?.id);
  if (!todo.length) return;

  const batches = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));

  await Promise.all(batches.map(async (batch) => {
    const ids = batch.map((c) => c.first_appeared_in_issue.id).join("|");
    const url = `${CV_BASE}/issues/?api_key=${CV_KEY}&filter=id:${ids}&field_list=id,cover_date&limit=${BATCH}`;
    try {
      const data = await jsonpFetch(url);
      if (data.status_code !== 1) return;
      const map = {};
      for (const issue of data.results || []) {
        if (issue.cover_date && issue.cover_date !== "0000-00-00") map[issue.id] = issue.cover_date;
      }
      for (const char of batch) {
        const date = map[char.first_appeared_in_issue.id];
        if (date) char._firstIssueDate = date;
      }
    } catch { /* silently skip; year stays 0 */ }
  }));
}

// ── Publisher helpers ──
//
// Edge cases:
//   Issues: the volume mini-object in /issues/ responses has no publisher field.
//   These will always match the "other" publisher bucket.
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

// ── Render utils ──

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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

function typeLabel(type) {
  return { character: "Character", volume: "Volume", issue: "Issue" }[type] || type;
}

// ── Card renderer ──

function renderCard(item) {
  const img  = item.image?.medium_url || item.image?.small_url || "";
  const pub  = publisherName(item);
  const year = extractYear(item);
  const type = item._type;

  const card = document.createElement("article");
  card.className = "char-card";
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", item.name || "Result");

  const typeBadge = `<span class="type-badge type-${type}">${typeLabel(type)}</span>`;

  let heading = escHtml(item.name || "");
  let meta    = "";

  if (type === "issue") {
    const series   = item.volume?.name || "";
    const issueNum = item.issue_number ? `#${item.issue_number}` : "";
    heading = series ? `${escHtml(series)} ${escHtml(issueNum)}` : escHtml(item.name || "");
    meta    = year ? `<span class="vol-year">${year}</span>` : "";
  } else if (type === "volume") {
    meta = `${item.start_year ? `<span class="vol-year">${escHtml(String(item.start_year))}</span>` : ""}
            ${item.count_of_issues ? `<p class="vol-issue-count">${escHtml(String(item.count_of_issues))} issues</p>` : ""}`;
  } else {
    meta = year ? `<span class="vol-year">${year}</span>` : `<span class="vol-year era-unknown">Era unknown</span>`;
  }

  card.innerHTML = `
    ${img
      ? `<img src="${escHtml(img)}" alt="${escHtml(item.name || "")}" loading="lazy" />`
      : `<div class="card-img-placeholder"></div>`}
    <div class="char-card-body">
      <div class="card-badges">${typeBadge}${pubBadge(pub)}</div>
      <h3 class="char-card-name">${heading}</h3>
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
  const fi   = item.first_appeared_in_issue;

  let heading  = escHtml(item.name || "");
  let subtitle = "";
  let tags     = "";

  if (type === "issue") {
    const series   = item.volume?.name || "";
    const issueNum = item.issue_number ? `#${item.issue_number}` : "";
    heading  = series ? `${escHtml(series)} ${escHtml(issueNum)}` : escHtml(item.name || "");
    subtitle = item.name !== heading ? (item.name || "") : "";
    tags = [
      pubBadge(pub),
      `<span class="type-badge type-issue">Issue</span>`,
      year              && detailTag("Cover date", year),
      item.issue_number && detailTag("Issue", `#${item.issue_number}`),
      series            && detailTag("Series", series),
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
    const firstIssueName = fi
      ? [fi.volume?.name, fi.issue_number ? `#${fi.issue_number}` : fi.name].filter(Boolean).join(" ")
      : "";
    subtitle = item.real_name || "";
    tags = [
      pubBadge(pub),
      `<span class="type-badge type-character">Character</span>`,
      item.real_name                  && detailTag("Real name", item.real_name),
      rawAliases                      && detailTag("Aliases", rawAliases),
      firstIssueName                  && detailTag("First appeared", firstIssueName),
      year                            && detailTag("Era", year),
      !year                           && `<span class="char-detail-tag">Era: unknown</span>`,
      item.count_of_issue_appearances && `<span class="char-detail-tag">${escHtml(String(item.count_of_issue_appearances))} issue appearances</span>`,
    ].filter(Boolean).join("");
  }

  const detail = document.createElement("div");
  detail.className = "char-detail";
  detail.innerHTML = `
    ${img
      ? `<img class="char-detail-img" src="${escHtml(img)}" alt="${escHtml(item.name || "")}" />`
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
    // "other" = neither Marvel nor DC; issues without publisher data also land here
    if (publisher === "other"  && (pub.includes("marvel") || pub.includes("dc"))) return false;
  }

  if (year !== "all") {
    const y = extractYear(item);
    if (!y) return false; // unknown era excluded from all decade filters
    if (year === "pre1960") return y < 1960;
    const decade = parseInt(year);
    return y >= decade && y < decade + 10;
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
  filterBadge.hidden      = count === 0;
}

// ── API fetchers ──

async function fetchCharacters(query) {
  const variants = queryVariants(query);
  const reqs = variants.map((v) => {
    const url = `${CV_BASE}/search/?api_key=${CV_KEY}&query=${encodeURIComponent(v)}&resources=character&field_list=${CHAR_FIELDS}&limit=20`;
    return jsonpFetch(url).then((d) => (d.status_code === 1 ? d.results || [] : [])).catch(() => []);
  });
  const seen = new Set();
  return (await Promise.all(reqs)).flat()
    .filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; })
    .map((c) => ({ ...c, _type: "character" }));
}

async function fetchVolumes(query) {
  const variants = queryVariants(query);
  const reqs = variants.map((v) => {
    const url = `${CV_BASE}/volumes/?api_key=${CV_KEY}&filter=name:${encodeURIComponent(v)}&field_list=${VOL_FIELDS}&limit=20&sort=start_year:desc`;
    return jsonpFetch(url).then((d) => (d.status_code === 1 ? d.results || [] : [])).catch(() => []);
  });
  const seen = new Set();
  return (await Promise.all(reqs)).flat()
    .filter((v) => { if (seen.has(v.id)) return false; seen.add(v.id); return true; })
    .map((v) => ({ ...v, _type: "volume" }));
}

async function fetchIssues(query) {
  const variants = queryVariants(query);
  const reqs = variants.map((v) => {
    const url = `${CV_BASE}/issues/?api_key=${CV_KEY}&filter=name:${encodeURIComponent(v)}&field_list=${ISSUE_FIELDS}&limit=20&sort=cover_date:desc`;
    return jsonpFetch(url).then((d) => (d.status_code === 1 ? d.results || [] : [])).catch(() => []);
  });
  const seen = new Set();
  return (await Promise.all(reqs)).flat()
    .filter((i) => { if (seen.has(i.id)) return false; seen.add(i.id); return true; })
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

    // Enrich character years: batch-fetch cover_date for any character
    // whose year couldn't be parsed from the search response
    await enrichCharacterYears(characters);

    const merged = [...characters, ...volumes, ...issues];

    // Sort: latest era first; unknown year (0) pushed to end
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
  const opening = filterPanel.hidden;
  filterPanel.hidden = !opening;
  filterToggle.setAttribute("aria-expanded", opening ? "true" : "false");
});

function bindFilterGroup(attr) {
  document.querySelectorAll(`[${attr}]`).forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(`[${attr}]`).forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      activeFilters[{ "data-ftype": "type", "data-fpub": "publisher", "data-fyear": "year" }[attr]]
        = btn.dataset[{ "data-ftype": "ftype", "data-fpub": "fpub", "data-fyear": "fyear" }[attr]];
      updateFilterBadge();
      renderFiltered();
    });
  });
}

bindFilterGroup("data-ftype");
bindFilterGroup("data-fpub");
bindFilterGroup("data-fyear");

filterClear?.addEventListener("click", () => {
  activeFilters.type = "all";
  activeFilters.publisher = "all";
  activeFilters.year = "all";
  ["data-ftype", "data-fpub", "data-fyear"].forEach((attr) => {
    const chips = document.querySelectorAll(`[${attr}]`);
    chips.forEach((b, i) => b.classList.toggle("is-active", i === 0));
  });
  updateFilterBadge();
  renderFiltered();
});

// ── Search input events ──

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
