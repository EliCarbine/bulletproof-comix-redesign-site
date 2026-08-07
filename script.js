// ── DOM refs ──
const menuToggle = document.querySelector("[data-menu-toggle]");
const mobileMenu = document.querySelector("[data-mobile-menu]");
const filterButtons = document.querySelectorAll("[data-filter]");
const products = document.querySelectorAll("[data-category]");

document.addEventListener("DOMContentLoaded", () => { if (window.lucide) window.lucide.createIcons(); });
if (window.lucide) window.lucide.createIcons();

menuToggle?.addEventListener("click", () => {
  const isOpen = mobileMenu.classList.toggle("is-open");
  menuToggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
});
mobileMenu?.addEventListener("click", (e) => {
  if (e.target instanceof HTMLAnchorElement) {
    mobileMenu.classList.remove("is-open");
    menuToggle?.setAttribute("aria-label", "Open menu");
  }
});
filterButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const f = btn.dataset.filter;
    filterButtons.forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    products.forEach((p) => {
      p.hidden = f !== "all" && !(p.dataset.category?.split(" ") ?? []).includes(f);
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
    function cleanup() { clearTimeout(timeout); delete window[cbName]; script.remove(); }
    window[cbName] = (data) => { cleanup(); resolve(data); };
    script.src = `${url}&format=jsonp&json_callback=${cbName}`;
    script.onerror = () => { cleanup(); reject(new Error("Network error")); };
    document.head.appendChild(script);
  });
}

// ════════════════════════════════════════
// Query intelligence
// ════════════════════════════════════════

const STOP_WORDS_RE = /\b(the|a|an|of|and|&)\b/gi;

// Strip filler words, collapse whitespace, trim
function preprocessQuery(raw) {
  return raw.trim().replace(STOP_WORDS_RE, " ").replace(/\s+/g, " ").trim();
}

// Normalize for comparison: lowercase, strip hyphens/spaces/special chars
// "Spider-Man" = "Spider Man" = "Spiderman" → "spiderman"
function norm(str) {
  return String(str ?? "").toLowerCase().replace(/[-\s]/g, "").replace(/[^a-z0-9]/g, "");
}

// Levenshtein edit distance (space-optimized)
function editDistance(a, b) {
  const m = a.length, n = b.length;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[n];
}

// Simplified phonetic key: maps common English superhero spelling variations
// to a shared form so "Sooperman" and "Superman" produce the same key.
function phoneticKey(str) {
  return str
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/qu/g, "k")
    .replace(/oo/g, "u")
    .replace(/ay([a-z])/g, "a$1")
    .replace(/ei/g, "i")
    .replace(/[aeiou]/g, "a")   // collapse all vowels to one token
    .replace(/(.)\1+/g, "$1")   // collapse repeated chars
    .replace(/[^a-z0-9]/g, "");
}

// Score a query against a single result item.
// Returns a match tier score (0 = no match) for re-ranking.
function scoreItem(rawQuery, item) {
  const q = norm(preprocessQuery(rawQuery));
  if (!q || !item.name) return 0;

  const name     = norm(item.name);
  const realName = norm(item.real_name || "");
  const rawAl    = Array.isArray(item.aliases)
    ? item.aliases
    : String(item.aliases || "").split(/[\n,]+/);
  const aliases  = rawAl.map((a) => norm(a)).filter(Boolean);
  const allNames = [name, realName, ...aliases].filter(Boolean);

  // Tier 1 — Exact match
  if (allNames.some((n) => n === q)) return 100;

  // Tier 2 — Prefix match (name starts with query)
  if (allNames.some((n) => n.startsWith(q))) return 80;

  // Tier 3 — Substring match (query found anywhere in name)
  if (allNames.some((n) => n.includes(q))) return 60;

  // Tier 4 — Truncated/abbreviated word match (query is prefix of an individual word)
  if (q.length >= 2) {
    const words = (item.name).toLowerCase().split(/[\s\-\/]+/).map((w) => norm(w));
    if (words.some((w) => w.length > 0 && w.startsWith(q))) return 40;
  }

  // Tier 5 — Fuzzy/typo match, edit distance 1-2 (only for query >= 4 chars)
  if (q.length >= 4) {
    const maxDist = q.length <= 5 ? 1 : 2;
    for (const n of allNames) {
      if (editDistance(q, n) <= maxDist) return 20;
      // Also check prefix window of similar length
      if (n.length >= q.length - 1 && editDistance(q, n.slice(0, q.length + 1)) <= maxDist) return 18;
    }
  }

  // Tier 6 — Phonetic match (only for query >= 4 chars)
  if (q.length >= 4) {
    const pq = phoneticKey(q);
    if (pq.length >= 3 && allNames.some((n) => phoneticKey(n).startsWith(pq) || phoneticKey(n).includes(pq))) return 10;
  }

  return 0;
}

