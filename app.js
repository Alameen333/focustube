const STORE_KEY = "focustube-library-v1";
const API_KEY_STORE = "focustube-youtube-api-key";

const state = {
  channels: [],
  videos: [],
  blockedVideos: [],
  apiKey: "",
  view: "home",
  filter: ""
};

const $ = id => document.getElementById(id);

function loadState() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    state.channels = Array.isArray(data.channels) ? data.channels : [];
    state.videos = Array.isArray(data.videos) ? data.videos : [];
    state.blockedVideos = Array.isArray(data.blockedVideos)
      ? data.blockedVideos : [];
  } catch {
    state.channels = [];
    state.videos = [];
    state.blockedVideos = [];
  }

  state.apiKey = localStorage.getItem(API_KEY_STORE) || "";
  $("api-key").value = state.apiKey;
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    channels: state.channels,
    videos: state.videos,
    blockedVideos: state.blockedVideos
  }));
}

function setStatus(message, error = false) {
  $("add-status").textContent = message;
  $("add-status").classList.toggle("error", error);
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function extractVideoId(input) {
  try {
    const url = new URL(input.trim());
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") return url.pathname.split("/")[1] || null;

    if (!["youtube.com", "m.youtube.com"].includes(host)) return null;

    if (url.pathname === "/watch") return url.searchParams.get("v");

    const match = url.pathname.match(/^\/(shorts|embed|live)\/([^/?]+)/);
    return match ? match[2] : null;
  } catch {
    return null;
  }
}

function parseChannelUrl(input) {
  const value = input.trim();

  if (/^@[\w.-]+$/.test(value)) return { handle: value };

  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");

    if (!["youtube.com", "m.youtube.com"].includes(host)) return null;

    const path = url.pathname;

    if (path.startsWith("/channel/")) {
      return { id: path.split("/")[2] };
    }

    if (path.startsWith("/@")) {
      return { handle: path.split("/")[1] };
    }

    if (path.startsWith("/user/")) {
      return { username: path.split("/")[2] };
    }

    return null;
  } catch {
    return null;
  }
}

