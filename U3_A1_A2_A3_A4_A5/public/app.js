const COLLECTION_KEY = "fieldnotes.collection.v1";
const state = {
  topics: [],
  discussions: {},
  view: "discover",
  selectedTopic: null,
  discussionTopic: "",
  saved: [],
  query: "",
  artifactUrl: null,
};

const byId = (id) => document.getElementById(id);
const main = byId("main-area");
const root = byId("view-root");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function prettyDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
  return response.json();
}

function toast(message) {
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  byId("toast-region").append(item);
  window.setTimeout(() => item.remove(), 3400);
}

function readCollection() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLECTION_KEY) || "[]");
    if (!Array.isArray(saved)) throw new TypeError("Saved collection must be a list.");
    return saved.filter((item) => item && typeof item.id === "string" && ["favorite", "bookmark"].includes(item.kind));
  } catch (error) {
    console.error("Could not read the saved collection:", error);
    return [];
  }
}

function persistCollection() {
  try {
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(state.saved));
  } catch (error) {
    console.error("Could not save the collection in this browser:", error);
    toast("Your browser couldn't save this collection.");
  }
}

function card(topic, kind = "") {
  const isFavorite = state.saved.some((item) => item.id === topic.id && item.kind === "favorite");
  return `<article class="topic-card" data-topic-card="${escapeHtml(topic.id)}">
    <div class="card-meta"><span class="topic-category">${escapeHtml(topic.category)}</span><span>${topic.readMinutes} MIN READ</span></div>
    <h3>${escapeHtml(topic.title)}</h3>
    <p>${escapeHtml(topic.summary)}</p>
    <div class="card-bottom">
      <span class="card-read">${escapeHtml(topic.themeLabel || "Research")}</span>
      <button class="card-open" data-open-topic="${escapeHtml(topic.id)}">Explore <span>↗</span></button>
      <button class="icon-button card-save ${isFavorite ? "is-saved" : ""}" data-favorite="${escapeHtml(topic.id)}" aria-label="${isFavorite ? "Remove favorite" : "Add favorite"}">${isFavorite ? "♥" : "♡"}</button>
    </div>
    ${kind ? `<span class="saved-kind">${escapeHtml(kind)}</span>` : "" }
  </article>`;
}

function emptyState(title, message) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`;
}

function renderDiscover() {
  const visible = state.topics.filter((topic) => {
    const text = `${topic.title} ${topic.category} ${topic.summary} ${topic.themeLabel}`.toLowerCase();
    return text.includes(state.query.toLowerCase());
  });
  const featured = visible.find((topic) => topic.featured) || visible[0] || state.topics[0];
  if (featured) main.dataset.theme = featured.theme;
  const rest = visible.filter((topic) => topic.id !== featured?.id);
  root.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">A living notebook for curious minds</span>
        <h1>Follow the <span class="hero-topic">${escapeHtml(featured?.themeLabel || "evidence")}.</span><br>Find the story.</h1>
        <p>Research is better when it stays curious. Explore carefully gathered fieldnotes, trace the sources, and follow the questions that matter to you.</p>
        <button class="button hero-cta" data-open-topic="${escapeHtml(featured?.id || "")}">Open today's fieldnote <span>↗</span></button>
      </div>
      <div class="hero-art" aria-hidden="true"><span class="hero-orb"></span><span class="hero-horizon"></span><span class="hero-star">✳</span><span class="hero-star two">✳</span></div>
      <span class="hero-index">FIELDNOTE NO. ${String(state.topics.indexOf(featured) + 1).padStart(2, "0")} &nbsp; / &nbsp; ${escapeHtml(featured?.category || "THE ARCHIVE").toUpperCase()}</span>
    </section>
    <section class="section-heading">
      <div><span class="eyebrow">${state.query ? "SEARCH RESULTS" : "A FEW THREADS TO FOLLOW"}</span><h2>${state.query ? "From the fieldnotes" : "Start with a question"}</h2></div>
      <button class="text-link" data-view="saved">Your collection ↗</button>
    </section>
    ${visible.length ? `<div class="topic-grid">${(state.query ? visible : rest).map((topic) => card(topic)).join("")}</div>` : emptyState("No fieldnotes found", "Try another search term or explore all topics.")}`;
  if (state.query && featured) root.querySelector(".hero")?.classList.add("search-hero");
}

