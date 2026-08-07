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

// ── Character search ──

const CV_KEY = "5c556fc0d1f8b81d60a5a8737e71a44cd9b9cd2b";
const CV_BASE = "https://comicvine.gamespot.com/api";
const FIELD_LIST = "id,name,real_name,aliases,deck,image,publisher,first_appeared_in_issue,count_of_issue_appearances";

const overlay = document.querySelector("[data-search-overlay]");
const searchInput = document.querySelector("[data-search-input]");
const searchClose = document.querySelector("[data-search-close]");
const resultsEl = document.querySelector("[data-search-results]");
const hintEl = document.querySelector("[data-search-hint]");
const emptyEl = document.querySelector("[data-search-empty]");
const errorEl = document.querySelector("[data-search-error]");
const loadingEl = document.querySelector("[data-search-loading]");

let searchTimer = null;
let jsonpCounter = 0;

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

function showOnly(el) {
  [hintEl, emptyEl, errorEl, loadingEl, resultsEl].forEach((e) => {
    e.hidden = e !== el;
  });
  if (el === resultsEl) el.hidden = false;
}

function clearResults() {
  resultsEl.innerHTML = "";
  showOnly(hintEl);
}

// JSONP fetch — Comic Vine doesn't allow CORS from browsers, so we use their
// native JSONP support (format=jsonp&json_callback=...).
function jsonpFetch(url) {
  return new Promise((resolve, reject) => {
    const cbName = `_cvCallback${++jsonpCounter}`;
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Request timed out"));
    }, 10000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[cbName];
      script.remove();
    }

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.src = `${url}&format=jsonp&json_callback=${cbName}`;
    script.onerror = () => { cleanup(); reject(new Error("Network error")); };
    document.head.appendChild(script);
  });
}

function publisherClass(name) {
  if (!name) return "other";
  const lc = name.toLowerCase();
  if (lc.includes("marvel")) return "marvel";
  if (lc.includes("dc")) return "dc";
  return "other";
}

function renderCard(char) {
  const img = char.image?.medium_url || char.image?.small_url || "";
  const pub = char.publisher?.name || "";
  const realName = char.real_name || "";
  const deck = char.deck || "";

  const card = document.createElement("article");
  card.className = "char-card";
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", char.name);
  card.innerHTML = `
    ${img ? `<img src="${escHtml(img)}" alt="${escHtml(char.name)}" loading="lazy" />` : `<div style="aspect-ratio:3/4;background:#222"></div>`}
    <div class="char-card-body">
      <h3 class="char-card-name">${escHtml(char.name)}</h3>
      ${pub ? `<span class="char-card-publisher ${publisherClass(pub)}">${escHtml(pub)}</span>` : ""}
      ${deck ? `<p class="char-card-deck">${escHtml(deck)}</p>` : ""}
    </div>
  `;

  card.addEventListener("click", () => showDetail(char));
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") showDetail(char); });
  return card;
}

function showDetail(char) {
  const existing = document.querySelector(".char-detail");
  if (existing) existing.remove();

  const img = char.image?.medium_url || char.image?.small_url || "";
  const pub = char.publisher?.name || "";
  const realName = char.real_name || "";
  const firstIssue = char.first_appeared_in_issue?.name || char.first_appeared_in_issue?.issue_number || "";
  const firstVol = char.first_appeared_in_issue?.volume?.name || "";
  const appearances = char.count_of_issue_appearances || "";

  const detail = document.createElement("div");
  detail.className = "char-detail";

  const tags = [
    pub && `<span class="char-card-publisher ${publisherClass(pub)}">${escHtml(pub)}</span>`,
    realName && `<span class="char-detail-tag">Real name: ${escHtml(realName)}</span>`,
    (firstIssue || firstVol) && `<span class="char-detail-tag">First appeared: ${escHtml([firstVol, firstIssue].filter(Boolean).join(" #"))}</span>`,
    appearances && `<span class="char-detail-tag">${escHtml(String(appearances))} issue appearances</span>`,
  ].filter(Boolean).join("");

  detail.innerHTML = `
    ${img ? `<img class="char-detail-img" src="${escHtml(img)}" alt="${escHtml(char.name)}" />` : `<div style="background:#1b1e22;aspect-ratio:3/4"></div>`}
    <div class="char-detail-info">
      <button class="char-detail-back" data-detail-back>
        <i data-lucide="arrow-left"></i> Back to results
      </button>
      <h2 class="char-detail-name">${escHtml(char.name)}</h2>
      ${realName ? `<p class="char-detail-realname">${escHtml(realName)}</p>` : ""}
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

async function doSearch(query) {
  if (!query.trim()) { clearResults(); return; }

  showOnly(loadingEl);

  try {
    const url = `${CV_BASE}/characters/?api_key=${CV_KEY}&filter=name:${encodeURIComponent(query)}&field_list=${FIELD_LIST}&limit=20&sort=count_of_issue_appearances:desc`;
    const data = await jsonpFetch(url);

    if (data.status_code !== 1) {
      showOnly(errorEl);
      return;
    }

    const results = data.results || [];
    if (results.length === 0) {
      showOnly(emptyEl);
      return;
    }

    resultsEl.innerHTML = "";
    results.forEach((char) => resultsEl.appendChild(renderCard(char)));
    showOnly(resultsEl);
    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error("Search error:", err);
    showOnly(errorEl);
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
