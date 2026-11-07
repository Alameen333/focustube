
const STORE_KEY = "focustube-library-v1";
const API_KEY_STORE = "focustube-youtube-api-key";

const state = {
  channels: [],
  videos: [],
  apiKey: "",
  filter: ""
};

const $ = id => document.getElementById(id);

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    state.channels = Array.isArray(saved.channels) ? saved.channels : [];
    state.videos = Array.isArray(saved.videos) ? saved.videos : [];
  } catch {
    state.channels = [];
    state.videos = [];
  }

  state.apiKey = localStorage.getItem(API_KEY_STORE) || "";
  $("api-key").value = state.apiKey;
}

function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    channels: state.channels,
    videos: state.videos
  }));
}

function setStatus(message, error = false) {
  $("add-status").textContent = message;
  $("add-status").classList.toggle("error", error);
}

async function youtube(path, params = {}) {
  if (!state.apiKey) {
    throw new Error("Add your YouTube Data API key in Settings.");
  }

  const query = new URLSearchParams({
    ...params,
    key: state.apiKey
  });

  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/${path}?${query}`
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "YouTube API request failed.");
  }

  return data;
}

// CHANNEL APPROVAL

function parseChannelUrl(raw) {
  let url;

  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Enter a valid YouTube channel URL.");
  }

  if (!["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
    throw new Error("Please enter a YouTube channel URL.");
  }

  const parts = url.pathname.split("/").filter(Boolean);

  if (parts[0]?.startsWith("@")) {
    return { kind: "handle", handle: parts[0].slice(1) };
  }

  if (parts[0] === "channel" && parts[1]) {
    return { kind: "id", id: parts[1] };
  }

  if (parts[0] === "user" && parts[1]) {
    return { kind: "username", username: parts[1] };
  }

  throw new Error("Use a /@handle or /channel/UC... link.");
}

async function resolveChannel(input) {
  let params;

  if (input.kind === "handle") {
    params = { forHandle: input.handle };
  } else if (input.kind === "id") {
    params = { id: input.id };
  } else {
    params = { forUsername: input.username };
  }

  const data = await youtube("channels", {
    part: "snippet,contentDetails",
    ...params
  });

  if (!data.items?.length) {
    throw new Error("Channel not found. Check the link.");
  }

  return data.items[0];
}

async function addChannel(event) {
  event.preventDefault();

  const button = $("channel-form").querySelector("button");
  button.disabled = true;
  button.textContent = "Checking…";

  try {
    const parsed = parseChannelUrl($("channel-url").value);
    const channel = await resolveChannel(parsed);

    if (state.channels.some(c => c.id === channel.id)) {
      throw new Error("This channel is already approved.");
    }

    state.channels.unshift({
      id: channel.id,
      title: channel.snippet.title,
      thumbnail: channel.snippet.thumbnails?.default?.url || "",
      uploads: channel.contentDetails.relatedPlaylists.uploads,
      url: `https://www.youtube.com/channel/${channel.id}`
    });

    persist();
    $("channel-url").value = "";
    renderChannels();

    setStatus(`Approved ${channel.snippet.title}. Loading uploads…`);

    await refreshChannel(channel.id);
    renderVideos();

    setStatus(`Approved ${channel.snippet.title}.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Approve channel";
  }
}

// VIDEO DATA

function videoRecord(video, existing = {}) {
  return {
    id: video.id,
    channelId: video.snippet.channelId,
    title: video.snippet.title,
    channelTitle: video.snippet.channelTitle,
    publishedAt: video.snippet.publishedAt,
    thumbnail:
      video.snippet.thumbnails?.medium?.url ||
      video.snippet.thumbnails?.default?.url ||
      "",
    duration: video.contentDetails.duration,
    saved: existing.saved || false,
    watched: existing.watched || false,
    individualApproved: existing.individualApproved || false
  };
}

// LOAD ALL CHANNEL UPLOADS USING PAGINATION

async function refreshChannel(channelId) {
  const channel = state.channels.find(c => c.id === channelId);
  if (!channel) return;

  let pageToken = "";
  const existingById = new Map(state.videos.map(v => [v.id, v]));
  const refreshed = new Map();

  do {
    const params = {
      part: "snippet,contentDetails",
      playlistId: channel.uploads,
      maxResults: "50"
    };

    if (pageToken) params.pageToken = pageToken;

    const playlist = await youtube("playlistItems", params);

    const ids = (playlist.items || [])
      .map(item => item.contentDetails?.videoId)
      .filter(Boolean);

    if (ids.length) {
      const details = await youtube("videos", {
        part: "snippet,contentDetails",
        id: ids.join(",")
      });

      details.items.forEach(video => {
        if (video.snippet.channelId !== channelId) return;

        const old = existingById.get(video.id) || {};
        refreshed.set(video.id, videoRecord(video, old));
      });
    }

    pageToken = playlist.nextPageToken || "";
  } while (pageToken);

  // Keep individually approved videos even if not in this channel.
  const otherVideos = state.videos.filter(
    v => v.channelId !== channelId && v.individualApproved
  );

  // Preserve individually approved videos from this channel too.
  state.videos.forEach(v => {
    if (v.channelId === channelId && v.individualApproved && !refreshed.has(v.id)) {
      refreshed.set(v.id, v);
    }
  });

  state.videos = [...otherVideos, ...refreshed.values()]
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  persist();
}

// INDIVIDUAL VIDEO APPROVAL

function extractVideoId(raw) {
  let url;

  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Enter a valid YouTube video link.");
  }

  let id = "";

  if (url.hostname === "youtu.be") {
    id = url.pathname.split("/").filter(Boolean)[0] || "";
  } else if (
    ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)
  ) {
    if (url.pathname === "/watch") {
      id = url.searchParams.get("v") || "";
    } else {
      const parts = url.pathname.split("/").filter(Boolean);

      if (["shorts", "embed", "live"].includes(parts[0])) {
        id = parts[1] || "";
      }
    }
  }

  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    throw new Error("Couldn't find a valid video in that link.");
  }

  return id;
}

async function approveVideo(event) {
  event.preventDefault();

  const button = $("video-approval-form").querySelector("button");
  button.disabled = true;
  button.textContent = "Checking…";

  try {
    const id = extractVideoId($("video-url").value);

    const data = await youtube("videos", {
      part: "snippet,contentDetails",
      id
    });

    if (!data.items?.length) {
      throw new Error("Video not found or unavailable.");
    }

    const video = data.items[0];
    const existing = state.videos.find(v => v.id === id) || {};

    const record = videoRecord(video, existing);
    record.individualApproved = true;

    state.videos = [
      record,
      ...state.videos.filter(v => v.id !== id)
    ].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    persist();
    $("video-url").value = "";
    renderVideos();

    $("video-approval-status").textContent =
      `Approved: ${record.title}`;
  } catch (error) {
    $("video-approval-status").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Approve video";
  }
}

// REFRESH

async function refreshAll() {
  if (!state.channels.length) {
    setStatus("Approve a channel first.");
    return;
  }

  setStatus("Refreshing approved channels…");

  let failures = [];

  for (const channel of [...state.channels]) {
    try {
      await refreshChannel(channel.id);
    } catch (error) {
      failures.push(`${channel.title}: ${error.message}`);
    }
  }

  renderVideos();

  if (failures.length) {
    setStatus(failures.join(" | "), true);
  } else {
    setStatus("All approved channels refreshed.");
  }
}

// CHANNEL DISPLAY

function renderChannels() {
  $("channels-wrap").hidden = !state.channels.length;
  $("channels-list").innerHTML = "";

  state.channels.forEach(channel => {
    const chip = document.createElement("div");
    chip.className = "channel-chip";

    const name = document.createElement("span");
    name.textContent = channel.title;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = `Remove ${channel.title}`;

    remove.addEventListener("click", () => {
      if (!confirm(`Remove ${channel.title} and its channel-approved videos?`)) {
        return;
      }

      state.channels = state.channels.filter(c => c.id !== channel.id);

      // Individually approved videos remain.
      state.videos = state.videos.filter(
        v => v.channelId !== channel.id || v.individualApproved
      );

      persist();
      renderChannels();
      renderVideos();
    });

    chip.append(name, remove);
    $("channels-list").append(chip);
  });

  updateCount();
}

function updateCount() {
  $("feed-count").textContent =
    `${state.videos.filter(v =>
      state.channels.some(c => c.id === v.channelId) || v.individualApproved
    ).length} videos · ${state.channels.length} approved channels`;
}

// VIDEO DISPLAY

function renderVideos() {
  const grid = $("video-grid");
  grid.innerHTML = "";

  const query = state.filter.toLowerCase();

  const videos = state.videos.filter(video => {
    const approved =
      state.channels.some(c => c.id === video.channelId) ||
      video.individualApproved;

    return approved &&
      (!query ||
        `${video.title} ${video.channelTitle}`.toLowerCase().includes(query));
  });

  updateCount();

  if (!videos.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";

    empty.innerHTML = `
      <div class="empty-icon">▤</div>
      <h3>${state.channels.length ? "No matching videos" : "Your library is empty"}</h3>
      <p>Approve a channel or an individual video to get started.</p>
    `;

    grid.append(empty);
    return;
  }

  videos.forEach(video => {
    const card = document.createElement("article");
    card.className = "video-card";

    const thumb = document.createElement("div");
    thumb.className = "thumb-wrap";
    thumb.tabIndex = 0;
    thumb.setAttribute("role", "button");
    thumb.setAttribute("aria-label", `Play ${video.title}`);

    const img = document.createElement("img");
    img.src = video.thumbnail;
    img.alt = "";
    img.loading = "lazy";

    const play = document.createElement("span");
    play.className = "play-mark";
    play.textContent = "▶";

    thumb.append(img, play);

    const info = document.createElement("div");
    info.className = "video-info";

    const title = document.createElement("div");
    title.className = "video-title";
    title.textContent = video.title;

    const channel = document.createElement("div");
    channel.className = "video-channel";
    channel.textContent = video.channelTitle;

    const actions = document.createElement("div");
    actions.className = "video-actions";

    const watch = document.createElement("button");
    watch.textContent = "Watch";
    watch.addEventListener("click", () => openPlayer(video));

    const save = document.createElement("button");
    save.textContent = video.saved ? "✓ Saved" : "＋ Watch later";
    save.className = video.saved ? "saved" : "";

    save.addEventListener("click", () => {
      video.saved = !video.saved;
      persist();
      renderVideos();
    });

    actions.append(watch, save);
    info.append(title, channel, actions);
    card.append(thumb, info);

    thumb.addEventListener("click", () => openPlayer(video));

    thumb.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPlayer(video);
      }
    });

    grid.append(card);
  });
}

// PLAYER

function openPlayer(video) {
  $("player-title").textContent = video.title;
  $("player-channel").textContent = video.channelTitle;

  video.watched = true;
  persist();

  $("youtube-player").src =
    `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}?autoplay=0&rel=0&modestbranding=1`;

  $("player-dialog").showModal();
}

function closePlayer() {
  $("youtube-player").src = "";
  $("player-dialog").close();
}

// ADD VIDEO APPROVAL FORM TO EXISTING PAGE

function createVideoApprovalForm() {
  const section = document.createElement("section");
  section.className = "panel add-panel";

  section.innerHTML = `
    <div class="section-heading">
      <div>
        <h2>Approve an individual video</h2>
        <p>Allow one video without approving its entire channel.</p>
      </div>
      <span class="lock">VIDEO ONLY</span>
    </div>
    <form id="video-approval-form" class="add-form">
      <input id="video-url" type="url"
        placeholder="Paste a YouTube video link"
        autocomplete="url" required>
      <button type="submit">Approve video</button>
    </form>
    <p id="video-approval-status" class="status" aria-live="polite">
      Only videos you approve will appear here.
    </p>
  `;

  $("channel-form").closest(".panel").after(section);

  $("video-approval-form").addEventListener("submit", approveVideo);
}

// EVENTS

$("channel-form").addEventListener("submit", addChannel);

$("settings-toggle").addEventListener("click", () => {
  $("settings-panel").hidden = !$("settings-panel").hidden;
});

$("api-form").addEventListener("submit", event => {
  event.preventDefault();

  state.apiKey = $("api-key").value.trim();

  if (state.apiKey) {
    localStorage.setItem(API_KEY_STORE, state.apiKey);
  } else {
    localStorage.removeItem(API_KEY_STORE);
  }

  setStatus(
    state.apiKey
      ? "API key saved on this device."
      : "API key cleared."
  );
});

$("refresh-button").addEventListener("click", refreshAll);

$("filter-input").addEventListener("input", event => {
  state.filter = event.target.value;
  renderVideos();
});

$("close-player").addEventListener("click", closePlayer);

$("player-dialog").addEventListener("click", event => {
  if (event.target === $("player-dialog")) closePlayer();
});

$("export-button").addEventListener("click", () => {
  const blob = new Blob([
    JSON.stringify({
      channels: state.channels,
      videos: state.videos
    }, null, 2)
  ], { type: "application/json" });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = "focustube-library.json";
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$("import-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());

    if (!Array.isArray(data.channels) || !Array.isArray(data.videos)) {
      throw new Error();
    }

    state.channels = data.channels;
    state.videos = data.videos.filter(video =>
      state.channels.some(c => c.id === video.channelId) ||
      video.individualApproved === true
    );

    persist();
    renderChannels();
    renderVideos();
    setStatus("Library imported.");
  } catch {
    setStatus("Invalid FocusTube export file.", true);
  }

  event.target.value = "";
});

// START APP

loadState();
createVideoApprovalForm();
renderChannels();
renderVideos();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