// Build API query variants:
//  - hyphen/space normalization (always)
//  - abbreviation expansion for short prefixes ("Cap" → "Captain")
//  - double-letter collapse ("capp" → "cap")
//  - phonetic correction ("oo" → "u") for longer queries
// Capped at 4 variants to stay within rate limits.
function buildQueryVariants(raw) {
  const cleaned = preprocessQuery(raw);
  const base = cleaned.trim();
  const set = new Set([base]);

  if (base.includes(" ")) set.add(base.replace(/\s+/g, "-"));
  if (base.includes("-")) set.add(base.replace(/-/g, " "));
  if (base.includes("-")) set.add(base.replace(/-/g, ""));

  // Common abbreviation expansions
  const ABBREV = [
    ["cap",  "Captain"], ["wond", "Wonder"], ["invi", "Invincible"],
    ["spid", "Spider"],  ["iro",  "Iron"],   ["gre",  "Green"],
    ["blac", "Black"],   ["dr",   "Doctor"], ["prof", "Professor"],
  ];
  const lc = base.toLowerCase();
  for (const [abbr, full] of ABBREV) {
    if (lc.startsWith(abbr)) { set.add(base.replace(new RegExp(`^${abbr}`, "i"), full)); break; }
  }

  // Collapse double letters (capp → cap, wolveerin → wolverin)
  const deduped = base.replace(/(.)\1+/g, "$1");
  if (deduped !== base) set.add(deduped);

  // Phonetic correction
  if (base.length >= 4) {
    const phonFixed = base.replace(/oo/g, "u").replace(/ph/g, "f").replace(/ay([a-z])/g, "a$1");
    if (phonFixed !== base) set.add(phonFixed);
  }

  return [...set].slice(0, 4); // cap at 4 API calls per type
}

// ════════════════════════════════════════
// Year / publisher utilities
// ════════════════════════════════════════

function safeYear(val) {
  const y = parseInt(String(val ?? "").slice(0, 4));
  return y >= 1900 && y <= 2100 ? y : 0;
}

function extractYear(item) {
  if (item._type === "volume")  return safeYear(item.start_year);
  if (item._type === "issue")   return safeYear(item.cover_date || item.store_date);
  if (item._firstIssueDate)     return safeYear(item._firstIssueDate);
  const fi = item.first_appeared_in_issue;
  if (fi) {
    for (const src of [fi.name || "", fi.volume?.name || ""]) {
      const m = src.match(/\((\d{4})\)/);
      if (m) { const y = parseInt(m[1]); if (y >= 1900 && y <= 2100) return y; }
    }
  }
  return 0;
}

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
    } catch { /* silently skip */ }
  }));
}

function publisherName(item) {
  if (item._type === "issue") return item.volume?.publisher?.name || "";
  return item.publisher?.name || "";
}

function publisherClass(name) {
  if (!name) return "other";
  const lc = name.toLowerCase();
  if (lc.includes("marvel")) return "marvel";
  if (lc.includes("dc"))     return "dc";
  if (lc.includes("image"))  return "image";
  return "other";
}

// ════════════════════════════════════════
// Render utilities
// ════════════════════════════════════════

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
  return [issue.volume?.name, issue.issue_number ? `#${issue.issue_number}` : issue.name].filter(Boolean).join(" ");
}

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
  card.setAttribute("aria-label", item.name || "Result");

  let heading = escHtml(item.name || "");
  let meta = "";

  if (type === "issue") {
    const series   = item.volume?.name || "";
    const num      = item.issue_number ? `#${item.issue_number}` : "";
    heading = series ? `${escHtml(series)} ${escHtml(num)}` : heading;
    meta    = year ? `<span class="vol-year">${year}</span>` : "";
  } else if (type === "volume") {
    meta = `${item.start_year ? `<span class="vol-year">${escHtml(String(item.start_year))}</span>` : ""}
            ${item.count_of_issues ? `<p class="vol-issue-count">${escHtml(String(item.count_of_issues))} issues</p>` : ""}`;
  } else {
    meta = year
      ? `<span class="vol-year">${year}</span>`
      : `<span class="vol-year era-unknown">Era unknown</span>`;
  }

  card.innerHTML = `
    ${img ? `<img src="${escHtml(img)}" alt="${escHtml(item.name || "")}" loading="lazy" />` : `<div class="card-img-placeholder"></div>`}
    <div class="char-card-body">
      <div class="card-badges"><span class="type-badge type-${type}">${typeLabel(type)}</span>${pubBadge(pub)}</div>
      <h3 class="char-card-name">${heading}</h3>
      ${meta}
      ${item.deck ? `<p class="char-card-deck">${escHtml(item.deck)}</p>` : ""}
    </div>
  `;

  card.addEventListener("click", () => showDetail(item));
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") showDetail(item); });
  return card;
}

