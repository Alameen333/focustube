const STORE_KEY = "focustube-library-v1";
const API_KEY_STORE = "focustube-youtube-api-key";
const state = { channels: [], videos: [], apiKey: "", filter: "" };
const $ = (id) => document.getElementById(id);

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    state.channels = Array.isArray(saved.channels) ? saved.channels : [];
    state.videos = Array.isArray(saved.videos) ? saved.videos : [];
  } catch { state.channels = []; state.videos = []; }
  state.apiKey = localStorage.getItem(API_KEY_STORE) || "";
  $("api-key").value = state.apiKey;
}
function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify({channels:state.channels, videos:state.videos}));
}
function setStatus(message, error=false) {
  $("add-status").textContent = message;
  $("add-status").classList.toggle("error", error);
}
function parseChannelUrl(raw) {
  let url;
  try { url = new URL(raw.trim()); } catch { throw new Error("Please enter a valid YouTube channel URL."); }
  if (!/(^|\.)youtube\.com$/.test(url.hostname) && url.hostname !== "youtu.be") throw new Error("Please paste a YouTube channel URL.");
  const parts = url.pathname.split("/").filter(Boolean);
  if (!parts.length) throw new Error("That link doesn't look like a channel URL.");
  if (parts[0].startsWith("@")) return {kind:"handle", handle:parts[0].slice(1), url:raw.trim()};
  if (parts[0] === "channel" && parts[1]) return {kind:"id", id:parts[1], url:raw.trim()};
  if (parts[0] === "user" && parts[1]) return {kind:"username", username:parts[1], url:raw.trim()};
  if (parts[0] === "c" && parts[1]) return {kind:"custom", custom:parts[1], url:raw.trim()};
  throw new Error("Use a channel link such as youtube.com/@name or youtube.com/channel/UC…");
}
async function youtube(path, params={}) {
  if (!state.apiKey) throw new Error("Add a YouTube Data API key in Settings to load channel videos.");
  const query = new URLSearchParams({...params, key:state.apiKey});
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${query}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "YouTube API request failed.");
  return data;
}
async function resolveChannel(input) {
  if (input.kind === "id") {
    const data = await youtube("channels", {part:"snippet,contentDetails", id:input.id});
    if (!data.items?.length) throw new Error("Channel not found. Check the link.");
    return data.items[0];
  }
  if (input.kind === "handle") {
    const data = await youtube("channels", {part:"snippet,contentDetails", forHandle:input.handle});
    if (!data.items?.length) throw new Error("Channel not found. Check the handle.");
    return data.items[0];
  }
  if (input.kind === "username") {
    const data = await youtube("channels", {part:"snippet,contentDetails", forUsername:input.username});
    if (!data.items?.length) throw new Error("Channel not found. Try its @handle or channel ID link.");
    return data.items[0];
  }
  throw new Error("Custom /c/ links need to be replaced with the channel's @handle or /channel/UC… link.");
}
async function addChannel(event) {
  event.preventDefault();
  const button = $("channel-form").querySelector("button");
  button.disabled = true; button.textContent = "Checking…";
  try {
    const parsed = parseChannelUrl($("channel-url").value);
    const channel = await resolveChannel(parsed);
    if (state.channels.some(c => c.id === channel.id)) throw new Error("That channel is already approved.");
    state.channels.unshift({
      id:channel.id, title:channel.snippet.title, thumbnail:channel.snippet.thumbnails?.default?.url || "",
      uploads:channel.contentDetails.relatedPlaylists.uploads, url:`https://www.youtube.com/channel/${channel.id}`
    });
    persist(); $("channel-url").value = ""; renderChannels();
    setStatus(`Approved ${channel.snippet.title}. Loading its recent uploads…`);
    await refreshChannel(channel.id);
    renderVideos();
  } catch (error) { setStatus(error.message, true); }
  finally { button.disabled = false; button.textContent = "Approve channel"; }
}
async function refreshChannel(channelId) {
  const channel = state.channels.find(c=>c.id===channelId);
  if (!channel) return;
  const playlist = await youtube("playlistItems", {part:"snippet,contentDetails", playlistId:channel.uploads, maxResults:"12"});
  const ids = playlist.items.map(item=>item.contentDetails.videoId).filter(Boolean);
  if (!ids.length) return;
  const details = await youtube("videos", {part:"snippet,contentDetails", id:ids.join(",")});
  const allowed = details.items.filter(v=>v.snippet.channelId===channel.id);
  const byId = new Map(state.videos.map(v=>[v.id,v]));
  allowed.forEach(v=>byId.set(v.id, {
    id:v.id, channelId:v.snippet.channelId, title:v.snippet.title, channelTitle:v.snippet.channelTitle,
    publishedAt:v.snippet.publishedAt, thumbnail:v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || "",
    duration:v.contentDetails.duration
  }));
  state.videos = [...byId.values()].sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
  persist();
}
async function refreshAll() {
  if (!state.channels.length) { setStatus("Approve a channel first."); return; }
  setStatus("Refreshing approved channels…");
  for (const channel of [...state.channels]) {
    try { await refreshChannel(channel.id); }
    catch (e) { setStatus(`${channel.title}: ${e.message}`, true); }
  }
  renderVideos();
  if (state.videos.length) setStatus("Your approved-channel feed is up to date.");
}
function renderChannels() {
  $("channels-wrap").hidden = !state.channels.length;
  $("channels-list").innerHTML = "";
  state.channels.forEach(channel=>{
    const chip=document.createElement("div"); chip.className="channel-chip";
    const name=document.createElement("span"); name.textContent=channel.title;
    const remove=document.createElement("button"); remove.type="button"; remove.textContent="×"; remove.title=`Remove ${channel.title}`;
    remove.addEventListener("click",()=>{
      if(!confirm(`Remove ${channel.title} and its videos from FocusTube?`)) return;
      state.channels=state.channels.filter(c=>c.id!==channel.id);
      state.videos=state.videos.filter(v=>v.channelId!==channel.id);
      persist(); renderChannels(); renderVideos();
    });
    chip.append(name,remove); $("channels-list").append(chip);
  });
  updateCount();
}
function updateCount() {
  $("feed-count").textContent = `${state.videos.length} videos · ${state.channels.length} approved channels`;
}
function renderVideos() {
  const grid=$("video-grid"); grid.innerHTML="";
  const q=state.filter.toLowerCase();
  const approved=new Set(state.channels.map(c=>c.id));
  const videos=state.videos.filter(v=>approved.has(v.channelId) && (!q || `${v.title} ${v.channelTitle}`.toLowerCase().includes(q)));
  updateCount();
  if(!videos.length){
    const empty=document.createElement("div"); empty.className="empty-state";
    empty.innerHTML=`<div class="empty-icon">▤</div><h3>${state.channels.length?"No matching videos":"Your library is empty"}</h3><p>${state.channels.length?"Try another search or refresh your approved channels.":"Approve a channel above. Its recent uploads will appear here."}</p>`;
    grid.append(empty); return;
  }
  videos.forEach(video=>{
    const card=document.createElement("article"); card.className="video-card";
    const thumb=document.createElement("div"); thumb.className="thumb-wrap"; thumb.tabIndex=0; thumb.setAttribute("role","button"); thumb.setAttribute("aria-label",`Play ${video.title}`);
    const img=document.createElement("img"); img.src=video.thumbnail; img.alt=""; img.loading="lazy";
    const play=document.createElement("span"); play.className="play-mark"; play.textContent="▶"; thumb.append(img,play);
    const info=document.createElement("div"); info.className="video-info";
    const title=document.createElement("div"); title.className="video-title"; title.textContent=video.title;
    const channel=document.createElement("div"); channel.className="video-channel"; channel.textContent=video.channelTitle;
    const actions=document.createElement("div"); actions.className="video-actions";
    const watch=document.createElement("button"); watch.textContent="Watch"; watch.addEventListener("click",()=>openPlayer(video));
    const save=document.createElement("button"); save.textContent=video.saved?"✓ Saved":"＋ Watch later"; save.className=video.saved?"saved":"";
    save.addEventListener("click",()=>{video.saved=!video.saved;persist();renderVideos();});
    actions.append(watch,save); info.append(title,channel,actions); card.append(thumb,info);
    thumb.addEventListener("click",()=>openPlayer(video));
    thumb.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openPlayer(video);}});
    grid.append(card);
  });
}
function openPlayer(video) {
  $("player-title").textContent=video.title;
  $("player-channel").textContent=video.channelTitle;
  $("youtube-player").src=`https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}?autoplay=0&rel=0&modestbranding=1`;
  $("player-dialog").showModal();
}
function closePlayer(){ $("youtube-player").src=""; $("player-dialog").close(); }
$("channel-form").addEventListener("submit",addChannel);
$("settings-toggle").addEventListener("click",()=>{$("settings-panel").hidden=!$("settings-panel").hidden;});
$("api-form").addEventListener("submit",e=>{
  e.preventDefault(); state.apiKey=$("api-key").value.trim();
  if(state.apiKey)localStorage.setItem(API_KEY_STORE,state.apiKey);else localStorage.removeItem(API_KEY_STORE);
  setStatus(state.apiKey?"API key saved on this device. Refresh your channels to load videos.":"API key cleared.");
});
$("refresh-button").addEventListener("click",refreshAll);
$("filter-input").addEventListener("input",e=>{state.filter=e.target.value;renderVideos();});
$("close-player").addEventListener("click",closePlayer);
$("player-dialog").addEventListener("click",e=>{if(e.target===$("player-dialog"))closePlayer();});
$("export-button").addEventListener("click",()=>{
  const blob=new Blob([JSON.stringify({channels:state.channels,videos:state.videos},null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="focustube-library.json";a.click();URL.revokeObjectURL(a.href);
});
$("import-file").addEventListener("change",async e=>{
  const file=e.target.files[0];if(!file)return;
  try{const data=JSON.parse(await file.text());if(!Array.isArray(data.channels)||!Array.isArray(data.videos))throw new Error();
    state.channels=data.channels;state.videos=data.videos.filter(v=>state.channels.some(c=>c.id===v.channelId));persist();renderChannels();renderVideos();setStatus("Library imported.");
  }catch{setStatus("That file isn't a valid FocusTube export.",true);}e.target.value="";
});
loadState();renderChannels();renderVideos();
if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch(()=>{});