function renderSaved() {
  const collection = state.saved.map((item) => ({
    ...state.topics.find((topic) => topic.id === item.id),
    kind: item.kind,
  })).filter((item) => item.id);
  main.dataset.theme = collection[0]?.theme || "history";
  const favorites = collection.filter((item) => item.kind === "favorite");
  const bookmarks = collection.filter((item) => item.kind === "bookmark");
  root.innerHTML = `<section class="page-intro"><span class="eyebrow">SAVED IN THIS BROWSER</span><h1>Keep the good questions close.</h1><p>Your collection is stored only on this device. No account needed.</p></section>
    <section class="section-heading"><div><span class="eyebrow">FAVORITES</span><h2>Close to your heart</h2></div></section>
    ${favorites.length ? `<div class="topic-grid">${favorites.map((item) => card(item, "favorite")).join("")}</div>` : emptyState("No favorites yet", "Tap the heart on a topic to add it here.")}
    <section class="section-heading"><div><span class="eyebrow">READ LATER</span><h2>Saved for another day</h2></div></section>
    ${bookmarks.length ? `<div class="topic-grid">${bookmarks.map((item) => card(item, "bookmark")).join("")}</div>` : emptyState("Nothing tucked away", "Use the bookmark action on a topic to save it for later.")}`;
}

function discussionMarkup(topicId) {
  const items = state.discussions[topicId] || [];
  if (!items.length) return emptyState("A fresh page", "No public discussion has been published for this fieldnote yet.");
  return `<div class="thread-list">${items.map((thread) => `<article class="thread-card">
    <h3>${escapeHtml(thread.title)}</h3><p class="thread-byline">${escapeHtml(thread.author?.name || "Community")} · ${prettyDate(thread.createdAt)}</p>
    <p>${escapeHtml(thread.body)}</p>
    <div class="comment-list">${(thread.comments || []).map((comment) => `<div class="comment-line"><strong>${escapeHtml(comment.author_name || "Community")}</strong>: ${escapeHtml(comment.body)}</div>`).join("")}</div>
  </article>`).join("")}</div>`;
}

function renderDetail(topic) {
  main.dataset.theme = topic.theme;
  const paragraphs = topic.content.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
  const favorite = state.saved.some((item) => item.id === topic.id && item.kind === "favorite");
  const bookmarked = state.saved.some((item) => item.id === topic.id && item.kind === "bookmark");
  root.innerHTML = `<button class="detail-back" data-view="discover">← &nbsp; Back to the fieldnotes</button>
    <header class="detail-header"><span class="eyebrow">${escapeHtml(topic.themeLabel)} &nbsp; / &nbsp; ${escapeHtml(topic.category)}</span>
      <h1>${escapeHtml(topic.title)}</h1><p class="detail-summary">${escapeHtml(topic.summary)}</p>
      <div class="detail-meta"><span>${topic.readMinutes} minute read</span><span>✳ Carefully sourced</span>${topic.createdAt ? `<span>Updated ${prettyDate(topic.createdAt)}</span>` : ""}</div>
    </header>
    <div class="detail-actions">
      <button class="button ${favorite ? "button-accent" : "button-light"}" data-favorite="${escapeHtml(topic.id)}">${favorite ? "♥ In your favorites" : "♡ Add favorite"}</button>
      <button class="button ${bookmarked ? "button-accent" : "button-light"}" data-bookmark="${escapeHtml(topic.id)}">${bookmarked ? "▣ Saved to read later" : "▢ Read later"}</button>
      <button class="button button-light" data-load-artifact="${escapeHtml(topic.id)}">View field illustration <span>↗</span></button>
    </div>
    <div class="artifact-frame hidden" id="artifact-frame"><img alt="Research field illustration"></div>
    <div class="article-columns"><article class="article-body">${paragraphs}</article>
      <aside class="article-aside"><h3>Trace the source</h3><p>Curiosity deserves a paper trail. Start with this source and follow its references for a fuller picture.</p><div class="source-mark"><span>↗</span><span>${escapeHtml(topic.source)}</span></div><div class="source-mark"><span>✳</span><span>Approach every claim with context. Distinguish evidence from interpretation.</span></div></aside>
    </div>
    <section class="discussion-panel"><span class="eyebrow">THINKING TOGETHER</span><h2>Notes from the community</h2><p class="panel-description">Discussions are shown publicly in read-only mode.</p><div id="discussion-content">${discussionMarkup(topic.id)}</div></section>`;
}