async function apiRequest(endpoint, params) {
  if (!state.apiKey) throw new Error("Save your YouTube API key in Settings first.");

  const query = new URLSearchParams({
    ...params,
    key: state.apiKey
  });

  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/${endpoint}?${query}`
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "YouTube API request failed.");
  }

  return data;
}

async function resolveChannel(input) {
  const parsed = parseChannelUrl(input);
  if (!parsed) throw new Error("Enter a valid channel URL or @handle.");

  let params = {
    part: "snippet,contentDetails",
    maxResults: "1"
  };

  if (parsed.id) params.id = parsed.id;
  else if (parsed.handle) params.forHandle = parsed.handle;
  else if (parsed.username) params.forUsername = parsed.username;

  const data = await apiRequest("channels", params);
  if (!data.items?.length) throw new Error("Channel not found.");

  const channel = data.items[0];

  return {
    id: channel.id,
    title: channel.snippet.title,
    thumbnail: channel.snippet.thumbnails?.default?.url || "",
    uploadsId: channel.contentDetails.relatedPlaylists.uploads
  };
}

function makeVideoRecord(video, channel = null) {
  const existing = state.videos.find(v => v.id === video.id);

  return {
    id: video.id,
    title: video.snippet?.title || existing?.title || "Untitled video",
    channelId: video.snippet?.channelId || channel?.id || existing?.channelId || "",
    channelTitle: video.snippet?.channelTitle || channel?.title || existing?.channelTitle || "",
    thumbnail:
      video.snippet?.thumbnails?.medium?.url ||
      video.snippet?.thumbnails?.default?.url ||
      existing?.thumbnail || "",
    publishedAt: video.snippet?.publishedAt || existing?.publishedAt || "",
    saved: existing?.saved || false,
    watched: existing?.watched || false,
    watchedAt: existing?.watchedAt || null,
    individualApproved: existing?.individualApproved || false
  };
}

async function fetchChannelVideos(channel) {
  let pageToken = "";
  const ids = [];

  do {
    const params = {
      part: "snippet",
      playlistId: channel.uploadsId,
      maxResults: "50"
    };

    if (pageToken) params.pageToken = pageToken;

    const data = await apiRequest("playlistItems", params);

    for (const item of data.items || []) {
      const id = item.snippet?.resourceId?.videoId;
      if (id && !state.blockedVideos.includes(id)) ids.push(id);
    }

    pageToken = data.nextPageToken || "";
  } while (pageToken);

  const videos = [];

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);

    const data = await apiRequest("videos", {
      part: "snippet",
      id: batch.join(","),
      maxResults: "50"
    });

    videos.push(...data.items.map(video => makeVideoRecord(video, channel)));
  }

  return videos;
}

async function addChannel(event) {
  event.preventDefault();
  const input = $("channel-url").value.trim();

  try {
    setStatus("Finding channel...");
    const channel = await resolveChannel(input);

    if (state.channels.some(c => c.id === channel.id)) {
      setStatus("This channel is already approved.");
      return;
    }

    setStatus("Loading channel videos...");
    const videos = await fetchChannelVideos(channel);

    state.channels.push(channel);

    const byId = new Map(state.videos.map(v => [v.id, v]));
    videos.forEach(v => {
      const old = byId.get(v.id);
      byId.set(v.id, { ...v, ...old, channelId: channel.id });
    });

    state.videos = [...byId.values()];
    saveState();
    render();

    $("channel-url").value = "";
    setStatus(`Approved ${channel.title}. Loaded ${videos.length} videos.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function approveVideo(event) {
  event.preventDefault();
  const id = extractVideoId($("video-url").value);

  if (!id) {
    setStatus("Enter a valid YouTube video link.", true);
    return;
  }

  try {
    setStatus("Checking video...");
    const data = await apiRequest("videos", {
      part: "snippet",
      id
    });

    if (!data.items?.length) throw new Error("Video not found or unavailable.");

    const video = makeVideoRecord(data.items[0]);
    video.individualApproved = true;

    state.blockedVideos = state.blockedVideos.filter(x => x !== id);

    const index = state.videos.findIndex(v => v.id === id);
    if (index >= 0) state.videos[index] = video;
    else state.videos.push(video);

    saveState();
    render();

    $("video-url").value = "";
    setStatus("Video approved and added to your library.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function refreshChannel(channel) {
  const videos = await fetchChannelVideos(channel);
  const byId = new Map(state.videos.map(v => [v.id, v]));

  videos.forEach(video => {
    const old = byId.get(video.id);
    byId.set(video.id, { ...video, ...old, channelId: channel.id });
  });

  state.videos = [...byId.values()];
}

async function refreshAll() {
  const button = $("refresh-button");
  button.disabled = true;

  try {
    for (const channel of state.channels) {
      await refreshChannel(channel);
    }

    saveState();
    render();
    setStatus("All approved channels refreshed.");
  } catch (error) {
    saveState();
    render();
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function removeChannel(id) {
  const channel = state.channels.find(c => c.id === id);
  if (!channel || !confirm(`Remove ${channel.title} from approved channels?`)) return;

  state.channels = state.channels.filter(c => c.id !== id);

  // Keep videos individually approved by the user.
  state.videos = state.videos.filter(v =>
    v.channelId !== id || v.individualApproved
  );

  saveState();
  render();
}

function removeVideo(id) {
  const video = state.videos.find(v => v.id === id);
  if (!video) return;

  if (!confirm("Remove this video from your library?")) return;

  state.blockedVideos.push(id);
  state.videos = state.videos.filter(v => v.id !== id);

  saveState();
  render();
}

function toggleSaved(id) {
  const video = state.videos.find(v => v.id === id);
  if (!video) return;

  video.saved = !video.saved;
  saveState();
  render();
}

function openVideo(id) {
  const video = state.videos.find(v => v.id === id);
  if (!video) return;

  video.watched = true;
  video.watchedAt = new Date().toISOString();

  $("player-title").textContent = video.title;
  $("player-channel").textContent = video.channelTitle;
  $("youtube-player").src =
    `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1`;

  $("player-dialog").showModal();
  saveState();
  renderCounts();
}

function closePlayer() {
  $("youtube-player").src = "";
  $("player-dialog").close();
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav-button").forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  const titles = {
    home: "Home",
    saved: "Watch Later",
    history: "History",
    channels: "Channels"
  };

  $("view-title").textContent = titles[view];
  $("filter-input").placeholder =
    view === "channels" ? "Search channels" : "Search library";

  render();
}

function getVisibleVideos() {
  const query = state.filter.toLowerCase();

  let videos = state.videos.filter(video =>
    !state.blockedVideos.includes(video.id)
  );

  if (state.view === "saved") videos = videos.filter(v => v.saved);
  if (state.view === "history") {
    videos = videos.filter(v => v.watched);
    videos.sort((a, b) =>
      new Date(b.watchedAt || 0) - new Date(a.watchedAt || 0)
    );
  }

  if (query) {
    videos = videos.filter(v =>
      `${v.title} ${v.channelTitle}`.toLowerCase().includes(query)
    );
  }

  return videos;
}

function renderCounts() {
  const available = state.videos.filter(v =>
    !state.blockedVideos.includes(v.id)
  );

  $("home-count").textContent = available.length;
  $("saved-count").textContent = available.filter(v => v.saved).length;
  $("history-count").textContent = available.filter(v => v.watched).length;
  $("channel-count").textContent = state.channels.length;
}

function renderVideos() {
  const grid = $("video-grid");
  const videos = getVisibleVideos();

  $("channels-list").hidden = true;
  grid.hidden = false;
  $("feed-count").textContent = `${videos.length} videos`;

  if (!videos.length) {
    grid.innerHTML = `<div class="empty-state">
      <h3>Nothing here yet</h3>
      <p>Approve a channel or individual video to build your library.</p>
    </div>`;
    return;
  }

  grid.innerHTML = videos.map(video => `
    <article class="video-card">
      <img class="thumbnail"
        src="${escapeHTML(video.thumbnail)}"
        alt=""
        loading="lazy">
      <div class="video-info">
        <div class="video-title">${escapeHTML(video.title)}</div>
        <div class="video-channel">${escapeHTML(video.channelTitle)}</div>
      </div>
      <div class="card-actions">
        <button data-action="watch" data-id="${escapeHTML(video.id)}">Watch</button>
        <button class="secondary" data-action="save"
          data-id="${escapeHTML(video.id)}">
          ${video.saved ? "Saved ✓" : "Watch later"}
        </button>
        <button class="secondary remove" data-action="remove"
          data-id="${escapeHTML(video.id)}">Remove</button>
      </div>
    </article>
  `).join("");
}

function renderChannels() {
  $("video-grid").hidden = true;
  $("channels-list").hidden = false;

  const query = state.filter.toLowerCase();
  const channels = state.channels.filter(c =>
    c.title.toLowerCase().includes(query)
  );

  $("feed-count").textContent = `${channels.length} approved channels`;

  if (!channels.length) {
    $("channels-list").innerHTML = `
      <div class="empty-state">
        <h3>No approved channels</h3>
        <p>Add a channel above to start your library.</p>
      </div>`;
    return;
  }

  $("channels-list").innerHTML = channels.map(channel => `
    <article class="channel-card">
      <div>
        <strong>${escapeHTML(channel.title)}</strong>
        <p class="muted small">Approved channel</p>
      </div>
      <button class="secondary" data-action="remove-channel"
        data-id="${escapeHTML(channel.id)}">Remove</button>
    </article>
  `).join("");
}

function render() {
  renderCounts();

  if (state.view === "channels") renderChannels();
  else renderVideos();
}

function exportLibrary() {
  const data = {
    channels: state.channels,
    videos: state.videos,
    blockedVideos: state.blockedVideos
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "focustube-library.json";
  link.click();
  URL.revokeObjectURL(url);
}

async function importLibrary(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());

    if (!Array.isArray(data.channels) || !Array.isArray(data.videos)) {
      throw new Error("Invalid FocusTube backup.");
    }

    if (!confirm("Import this library? It will replace your current library.")) {
      event.target.value = "";
      return;
    }

    state.channels = data.channels;
    state.videos = data.videos;
    state.blockedVideos = Array.isArray(data.blockedVideos)
      ? data.blockedVideos : [];

    saveState();
    render();
    setStatus("Library imported successfully.");
  } catch (error) {
    setStatus(error.message, true);
  }

  event.target.value = "";
}

function setupEvents() {
  $("channel-form").addEventListener("submit", addChannel);
  $("video-form").addEventListener("submit", approveVideo);

  $("settings-toggle").addEventListener("click", () => {
    $("settings-panel").hidden = !$("settings-panel").hidden;
  });

  $("api-form").addEventListener("submit", event => {
    event.preventDefault();
    state.apiKey = $("api-key").value.trim();
    localStorage.setItem(API_KEY_STORE, state.apiKey);
    setStatus("API key saved in this browser.");
  });

  $("refresh-button").addEventListener("click", refreshAll);
  $("export-button").addEventListener("click", exportLibrary);
  $("import-file").addEventListener("change", importLibrary);

  $("filter-input").addEventListener("input", event => {
    state.filter = event.target.value;
    render();
  });

  document.querySelectorAll(".nav-button").forEach(button => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  $("video-grid").addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const { action, id } = button.dataset;

    if (action === "watch") openVideo(id);
    if (action === "save") toggleSaved(id);
    if (action === "remove") removeVideo(id);
  });

  $("channels-list").addEventListener("click", event => {
    const button = event.target.closest("button[data-action='remove-channel']");
    if (button) removeChannel(button.dataset.id);
  });

  $("close-player").addEventListener("click", closePlayer);
  $("player-dialog").addEventListener("click", event => {
    if (event.target === $("player-dialog")) closePlayer();
  });
}

loadState();
setupEvents();
render();