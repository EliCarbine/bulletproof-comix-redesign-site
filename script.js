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

// ── Card renderer ──

function renderCard(item) {
  const isVol = item._type === "volume";
  const img   = item.image?.medium_url || item.image?.small_url || "";
  const pub   = item.publisher?.name || "";

  const card = document.createElement("article");
  card.className = "char-card";
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", item.name);

  const typeBadge = `<span class="type-badge ${isVol ? "type-vol" : "type-char"}">${isVol ? "Volume" : "Character"}</span>`;

  const meta = isVol
    ? `${item.start_year ? `<span class="vol-year">${escHtml(String(item.start_year))}</span>` : ""}
       ${item.count_of_issues ? `<p class="vol-issue-count">${escHtml(String(item.count_of_issues))} issues</p>` : ""}`
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
    const aliases    = Array.isArray(item.aliases)
      ? item.aliases.filter(Boolean).join(", ")
      : (item.aliases || "").replace(/\n/g, ", ").trim();
    const firstIssue = issueLabel(item.first_appeared_in_issue);
    subtitle = item.real_name || "";
    tags = [
      pubBadge(pub),
      `<span class="type-badge type-char">Character</span>`,
      item.real_name                      && detailTag("Real name", item.real_name),
      aliases                             && detailTag("Aliases", aliases),
      firstIssue                          && detailTag("First appeared", firstIssue),
      item.count_of_issue_appearances     && `<span class="char-detail-tag">${escHtml(String(item.count_of_issue_appearances))} issue appearances</span>`,
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

// ── Fetch helpers ──

async function fetchCharacters(query) {
  const url = `${CV_BASE}/characters/?api_key=${CV_KEY}&filter=name:${encodeURIComponent(query)}&field_list=${CHAR_FIELDS}&limit=20&sort=count_of_issue_appearances:desc`;
  try {
    const data = await jsonpFetch(url);
    if (data.status_code !== 1) return [];
    return (data.results || []).map((c) => ({ ...c, _type: "character" }));
  } catch {
    return [];
  }
}

async function fetchVolumes(query) {
  const url = `${CV_BASE}/volumes/?api_key=${CV_KEY}&filter=name:${encodeURIComponent(query)}&field_list=${VOL_FIELDS}&limit=20&sort=count_of_issues:desc`;
  try {
    const data = await jsonpFetch(url);
    if (data.status_code !== 1) return [];
    return (data.results || []).map((v) => ({ ...v, _type: "volume" }));
  } catch {
    return [];
  }
}

// ── Main search — fires both APIs in parallel, merges results ──

async function doSearch(query) {
  if (!query.trim()) { clearResults(); return; }
  showOnly(loadingEl);

  try {
    const [characters, volumes] = await Promise.all([
      fetchCharacters(query),
      fetchVolumes(query),
    ]);

    // Interleave: char, vol, char, vol… so neither dominates the top
    const merged = [];
    const len = Math.max(characters.length, volumes.length);
    for (let i = 0; i < len; i++) {
      if (i < characters.length) merged.push(characters[i]);
      if (i < volumes.length)    merged.push(volumes[i]);
    }

    if (!merged.length) { showOnly(emptyEl); return; }

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