// ── Mantle/legacy group (same name, same publisher) ──
function renderMantleGroup(name, chars) {
  const el = document.createElement("div");
  el.className = "mantle-group";
  el.innerHTML = `
    <div class="mantle-header">
      <i data-lucide="users"></i>
      <span>${escHtml(name)}</span>
      <span class="mantle-count">${chars.length} versions</span>
    </div>
    <div class="mantle-grid"></div>
  `;
  chars.forEach((c) => el.querySelector(".mantle-grid").appendChild(renderCard(c)));
  return el;
}

// ── Publisher group section ──
function renderPublisherSection(pubName, nameMap) {
  const totalItems = [...nameMap.values()].flat().length;

  const section = document.createElement("section");
  section.className = "publisher-group";

  section.innerHTML = `
    <div class="publisher-group-header">
      <span class="pub-group-label ${publisherClass(pubName)}">${escHtml(pubName)}</span>
      <span class="pub-group-count">${totalItems} result${totalItems !== 1 ? "s" : ""}</span>
    </div>
    <div class="publisher-group-grid"></div>
  `;

  const grid = section.querySelector(".publisher-group-grid");
  for (const [charName, chars] of nameMap) {
    if (chars.length === 1) {
      grid.appendChild(renderCard(chars[0]));
    } else {
      // Multiple characters with same name in same publisher = legacy/mantle holders
      const mantle = renderMantleGroup(charName, chars);
      mantle.style.gridColumn = "1 / -1";
      grid.appendChild(mantle);
    }
  }

  return section;
}