function renderDiscussionPage() {
  const topic = state.topics.find((item) => item.id === state.discussionTopic) || state.topics[0];
  if (!topic) {
    root.innerHTML = emptyState("No topics yet", "When research is added to the archive, its discussions will live here.");
    return;
  }
  state.discussionTopic = topic.id;
  main.dataset.theme = topic.theme;
  root.innerHTML = `<section class="page-intro"><span class="eyebrow">THE COMMON ROOM</span><h1>Good ideas get better in conversation.</h1><p>Read the public notes attached to each research topic.</p></section>
    <div class="form-field discussion-topic-control"><label for="discussion-topic">Choose a fieldnote</label><select id="discussion-topic">${state.topics.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === topic.id ? "selected" : ""}>${escapeHtml(item.title)}</option>`).join("")}</select></div>
    <div id="discussion-page-content">${discussionMarkup(topic.id)}</div>`;
}

function renderView() {
  document.querySelectorAll(".nav-link").forEach((item) => item.classList.toggle("is-active", item.dataset.view === state.view));
  const labels = { discover: "Discover", saved: "My collection", discussions: "Discussions" };
  byId("current-crumb").textContent = labels[state.view] || "Discover";
  if (state.view === "discover") renderDiscover();
  if (state.view === "saved") renderSaved();
  if (state.view === "discussions") renderDiscussionPage();
}

function switchView(view) {
  if (!["discover", "saved", "discussions"].includes(view)) return;
  state.view = view;
  state.selectedTopic = null;
  if (state.artifactUrl) URL.revokeObjectURL(state.artifactUrl);
  state.artifactUrl = null;
  renderView();
}

function openTopic(topicId) {
  const topic = state.topics.find((item) => item.id === topicId);
  if (!topic) return;
  state.selectedTopic = topic;
  state.view = "detail";
  document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("is-active"));
  byId("current-crumb").textContent = topic.category;
  renderDetail(topic);
}

function toggleSaved(kind, topicId) {
  const exists = state.saved.some((item) => item.id === topicId && item.kind === kind);
  state.saved = state.saved.filter((item) => item.id !== topicId || item.kind !== kind);
  if (!exists) state.saved.push({ id: topicId, kind });
  persistCollection();
  byId("saved-count").textContent = String(state.saved.length);
  if (state.view === "detail" && state.selectedTopic) renderDetail(state.selectedTopic);
  else renderView();
  toast(exists ? "Removed from your collection." : kind === "favorite" ? "Added to your favorites." : "Saved for another day.");
}

function svgForTopic(topic) {
  const palettes = {
    egypt: ["#172a28", "#dbad67", "#e7d3aa"],
    ocean: ["#102d38", "#6db1b0", "#d4ece7"],
    space: ["#15172b", "#9d8bd4", "#e3dafa"],
    forest: ["#1b3028", "#87a983", "#e0ead8"],
    history: ["#30231f", "#c58d6f", "#f0d7c5"],
  };
  const [background, accent, foreground] = palettes[topic.theme] || palettes.history;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 420" role="img" aria-label="Research field illustration"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="${background}"/><stop offset="1" stop-color="#293b39"/></linearGradient></defs><rect width="760" height="420" fill="url(#g)"/><circle cx="570" cy="145" r="95" fill="${accent}" opacity=".82"/><path d="M0 315 Q155 230 285 316T560 290T760 300V420H0Z" fill="${foreground}" opacity=".24"/><path d="M0 354 Q160 285 310 352T610 338T760 326V420H0Z" fill="${foreground}" opacity=".35"/><path d="M82 287V161h114v126m-89 0v-83h63v83M260 290V195h42v95m-62-95 83-71 83 71m-47 95v-58h32v58" fill="none" stroke="${foreground}" stroke-width="8" opacity=".78"/><text x="54" y="376" fill="white" font-family="Georgia,serif" font-size="21" opacity=".92">${escapeHtml(topic.title)}</text></svg>`;
}

function loadArtifact(topicId) {
  const topic = state.topics.find((item) => item.id === topicId);
  const frame = byId("artifact-frame");
  if (!topic || !frame) return;
  if (state.artifactUrl) URL.revokeObjectURL(state.artifactUrl);
  state.artifactUrl = URL.createObjectURL(new Blob([svgForTopic(topic)], { type: "image/svg+xml" }));
  frame.querySelector("img").src = state.artifactUrl;
  frame.classList.remove("hidden");
  frame.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.view) return switchView(target.dataset.view);
  if (target.dataset.openTopic) return openTopic(target.dataset.openTopic);
  if (target.dataset.favorite) return toggleSaved("favorite", target.dataset.favorite);
  if (target.dataset.bookmark) return toggleSaved("bookmark", target.dataset.bookmark);
  if (target.dataset.loadArtifact) return loadArtifact(target.dataset.loadArtifact);
});

byId("search-input").addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  if (state.view !== "discover") switchView("discover");
  else renderDiscover();
});

byId("search-input").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.target.value = "";
    state.query = "";
    renderDiscover();
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id !== "discussion-topic") return;
  state.discussionTopic = event.target.value;
  renderDiscussionPage();
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    byId("search-input").focus();
  }
});

async function initialize() {
  try {
    const [topics, discussions] = await Promise.all([
      loadJson("/topics.json"),
      loadJson("/discussions.json"),
    ]);
    if (!Array.isArray(topics)) throw new TypeError("The public topic archive has an invalid format.");
    state.topics = topics;
    state.discussions = discussions && typeof discussions === "object" ? discussions : {};
    state.saved = readCollection();
    byId("saved-count").textContent = String(state.saved.length);
    renderDiscover();
  } catch (error) {
    console.error("The public archive could not be loaded:", error);
    root.innerHTML = `<div class="empty-state"><strong>The research desk is unavailable.</strong><p>${escapeHtml(error.message)} Refresh the page or check the deployment files.</p></div>`;
  }
}

initialize();
