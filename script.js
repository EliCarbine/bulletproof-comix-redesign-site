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

const CV_KEY  = "5c556fc0d1f8b81d60a5a8737e71a44cd9b9cd2b";
const CV_BASE = "https://comicvine.gamespot.com/api";

// /search/ endpoint searches name + real_name + aliases natively for characters
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

let searchTimer = null;
let jsonpCounter = 0;

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
  resultsEl.innerHTML = "";
  showOnly(hintEl);
}

// ── JSONP ──
// Comic Vine doesn't support CORS from browsers; use their native JSONP support.
function jsonpFetch(url) {
  return new Promise((resolve, reject) => {
    const cbName = `_cvCb${++jsonpCounter}`;
    const script = document.createElement("script");
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Request timed out")); }, 12000);

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
// Generates search variants to handle hyphens, spaces, and mixed casing so
// "Spider Man" finds "Spider-Man" and vice versa.
function queryVariants(q) {
  const base = q.trim();
  const variants = new Set([base]);
  if (base.includes(" "))  variants.add(base.replace(/\s+/g, "-"));   // "Iron Man" → "Iron-Man"
  if (base.includes("-"))  variants.add(base.replace(/-/g, " "));     // "Spider-Man" → "Spider Man"
  if (base.includes("-"))  variants.add(base.replace(/-/g, ""));      // "Spider-Man" → "SpiderMan"
  return [...variants];
}

// ── Era/year extraction ──
// Characters: parse 4-digit year from first_appeared_in_issue.name
//   e.g. "Amazing Fantasy (1962) #15" → 1962
// Volumes: use start_year directly.
// Items with no parseable year sort to end (year = 0).
function extractYear(item) {
  if (item._type === "volume") return parseInt(item.start_year) || 0;
  const issueName = item.first_appeared_in_issue?.name || "";
  const m = issueName.match(/\((\d{4})\)/);
  return m ? parseInt(m[1]) : 0;
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

// ── Card renderer ──

function renderCard(item) {
  const isVol = item._type === "volume";
  const img   = item.image?.medium_url || item.image?.small_url || "";
  const pub   = item.publisher?.name || "";
  const year  = extractYear(item);

  const card = document.createElement("article");
  card.className = "char-card";
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", item.name);

  const typeBadge = `<span class="type-badge ${isVol ? "type-vol" : "type-char"}">${isVol ? "Volume" : "Character"}</span>`;

  const meta = isVol
    ? `${item.start_year ? `<span class="vol-year">${escHtml(String(item.start_year))}</span>` : ""}
       ${item.count_of_issues ? `<p class="vol-issue-count">${escHtml(String(item.count_of_issues))} issues</p>` : ""}`
    : year
      ? `<span class="vol-year">${year}</span>`
      : "";

  card.innerHTML = `
    ${img
      ? `<img src="${escHtml(img)}" alt="${escHtml(item.name)}" loading="lazy" />`
      : `<div class="card-img-placeholder"></div>`}
    <div class="char-card-body">
      <div class="card-badges">${typeBadge}${pubBadge(pub)}</div>
      <h3 class="char-card-name">${escHtml(item.name)}</h3>
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

  const isVol = item._type === "volume";
  const img   = item.image?.medium_url || item.image?.small_url || "";
  const pub   = item.publisher?.name || "";
  const year  = extractYear(item);

  let subtitle = "";
  let tags = "";

  if (isVol) {
    const aliases    = (item.aliases || "").replace(/\n/g, ", ").trim();
    const firstIssue = issueLabel(item.first_issue) || item.first_issue?.name || "";
    const lastIssue  = issueLabel(item.last_issue)  || item.last_issue?.name  || "";
    subtitle = item.start_year ? `Started ${item.start_year}` : "";
    tags = [
      pubBadge(pub),
      `<span class="type-badge type-vol">Volume</span>`,
      item.start_year      && detailTag("Start year", item.start_year),
      item.count_of_issues && `<span class="char-detail-tag">${escHtml(String(item.count_of_issues))} issues</span>`,
      firstIssue           && detailTag("First issue", firstIssue),
      lastIssue            && detailTag("Last issue",  lastIssue),
      aliases              && detailTag("Aliases", aliases),
    ].filter(Boolean).join("");
  } else {
    const rawAliases = Array.isArray(item.aliases)
      ? item.aliases.filter(Boolean).join(", ")
      : (item.aliases || "").replace(/\n/g, ", ").trim();
    const firstIssue = issueLabel(item.first_appeared_in_issue)
      || item.first_appeared_in_issue?.name || "";
    subtitle = item.real_name || "";
    tags = [
      pubBadge(pub),
      `<span class="type-badge type-char">Character</span>`,
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
      <h2 class="char-detail-name">${escHtml(item.name)}</h2>
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

// ── Character fetch ──
// Uses /search/ endpoint which queries name, real_name, AND aliases natively.
// Fires one request per query variant (with/without hyphens) and deduplicates by ID.
async function fetchCharacters(query) {
  const variants = queryVariants(query);
  const requests = variants.map((v) => {
    const url = `${CV_BASE}/search/?api_key=${CV_KEY}&query=${encodeURIComponent(v)}&resources=character&field_list=${CHAR_FIELDS}&limit=20`;
    return jsonpFetch(url)
      .then((d) => (d.status_code === 1 ? d.results || [] : []))
      .catch(() => []);
  });

  const batches = await Promise.all(requests);
  const seen = new Set();
  const chars = [];
  for (const batch of batches) {
    for (const c of batch) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        chars.push({ ...c, _type: "character" });
      }
    }
  }
  return chars;
}

// ── Volume fetch ──
// /volumes/ doesn't have a full-text search endpoint, so we use filter=name:X
// and fire per query variant, deduplicating by ID.
async function fetchVolumes(query) {
  const variants = queryVariants(query);
  const requests = variants.map((v) => {
    const url = `${CV_BASE}/volumes/?api_key=${CV_KEY}&filter=name:${encodeURIComponent(v)}&field_list=${VOL_FIELDS}&limit=20&sort=start_year:desc`;
    return jsonpFetch(url)
      .then((d) => (d.status_code === 1 ? d.results || [] : []))
      .catch(() => []);
  });

  const batches = await Promise.all(requests);
  const seen = new Set();
  const vols = [];
  for (const batch of batches) {
    for (const v of batch) {
      if (!seen.has(v.id)) {
        seen.add(v.id);
        vols.push({ ...v, _type: "volume" });
      }
    }
  }
  return vols;
}

// ── Main search ──
// Both APIs fire in parallel. Results merge into one array and sort by era
// (latest year first; items with no parseable year fall to the end).
async function doSearch(query) {
  if (!query.trim()) { clearResults(); return; }
  showOnly(loadingEl);

  try {
    const [characters, volumes] = await Promise.all([
      fetchCharacters(query),
      fetchVolumes(query),
    ]);

    const merged = [...characters, ...volumes];
    if (!merged.length) { showOnly(emptyEl); return; }

    // Sort latest era → oldest; items with year=0 (unknown) go last
    merged.sort((a, b) => {
      const ya = extractYear(a);
      const yb = extractYear(b);
      if (ya === 0 && yb === 0) return 0;
      if (ya === 0) return 1;
      if (yb === 0) return -1;
      return yb - ya;
    });

    resultsEl.innerHTML = "";
    merged.forEach((item) => resultsEl.appendChild(renderCard(item)));
    showOnly(resultsEl);
    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error("Search error:", err);
    showOnly(errorEl);
  }
}

// ── Event bindings ──

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