// ── Group characters by publisher → then by name (mantle detection) ──
function groupCharsByPublisher(chars) {
  const PUB_ORDER = (name) => {
    const lc = name.toLowerCase();
    if (lc.includes("marvel")) return 0;
    if (lc.includes("dc"))     return 1;
    if (lc.includes("image"))  return 2;
    if (lc.includes("dark horse")) return 3;
    return 99;
  };

  const pubMap = new Map();
  for (const char of chars) {
    const pub = publisherName(char) || "Other / Unknown";
    if (!pubMap.has(pub)) pubMap.set(pub, new Map());
    const nameMap = pubMap.get(pub);
    const key = (char.name || "").trim();
    if (!nameMap.has(key)) nameMap.set(key, []);
    nameMap.get(key).push(char);
  }

  return [...pubMap.entries()].sort(([a], [b]) => {
    const diff = PUB_ORDER(a) - PUB_ORDER(b);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
}

// ── Detail panel ──
function showDetail(item) {
  document.querySelector(".char-detail")?.remove();
  const img  = item.image?.medium_url || item.image?.small_url || "";
  const pub  = publisherName(item);
  const year = extractYear(item);
  const type = item._type;
  const fi   = item.first_appeared_in_issue;

  let heading = escHtml(item.name || ""), subtitle = "", tags = "";

  if (type === "issue") {
    const series = item.volume?.name || "";
    const num    = item.issue_number ? `#${item.issue_number}` : "";
    heading  = series ? `${escHtml(series)} ${escHtml(num)}` : heading;
    subtitle = item.name !== heading ? (item.name || "") : "";
    tags = [
      pubBadge(pub), `<span class="type-badge type-issue">Issue</span>`,
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
      pubBadge(pub), `<span class="type-badge type-volume">Volume</span>`,
      item.start_year      && detailTag("Start year", item.start_year),
      item.count_of_issues && `<span class="char-detail-tag">${escHtml(String(item.count_of_issues))} issues</span>`,
      firstIssue           && detailTag("First issue", firstIssue),
      lastIssue            && detailTag("Last issue", lastIssue),
      aliases              && detailTag("Aliases", aliases),
    ].filter(Boolean).join("");
  } else {
    const rawAl      = Array.isArray(item.aliases)
      ? item.aliases.filter(Boolean).join(", ")
      : (item.aliases || "").replace(/\n/g, ", ").trim();
    const firstIssue = fi
      ? [fi.volume?.name, fi.issue_number ? `#${fi.issue_number}` : fi.name].filter(Boolean).join(" ")
      : "";
    subtitle = item.real_name || "";
    tags = [
      pubBadge(pub), `<span class="type-badge type-character">Character</span>`,
      item.real_name                  && detailTag("Real name", item.real_name),
      rawAl                           && detailTag("Aliases", rawAl),
      firstIssue                      && detailTag("First appeared", firstIssue),
      year                            && detailTag("Era", year),
      !year                           && `<span class="char-detail-tag">Era: unknown</span>`,
      item.count_of_issue_appearances && `<span class="char-detail-tag">${escHtml(String(item.count_of_issue_appearances))} issue appearances</span>`,
    ].filter(Boolean).join("");
  }

  const detail = document.createElement("div");
  detail.className = "char-detail";
  detail.innerHTML = `
    ${img ? `<img class="char-detail-img" src="${escHtml(img)}" alt="${escHtml(item.name || "")}" />` : `<div class="detail-img-placeholder"></div>`}
    <div class="char-detail-info">
      <button class="char-detail-back" data-detail-back><i data-lucide="arrow-left"></i> Back to results</button>
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

  document.querySelector("[data-search-body]").prepend(detail);
  resultsEl.hidden = true;
  detail.scrollIntoView({ behavior: "smooth", block: "start" });
  if (window.lucide) window.lucide.createIcons();
}

// ════════════════════════════════════════
// Filter logic
// ════════════════════════════════════════

// Permanent publisher allowlist — only Marvel, DC, and Image results shown
function isAllowedPublisher(item) {
  const pub = publisherName(item).toLowerCase();
  return pub.includes("marvel") || pub.includes("dc") || pub.includes("image");
}

function matchesFilters(item) {
  if (!isAllowedPublisher(item)) return false;

  const { type, publisher, year } = activeFilters;
  if (type !== "all" && item._type !== type) return false;
  if (publisher !== "all") {
    const pub = publisherName(item).toLowerCase();
    if (publisher === "marvel" && !pub.includes("marvel")) return false;
    if (publisher === "dc"     && !pub.includes("dc"))     return false;
    if (publisher === "image"  && !pub.includes("image"))  return false;
  }
  if (year !== "all") {
    const y = extractYear(item);
    if (!y) return false;
    if (year === "pre1960") return y < 1960;
    const decade = parseInt(year);
    return y >= decade && y < decade + 10;
  }
  return true;
}

function updateFilterBadge() {
  const count = [activeFilters.type !== "all", activeFilters.publisher !== "all", activeFilters.year !== "all"].filter(Boolean).length;
  filterBadge.textContent = count;
  filterBadge.hidden = count === 0;
}

// ── Render with publisher grouping and match scoring ──
function renderFiltered(rawQuery = "") {
  document.querySelector(".char-detail")?.remove();
  resultsEl.innerHTML = "";

  const filtered = cachedResults.filter(matchesFilters);
  if (!filtered.length) { showOnly(cachedResults.length ? emptyEl : hintEl); return; }

  // Score and sort characters; volumes/issues stay era-sorted
  const chars  = filtered.filter((r) => r._type === "character");
  const others = filtered.filter((r) => r._type !== "character");

  if (rawQuery) {
    chars.sort((a, b) => {
      const sa = scoreItem(rawQuery, a), sb = scoreItem(rawQuery, b);
      if (sb !== sa) return sb - sa;                    // higher score first
      const ya = extractYear(a), yb = extractYear(b);
      if (!ya && !yb) return 0;
      if (!ya) return 1; if (!yb) return -1;
      return yb - ya;                                   // tie-break by era
    });
  }

  // Group characters by publisher, detect legacy/mantle (same name, same publisher)
  const pubGroups = groupCharsByPublisher(chars);
  for (const [pubName, nameMap] of pubGroups) {
    resultsEl.appendChild(renderPublisherSection(pubName, nameMap));
  }

  // Volumes and issues below, in their own grid
  if (others.length) {
    if (pubGroups.length) {
      const divider = document.createElement("div");
      divider.className = "results-divider";
      divider.innerHTML = `<span>Volumes &amp; Issues</span>`;
      resultsEl.appendChild(divider);
    }
    const grid = document.createElement("div");
    grid.className = "search-results-grid";
    others.forEach((item) => grid.appendChild(renderCard(item)));
    resultsEl.appendChild(grid);
  }

  showOnly(resultsEl);
  if (window.lucide) window.lucide.createIcons();
}

// ════════════════════════════════════════
// API fetchers
// ════════════════════════════════════════

async function fetchCharacters(query) {
  const variants = buildQueryVariants(query);
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
  const variants = buildQueryVariants(query);
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
  const variants = buildQueryVariants(query);
  const reqs = variants.map((v) => {
    const url = `${CV_BASE}/issues/?api_key=${CV_KEY}&filter=name:${encodeURIComponent(v)}&field_list=${ISSUE_FIELDS}&limit=20&sort=cover_date:desc`;
    return jsonpFetch(url).then((d) => (d.status_code === 1 ? d.results || [] : [])).catch(() => []);
  });
  const seen = new Set();
  return (await Promise.all(reqs)).flat()
    .filter((i) => { if (seen.has(i.id)) return false; seen.add(i.id); return true; })
    .map((i) => ({ ...i, _type: "issue" }));
}

// ── Minimum query length gating ──
// 1 char  → show hint, no API call
// 2-3 chars → API call, prefix/substring matching only
// 4+ chars → full fuzzy + phonetic matching enabled
const MIN_QUERY = 2;

// ════════════════════════════════════════
// Main search
// ════════════════════════════════════════

let lastQuery = "";

async function doSearch(query) {
  const q = query.trim();
  if (q.length < MIN_QUERY) {
    hintEl.textContent = q.length === 1
      ? "Keep typing — enter at least 2 characters to search."
      : "Type a name to search characters, volumes, and issues.";
    clearAll();
    return;
  }

  lastQuery = q;
  showOnly(loadingEl);

  try {
    const [characters, volumes, issues] = await Promise.all([
      fetchCharacters(q),
      fetchVolumes(q),
      fetchIssues(q),
    ]);

    // Enrich character years via batch cover_date fetch
    await enrichCharacterYears(characters);

    // Sort non-character results by era
    const others = [...volumes, ...issues].sort((a, b) => {
      const ya = extractYear(a), yb = extractYear(b);
      if (!ya && !yb) return 0; if (!ya) return 1; if (!yb) return -1;
      return yb - ya;
    });

    cachedResults = [...characters, ...others];

    if (!cachedResults.length) { showOnly(emptyEl); return; }
    renderFiltered(q);
  } catch (err) {
    console.error("Search error:", err);
    showOnly(errorEl);
  }
}

// ════════════════════════════════════════
// Filter panel
// ════════════════════════════════════════

filterToggle?.addEventListener("click", () => {
  const opening = filterPanel.hidden;
  filterPanel.hidden = !opening;
  filterToggle.setAttribute("aria-expanded", opening ? "true" : "false");
});

function bindFilterGroup(attr, stateKey, dataKey) {
  document.querySelectorAll(`[${attr}]`).forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(`[${attr}]`).forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      activeFilters[stateKey] = btn.dataset[dataKey];
      updateFilterBadge();
      renderFiltered(lastQuery);
    });
  });
}

bindFilterGroup("data-ftype",  "type",      "ftype");
bindFilterGroup("data-fpub",   "publisher", "fpub");
bindFilterGroup("data-fyear",  "year",      "fyear");

filterClear?.addEventListener("click", () => {
  activeFilters.type = "all";
  activeFilters.publisher = "all";
  activeFilters.year = "all";
  ["data-ftype", "data-fpub", "data-fyear"].forEach((attr) => {
    document.querySelectorAll(`[${attr}]`).forEach((b, i) => b.classList.toggle("is-active", i === 0));
  });
  updateFilterBadge();
  renderFiltered(lastQuery);
});

// ════════════════════════════════════════
// Event bindings
// ════════════════════════════════════════

document.querySelector('[aria-label="Search"]')?.addEventListener("click", openSearch);
searchClose?.addEventListener("click", closeSearch);
overlay?.addEventListener("click", (e) => { if (e.target === overlay) closeSearch(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay?.hidden) closeSearch(); });

searchInput?.addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q) { clearAll(); return; }
  const delay = q.length <= 2 ? 600 : 420;
  searchTimer = setTimeout(() => doSearch(q), delay);
});
