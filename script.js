/* ============================================================
   Reel Words — script.js
   Dictionary content (definitions, phonetics, examples, synonyms,
   antonyms, pronunciation audio) is fetched live from the
   Free Dictionary API, with a Datamuse fallback for words the
   primary API doesn't have. No dictionary content is hardcoded.

   User progress (XP, CEFR level, word statuses, quiz results,
   learning time, achievements) is persisted to localStorage so
   it survives a page reload. A future version could swap this
   for a real backend (Firebase / Supabase / MongoDB) — see
   saveState()/loadState() below for the single place that
   would need to change.
   ============================================================ */

const API_BASE = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const DATAMUSE_BASE = "https://api.datamuse.com/words";
const STORAGE_KEY = "reelwords_state_v1";

/* A short list of words used to seed search chips / grammar chips and
   to top up the quiz pool when the user hasn't studied enough words
   yet. Just a word list — all real content is fetched from the APIs. */
const SUGGESTED_WORDS = ["eloquent", "reluctant", "thriving", "negotiate", "overwhelmed", "persistent"];

/* Per-word CEFR levels (Phase 3) and the word-category catalog are loaded
   from external JSON files instead of being hardcoded here. cefr.json in
   this build is a small starter list, not the full ~50,000-word set the
   spec describes — words missing from it show as "Unrated" rather than a
   guessed level. */
let CEFR_MAP = {};
let CATEGORIES = [];
async function loadStaticData(){
  try{ CEFR_MAP = await (await fetch("cefr.json")).json(); }
  catch(err){ console.warn("Could not load cefr.json", err); }
  try{ CATEGORIES = await (await fetch("categories.json")).json(); }
  catch(err){ console.warn("Could not load categories.json", err); CATEGORIES = []; }
  if(state.tab==="dashboard") renderDashboard();
}

const CEFR_THRESHOLDS = [
  {code:"A1", title:"Beginner", max:500},
  {code:"A2", title:"Elementary", max:1000},
  {code:"B1", title:"Intermediate", max:2500},
  {code:"B2", title:"Upper Intermediate", max:5000},
  {code:"C1", title:"Advanced", max:8000},
  {code:"C2", title:"Mastery", max:Infinity}
];

const ACHIEVEMENTS = [
  {ic:"🎬", name:"First Movie Word", key:"first"},
  {ic:"📚", name:"100 Words Learned", key:"words100"},
  {ic:"🔥", name:"7 Day Streak", key:"streak7"},
  {ic:"🏆", name:"B1 Achieved", key:"b1"},
  {ic:"🎯", name:"Grammar Master", key:"grammarMaster"},
  {ic:"🎯", name:"Perfect Quiz", key:"perfect"},
  {ic:"⏱️", name:"10 Hours", key:"hours10"},
  {ic:"🏅", name:"50 Hours", key:"hours50"},
  {ic:"👑", name:"100 Hours (Advanced)", key:"hours100"}
];

/* ---------------- DEFAULT STATE (brand-new user) ---------------- */
function defaultState(){
  return {
    xp:0,
    streak:0,
    lastActiveDate:null,
    quizzesCompleted:0,
    grammarCompleted:0,
    clipsWatched:0,
    quizCorrect:0, quizTotal:0,
    unlocked:[],
    savedExamples:[],
    totalSeconds:0, todaySeconds:0, weekSeconds:0, monthSeconds:0,
    history:[],
    weekly:[0,0,0,0,0,0,0],
    /* words: { [word]: {status, attempts, correct, lastReviewed, firstSeen, progress} } */
    words:{},
    timer:{ elapsed:0, lastXpAward:0 } // running state itself is not persisted across reloads
  };
}

/* ---------------- PERSISTENCE ---------------- */
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    // merge onto defaults so new fields introduced later don't break old saves
    return Object.assign(defaultState(), parsed, {
      timer:{ elapsed:0, lastXpAward:0 } // never resume a running timer across reloads
    });
  }catch(err){
    console.warn("Could not read saved progress, starting fresh.", err);
    return defaultState();
  }
}
let saveTimeout = null;
let currentUser = null; // set by initAuth() once Firebase reports a signed-in user
function saveState(){
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(()=>{
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch(err){ console.warn("Could not save progress locally.", err); }
    if(currentUser && window.ReelWordsCloud && window.ReelWordsCloud.enabled){
      window.ReelWordsCloud.syncStateToCloud(currentUser.uid, state).catch(err=>console.warn("Cloud sync failed", err));
    }
  }, 150);
}

const state = loadState();
const XP_PER_LEVEL = 100; // used only for the "gamer level" progress bar, separate from CEFR

/* daily streak bookkeeping */
(function trackDailyStreak(){
  const today = new Date().toDateString();
  if(state.lastActiveDate !== today){
    const wasYesterday = state.lastActiveDate && (new Date(today) - new Date(state.lastActiveDate)) <= 1000*60*60*36;
    state.streak = wasYesterday ? state.streak + 1 : (state.lastActiveDate ? 1 : state.streak);
    state.lastActiveDate = today;
    saveState();
  }
})();

/* Cache of already-fetched dictionary entries (session-only; re-fetched on reload). */
const wordCache = new Map();

/* ---------------- WORD STATUS HELPERS ---------------- */
function getWordRecord(word){
  const key = word.trim().toLowerCase();
  if(!state.words[key]){
    state.words[key] = { status:"new", attempts:0, correct:0, lastReviewed:null, firstSeen:new Date().toISOString(), progress:0 };
  }
  return state.words[key];
}
function setWordStatus(word, status){
  const rec = getWordRecord(word);
  rec.status = status;
  if(status === "learning" && rec.progress < 20) rec.progress = 20;
  if(status === "learned") rec.progress = 100;
  saveState();
}
function recordAttempt(word, correct){
  const rec = getWordRecord(word);
  rec.attempts++;
  if(correct) rec.correct++;
  rec.lastReviewed = new Date().toISOString();
  if(rec.status === "new") rec.status = "learning";
  rec.progress = Math.min(95, rec.attempts * 20 + (correct?10:0));
  saveState();
}
function wordsByStatus(status){
  return Object.entries(state.words).filter(([,r])=>r.status===status).map(([w])=>w);
}

/* ---------------- CEFR ---------------- */
function cefrInfo(){
  const learnedCount = wordsByStatus("learned").length;
  let prevMax = 0;
  for(const tier of CEFR_THRESHOLDS){
    if(learnedCount < tier.max){
      const span = tier.max === Infinity ? Math.max(1, learnedCount - prevMax) : (tier.max - prevMax);
      const into = learnedCount - prevMax;
      const pct = tier.max === Infinity ? 100 : Math.round(100*into/span);
      const idx = CEFR_THRESHOLDS.indexOf(tier);
      const nextTier = CEFR_THRESHOLDS[idx+1];
      return {
        code:tier.code, title:tier.title, learnedCount,
        wordsNeeded: tier.max === Infinity ? 0 : tier.max - learnedCount,
        pct: Math.max(0, Math.min(100, pct)),
        nextCode: tier.max === Infinity ? null : (nextTier ? nextTier.code : null)
      };
    }
    prevMax = tier.max;
  }
}

/* ---------------- API ---------------- */
async function fetchWordEntry(word){
  const key = word.trim().toLowerCase();
  if(wordCache.has(key)) return wordCache.get(key);

  let parsed;
  try{
    parsed = await fetchFromFreeDictionary(key);
  }catch(primaryErr){
    try{
      parsed = await fetchFromDatamuse(key);
    }catch(fallbackErr){
      throw new Error(primaryErr.message === "not-found" && fallbackErr.message === "not-found" ? "not-found" : "request-failed");
    }
  }
  wordCache.set(key, parsed);
  return parsed;
}

async function fetchFromFreeDictionary(key){
  const res = await fetch(API_BASE + encodeURIComponent(key));
  if(!res.ok) throw new Error(res.status === 404 ? "not-found" : "request-failed");
  const data = await res.json();
  return parseFreeDictionaryResponse(data);
}

function parseFreeDictionaryResponse(data){
  const entry = data[0];
  const phoneticsWithAudio = (entry.phonetics || []).filter(p => p.audio);
  const uk = phoneticsWithAudio.find(p => /uk/i.test(p.audio)) || phoneticsWithAudio[0] || null;
  const us = phoneticsWithAudio.find(p => /us/i.test(p.audio)) || phoneticsWithAudio.find(p => p !== uk) || uk;

  const meanings = entry.meanings || [];
  const firstMeaning = meanings[0] || {};
  const firstDef = (firstMeaning.definitions || [])[0] || {};

  const examples = [];
  meanings.forEach(m=>{
    (m.definitions || []).forEach(d=>{
      if(d.example){ examples.push({ tag: m.partOfSpeech || "usage", text: d.example }); }
    });
  });

  const synonyms = new Set(); const antonyms = new Set();
  meanings.forEach(m=>{
    (m.synonyms||[]).forEach(s=>synonyms.add(s));
    (m.antonyms||[]).forEach(a=>antonyms.add(a));
    (m.definitions||[]).forEach(d=>{
      (d.synonyms||[]).forEach(s=>synonyms.add(s));
      (d.antonyms||[]).forEach(a=>antonyms.add(a));
    });
  });

  return {
    word: entry.word,
    source:"Free Dictionary API",
    phonetic: entry.phonetic || (phoneticsWithAudio[0] && phoneticsWithAudio[0].text) || "",
    pos: firstMeaning.partOfSpeech || "",
    posList: Array.from(new Set(meanings.map(m=>m.partOfSpeech).filter(Boolean))),
    definition: firstDef.definition || "No definition available.",
    audioUk: uk ? uk.audio : null,
    audioUs: us ? us.audio : null,
    examples: examples.slice(0, 4),
    synonyms: Array.from(synonyms).slice(0, 6),
    antonyms: Array.from(antonyms).slice(0, 6)
  };
}

/* Fallback source: Datamuse (no key required). Used when the Free
   Dictionary API has no entry for the word. Datamuse doesn't provide
   audio or example sentences, so those stay empty and the UI falls
   back to browser speech synthesis for pronunciation. */
async function fetchFromDatamuse(key){
  const defRes = await fetch(`${DATAMUSE_BASE}?sp=${encodeURIComponent(key)}&md=dp&max=1`);
  if(!defRes.ok) throw new Error("request-failed");
  const defData = await defRes.json();
  if(!defData.length || !defData[0].defs || !defData[0].defs.length) throw new Error("not-found");

  const POS_MAP = { n:"noun", v:"verb", adj:"adjective", adv:"adverb", u:"other" };
  const defs = defData[0].defs.map(d=>{
    const [code, text] = d.split("\t");
    return { pos: POS_MAP[code] || code, definition: text };
  });

  const [synRes, antRes] = await Promise.all([
    fetch(`${DATAMUSE_BASE}?rel_syn=${encodeURIComponent(key)}&max=6`).then(r=>r.ok?r.json():[]).catch(()=>[]),
    fetch(`${DATAMUSE_BASE}?rel_ant=${encodeURIComponent(key)}&max=6`).then(r=>r.ok?r.json():[]).catch(()=>[])
  ]);

  return {
    word:key,
    source:"Datamuse (fallback)",
    phonetic:"",
    pos: defs[0].pos,
    posList: Array.from(new Set(defs.map(d=>d.pos))),
    definition: defs[0].definition,
    audioUk:null, audioUs:null,
    examples:[],
    synonyms: synRes.map(s=>s.word).slice(0,6),
    antonyms: antRes.map(a=>a.word).slice(0,6)
  };
}

/* ---------------- HELPERS ---------------- */
function fmtHM(totalSec){
  const h = Math.floor(totalSec/3600), m = Math.floor((totalSec%3600)/60);
  if(h<=0) return `${m}m`;
  return `${h}h ${m}m`;
}
function fmtHMS(totalSec){
  const h=String(Math.floor(totalSec/3600)).padStart(2,"0");
  const m=String(Math.floor((totalSec%3600)/60)).padStart(2,"0");
  const s=String(totalSec%60).padStart(2,"0");
  return `${h}:${m}:${s}`;
}
function showToast(msg){
  const t=document.getElementById("toast"); t.textContent=msg; t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"), 2500);
}
function unlock(key){
  if(state.unlocked.includes(key)) return;
  state.unlocked.push(key);
  saveState();
  const a = ACHIEVEMENTS.find(x=>x.key===key);
  if(a) showToast("🏅 Achievement unlocked: "+a.name);
  if(state.tab==="dashboard") renderDashboard();
}
function checkWordAchievements(){
  const learned = wordsByStatus("learned").length;
  if(learned>=1) unlock("first");
  if(learned>=100) unlock("words100");
}
function checkCefrAchievements(){
  const cefr = cefrInfo();
  const order = CEFR_THRESHOLDS.map(t=>t.code);
  if(order.indexOf(cefr.code) >= order.indexOf("B1")) unlock("b1");
}
function awardXP(amount){
  state.xp += amount;
  saveState();
  checkWordAchievements();
  checkCefrAchievements();
  if(state.streak>=7) unlock("streak7");
  if(state.tab==="dashboard") renderDashboard();
}

/* Pronunciation: play API audio if we have it, otherwise fall back to
   the browser's built-in speech synthesis. */
function playPronunciation(word, audioUrl, accentLang){
  if(audioUrl){
    new Audio(audioUrl).play().catch(()=> speakFallback(word, accentLang));
    return;
  }
  speakFallback(word, accentLang);
}
function speakFallback(word, accentLang){
  if(!("speechSynthesis" in window)){
    showToast("Pronunciation audio isn't available for this word.");
    return;
  }
  const utter = new SpeechSynthesisUtterance(word);
  utter.lang = accentLang || "en-US";
  const voices = window.speechSynthesis.getVoices();
  const match = voices.find(v => v.lang === utter.lang) || voices.find(v => v.lang && v.lang.startsWith("en"));
  if(match) utter.voice = match;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

/* ---------------- AUTH (Phase 9) & CLOUD PROFILE (Phase 8) ---------------- */
const authOverlay = document.getElementById("authOverlay");
const authCard = document.getElementById("authCard");
function closeAuthModal(){ authOverlay.classList.remove("show"); authCard.innerHTML=""; }

function initAuth(){
  if(!window.ReelWordsCloud){
    // firebase-sync.js hasn't finished evaluating yet in this load — retry shortly.
    setTimeout(initAuth, 50);
    return;
  }
  window.ReelWordsCloud.onAuthChange(async user=>{
    currentUser = user;
    updateAuthUI();
    if(user && window.ReelWordsCloud.enabled){
      try{
        const cloud = await window.ReelWordsCloud.loadStateFromCloud(user.uid);
        if(cloud){ Object.assign(state, cloud, { timer:{elapsed:0,lastXpAward:0} }); }
        else { window.ReelWordsCloud.syncStateToCloud(user.uid, state).catch(()=>{}); }
      }catch(err){ console.warn("Could not load cloud progress", err); }
      renderDashboard();
    }
  });
}

function updateAuthUI(){
  const area = document.getElementById("authArea");
  if(currentUser){
    const label = currentUser.displayName || currentUser.email || "Signed in";
    area.innerHTML = `<button class="control-btn" id="signOutBtn">${label} · Sign Out</button>`;
    document.getElementById("signOutBtn").addEventListener("click", async ()=>{
      try{ await window.ReelWordsCloud.signOutUser(); showToast("Signed out — progress stays saved on this browser."); }
      catch(err){ showToast("Couldn't sign out."); }
    });
  } else {
    area.innerHTML = `<button class="control-btn" id="signInBtn">Sign In</button>`;
    document.getElementById("signInBtn").addEventListener("click", openAuthModal);
  }
  if(state.tab==="dashboard") renderDashboard();
}

function openAuthModal(){
  authOverlay.classList.add("show");
  authCard.innerHTML = `
    <button class="modal-close" id="authClose">✕</button>
    <span class="modal-step-label">Sign in to sync across devices</span>
    <button class="quiz-option auth-provider-btn" id="authGoogle">Continue with Google</button>
    <button class="quiz-option auth-provider-btn" id="authApple">Continue with Apple</button>
    <div class="quiz-input-row" style="margin-bottom:10px;"><input type="email" id="authEmail" placeholder="Email" autocomplete="email"></div>
    <div class="quiz-input-row" style="margin-bottom:14px;"><input type="password" id="authPassword" placeholder="Password" autocomplete="current-password"></div>
    <button class="quiz-option auth-provider-btn" id="authSignIn">Sign in with email</button>
    <button class="quiz-option auth-provider-btn" id="authSignUp">Create an account</button>
    <div class="quiz-feedback" id="authFeedback"></div>`;
  document.getElementById("authClose").addEventListener("click", closeAuthModal);
  const fb = ()=>document.getElementById("authFeedback");
  document.getElementById("authGoogle").addEventListener("click", ()=> window.ReelWordsCloud.signInGoogle()
    .then(()=>{ showToast("Signed in with Google."); closeAuthModal(); })
    .catch(err=>{ fb().textContent = err.message; fb().className="quiz-feedback bad"; }));
  document.getElementById("authApple").addEventListener("click", ()=> window.ReelWordsCloud.signInApple()
    .then(()=>{ showToast("Signed in with Apple."); closeAuthModal(); })
    .catch(err=>{ fb().textContent = err.message; fb().className="quiz-feedback bad"; }));
  document.getElementById("authSignIn").addEventListener("click", ()=>{
    const email = document.getElementById("authEmail").value.trim();
    const pw = document.getElementById("authPassword").value;
    window.ReelWordsCloud.signInEmail(email, pw)
      .then(()=>{ showToast("Signed in."); closeAuthModal(); })
      .catch(err=>{ fb().textContent = err.message; fb().className="quiz-feedback bad"; });
  });
  document.getElementById("authSignUp").addEventListener("click", ()=>{
    const email = document.getElementById("authEmail").value.trim();
    const pw = document.getElementById("authPassword").value;
    window.ReelWordsCloud.signUpEmail(email, pw)
      .then(()=>{ showToast("Account created — you're signed in."); closeAuthModal(); })
      .catch(err=>{ fb().textContent = err.message; fb().className="quiz-feedback bad"; });
  });
}

function renderProfileCard(){
  const card = document.getElementById("profileCard");
  if(!card) return;
  if(currentUser){
    const label = currentUser.displayName || currentUser.email || "Signed in";
    card.innerHTML = `<div><div class="pname">${label}</div><div class="pmeta">Learning hours, XP, and word library sync to this account.</div></div><span class="psync cloud">☁ Synced to cloud</span>`;
  } else {
    card.innerHTML = `<div><div class="pname">Not signed in</div><div class="pmeta">Progress is saved to this browser only.</div></div><span class="psync local">💾 Local only</span>`;
  }
}

/* ---------------- TABS ---------------- */
document.querySelectorAll("nav.tabs button[data-tab]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll("nav.tabs button[data-tab]").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll("main > section").forEach(s=>s.classList.remove("active"));
    document.getElementById(btn.dataset.tab).classList.add("active");
    state.tab = btn.dataset.tab;
    if(btn.dataset.tab==="dashboard") renderDashboard();
    if(btn.dataset.tab==="quiz") startQuiz();
    if(btn.dataset.tab==="library") renderLibrary();
    if(btn.dataset.tab==="grammar") renderGrammarChips();
  });
});

/* ---------------- SEARCH ---------------- */
const chipRow = document.getElementById("chipRow");
SUGGESTED_WORDS.forEach(w=>{
  const c=document.createElement("button"); c.className="chip"; c.textContent=w;
  c.addEventListener("click", ()=>{ document.getElementById("searchInput").value=w; runSearch(w); });
  chipRow.appendChild(c);
});
document.getElementById("searchBtn").addEventListener("click", ()=> runSearch(document.getElementById("searchInput").value));
document.getElementById("searchInput").addEventListener("keydown", e=>{ if(e.key==="Enter") runSearch(e.target.value); });

let currentEntry = null;

async function runSearch(raw){
  const key = (raw||"").trim().toLowerCase();
  if(!key) return;

  const block = document.getElementById("resultBlock");
  const searchBtn = document.getElementById("searchBtn");
  const defEl = document.getElementById("rDef");

  block.classList.add("show");
  searchBtn.disabled = true;
  document.getElementById("rWord").textContent = key;
  defEl.textContent = "Looking that word up…";
  defEl.classList.remove("error-msg"); defEl.classList.add("definition");

  let entry;
  try{
    entry = await fetchWordEntry(key);
  }catch(err){
    defEl.textContent = err.message === "not-found"
      ? `No dictionary entry found for “${key}” in either dictionary source. Try one of the suggestions below.`
      : "Something went wrong reaching the dictionary APIs. Please try again.";
    defEl.classList.remove("definition"); defEl.classList.add("error-msg");
    document.getElementById("rPos").textContent = "";
    document.getElementById("rIpa").textContent = "";
    document.getElementById("rFreq").textContent = "";
    document.getElementById("rStatus").textContent = "";
    document.getElementById("examplesGrid").innerHTML = "";
    document.getElementById("synGroups").innerHTML = "";
    document.getElementById("rSubtitle").innerHTML = "";
    document.getElementById("rSpeaker").textContent = "";
    document.getElementById("rTime").textContent = "";
    searchBtn.disabled = false;
    currentEntry = null;
    return;
  }

  currentEntry = entry;
  getWordRecord(entry.word); // register it as at least "new"
  saveState();
  renderWordEntry(entry);
  searchBtn.disabled = false;

  state.clipsWatched += 1;
  saveState();
}

function statusLabel(status){
  return status==="learned" ? "LEARNED" : status==="learning" ? "LEARNING" : "NOT LEARNED";
}
function refreshStatusBadge(word){
  const rec = getWordRecord(word);
  const badge = document.getElementById("rStatus");
  badge.textContent = statusLabel(rec.status);
  badge.className = "badge status" + (rec.status==="learning"?" learning":rec.status==="learned"?" learned":"");
  const markBtn = document.getElementById("markLearnedBtn");
  markBtn.textContent = rec.status==="learned" ? "✓ Learned" : "✓ Mark as Learned";
  markBtn.disabled = rec.status==="learned";
}

/* ---------------- MOVIE CLIP SEARCH (Phase 4) ----------------
   True subtitle-matched clips (word → OpenSubtitles line → exact
   timestamp → YouTube) need an OpenSubtitles API key plus a YouTube
   Data API key and, realistically, a backend to keep those keys off
   the client and to cache subtitle lookups — none of which can be
   provisioned inside a static front-end build. As a working stand-in,
   this searches YouTube for "<word> movie scene" and offers a
   best-effort inline embed alongside a guaranteed "open in YouTube"
   link. Swap runMovieEmbed's iframe src for a real YouTube Data API
   search call (with your own key) once you're ready to wire that up. */
function renderMovieEmbed(entry){
  const query = `${entry.word} movie scene`;
  const searchLink = document.getElementById("youtubeSearchLink");
  searchLink.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const wrap = document.getElementById("movieEmbedWrap");
  wrap.innerHTML = `<iframe src="https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(query)}" title="Movie scenes for ${entry.word}" allowfullscreen loading="lazy"></iframe>
    <div class="movie-embed-empty">Best-effort scene search for "${entry.word}" — use "▶ Find movie clip" for full YouTube search results.</div>`;
}

function renderWordEntry(entry){
  document.getElementById("rWord").textContent = entry.word;
  document.getElementById("rPos").textContent = entry.pos || "—";
  document.getElementById("rIpa").textContent = entry.phonetic || "";
  document.getElementById("rFreq").textContent = entry.source;
  document.getElementById("rDef").textContent = entry.definition;
  document.getElementById("rDef").classList.remove("error-msg"); document.getElementById("rDef").classList.add("definition");
  document.getElementById("rCefr").textContent = CEFR_MAP[entry.word.toLowerCase()] || "Unrated";

  refreshStatusBadge(entry.word);
  renderMovieEmbed(entry);

  const ukBtn = document.getElementById("playBritish");
  const usBtn = document.getElementById("playAmerican");
  ukBtn.onclick = ()=> playPronunciation(entry.word, entry.audioUk, "en-GB");
  usBtn.onclick = ()=> playPronunciation(entry.word, entry.audioUs, "en-US");

  const firstExample = entry.examples[0];
  document.getElementById("rSpeaker").textContent = "Example in context";
  document.getElementById("rTime").textContent = entry.pos || "";
  if(firstExample){
    const re = new RegExp(entry.word, "i");
    document.getElementById("rSubtitle").innerHTML = firstExample.text.replace(re, m=>`<mark>${m}</mark>`);
  } else {
    document.getElementById("rSubtitle").innerHTML = "No example sentence was returned for this word.";
  }

  const grid = document.getElementById("examplesGrid"); grid.innerHTML="";
  if(entry.examples.length === 0){
    grid.innerHTML = `<div class="example-card"><p>No example sentences available for this word yet.</p></div>`;
  }
  entry.examples.forEach((ex,i)=>{
    const re = new RegExp(entry.word, "i");
    const highlighted = ex.text.replace(re, m=>`<mark>${m}</mark>`);
    const id = entry.word+"-"+i;
    const card=document.createElement("div"); card.className="example-card";
    card.innerHTML = `<span class="tag">${ex.tag}</span><p>${highlighted}</p>
      <div class="example-actions">
        <button class="icon-btn play-ex" title="Play audio">🔊</button>
        <button class="icon-btn" title="Copy">⧉</button>
        <button class="icon-btn ${state.savedExamples.includes(id)?'saved':''}" title="Save" data-id="${id}">♥️</button>
      </div>`;
    card.querySelector(".play-ex").addEventListener("click", ()=> playPronunciation(entry.word, entry.audioUs || entry.audioUk, "en-US"));
    card.querySelector('[title="Save"]').addEventListener("click", e=>{
      const idx = state.savedExamples.indexOf(id);
      if(idx>=0){ state.savedExamples.splice(idx,1); e.target.classList.remove("saved"); }
      else { state.savedExamples.push(id); e.target.classList.add("saved"); }
      saveState();
    });
    grid.appendChild(card);
  });

  const synBox=document.getElementById("synGroups"); synBox.innerHTML="";
  if(entry.synonyms.length===0 && entry.antonyms.length===0){
    synBox.innerHTML = `<span class="group-pill">No synonyms or antonyms returned for this word.</span>`;
  }
  entry.synonyms.forEach(s=>{ const p=document.createElement("span"); p.className="group-pill"; p.textContent=s; synBox.appendChild(p); });
  entry.antonyms.forEach(s=>{ const p=document.createElement("span"); p.className="group-pill ant"; p.textContent=s; synBox.appendChild(p); });

  document.querySelectorAll(".speed-btn").forEach(b=>b.addEventListener("click", ()=>{
    document.querySelectorAll(".speed-btn").forEach(x=>x.classList.remove("active")); b.classList.add("active");
  }));
  const loopBtn = document.getElementById("loopBtn");
  loopBtn.onclick = ()=> loopBtn.classList.toggle("on");
}

document.getElementById("markLearnedBtn").addEventListener("click", ()=>{
  if(!currentEntry) return;
  setWordStatus(currentEntry.word, "learned");
  awardXP(10);
  refreshStatusBadge(currentEntry.word);
  showToast(`"${currentEntry.word}" moved to Learned Words (+10 XP)`);
});
document.getElementById("startLearningBtn").addEventListener("click", ()=>{
  if(!currentEntry) return;
  openLearningFlow(currentEntry);
});

/* ---------------- START LEARNING FLOW (Quiz → Grammar → Confirmation) ---------------- */
const flowOverlay = document.getElementById("flowOverlay");
const flowCard = document.getElementById("flowCard");
function closeFlow(){ flowOverlay.classList.remove("show"); flowCard.innerHTML=""; }

function openLearningFlow(entry){
  flowOverlay.classList.add("show");
  renderFlowStep1(entry);
}
function renderFlowStep1(entry){
  const distractors = SUGGESTED_WORDS.filter(w=>w!==entry.word).slice(0,3)
    .map(()=> "A different, unrelated meaning.");
  const options = [entry.definition, ...distractors].sort(()=>Math.random()-0.5);
  flowCard.innerHTML = `
    <button class="modal-close" id="flowClose">✕</button>
    <span class="modal-step-label">Step 1 of 3 · Vocabulary quiz</span>
    <div class="quiz-question">What does <mark>${entry.word}</mark> mean?</div>
    <div class="quiz-options">${options.map(o=>`<button class="quiz-option" data-correct="${o===entry.definition}">${o}</button>`).join("")}</div>
    <div class="quiz-feedback"></div>
    <button class="quiz-next" id="flowNext1">Continue to grammar</button>`;
  document.getElementById("flowClose").addEventListener("click", closeFlow);
  flowCard.querySelectorAll(".quiz-option").forEach(btn=>btn.addEventListener("click", ()=>{
    const correct = btn.dataset.correct==="true";
    flowCard.querySelectorAll(".quiz-option").forEach(b=>{ b.disabled=true; if(b.dataset.correct==="true") b.classList.add("correct"); });
    if(!correct) btn.classList.add("wrong");
    recordAttempt(entry.word, correct);
    const fb = flowCard.querySelector(".quiz-feedback");
    fb.textContent = correct ? "Correct!" : "Not quite — here's the right meaning highlighted above.";
    fb.className = "quiz-feedback " + (correct?"good":"bad");
    flowCard.querySelector(".quiz-next").style.display="inline-block";
  }));
  document.getElementById("flowNext1").addEventListener("click", ()=> renderFlowStep2(entry));
}
function renderFlowStep2(entry){
  const forms = buildGrammarForms(entry);
  const exercise = buildGrammarExercise(entry, forms);
  flowCard.innerHTML = `
    <button class="modal-close" id="flowClose">✕</button>
    <span class="modal-step-label">Step 2 of 3 · Grammar practice</span>
    <div class="gram-word-title">${entry.word}</div>
    <div class="gram-pos-pills">${forms.map(f=>`<span class="gram-pos-pill">${f.pos}</span>`).join("")}</div>
    <div class="forms-grid">${forms.map(f=>`<div class="form-card"><div class="fname">${f.pos}</div><ul>${f.values.map(v=>`<li>${v}</li>`).join("")}</ul></div>`).join("")}</div>
    ${exercise ? `<div class="gram-exercise" style="padding:0;">
      <div class="sentence">${exercise.prompt}</div>
      ${exercise.type==="choice"
        ? `<div class="quiz-options">${exercise.options.map(o=>`<button class="quiz-option" data-correct="${o===exercise.answer}">${o}</button>`).join("")}</div>`
        : `<div class="quiz-input-row"><input type="text" id="flowGramInput" placeholder="Type the missing form…" autocomplete="off"></div>`}
      <div class="quiz-feedback"></div>
    </div>` : ""}
    <button class="quiz-next" id="flowNext2" style="display:inline-block;">Continue to confirmation</button>`;
  document.getElementById("flowClose").addEventListener("click", closeFlow);
  if(exercise && exercise.type==="choice"){
    flowCard.querySelectorAll(".quiz-option").forEach(btn=>btn.addEventListener("click", ()=>{
      const correct = btn.dataset.correct==="true";
      flowCard.querySelectorAll(".quiz-option").forEach(b=>{ b.disabled=true; });
      if(correct) btn.classList.add("correct"); else btn.classList.add("wrong");
      finishGrammarExercise(correct);
    }));
  } else if(exercise){
    const input = document.getElementById("flowGramInput");
    input.addEventListener("keydown", e=>{
      if(e.key==="Enter"){
        const correct = e.target.value.trim().toLowerCase() === exercise.answer.toLowerCase();
        input.disabled = true;
        finishGrammarExercise(correct);
      }
    });
  }
  function finishGrammarExercise(correct){
    const fb = flowCard.querySelector(".quiz-feedback");
    if(fb){
      fb.textContent = correct ? "Correct!" : `Not quite — the answer was "${exercise.answer}."`;
      fb.className = "quiz-feedback " + (correct?"good":"bad");
    }
    state.grammarCompleted++; saveState();
    awardXP(10);
    if(state.grammarCompleted >= 10) unlock("grammarMaster");
  }
  document.getElementById("flowNext2").addEventListener("click", ()=> renderFlowStep3(entry));
}
function renderFlowStep3(entry){
  flowCard.innerHTML = `
    <button class="modal-close" id="flowClose">✕</button>
    <span class="modal-step-label">Step 3 of 3 · Confirmation</span>
    <div class="quiz-question">Do you know <mark>${entry.word}</mark> now?</div>
    <div class="quiz-options">
      <button class="quiz-option" id="flowKnowIt">✓ I know this word</button>
      <button class="quiz-option" id="flowNeedPractice">Need more practice</button>
    </div>`;
  document.getElementById("flowClose").addEventListener("click", closeFlow);
  document.getElementById("flowKnowIt").addEventListener("click", ()=>{
    setWordStatus(entry.word, "learned");
    awardXP(10);
    showToast(`"${entry.word}" marked as learned (+10 XP)`);
    if(currentEntry && currentEntry.word===entry.word) refreshStatusBadge(entry.word);
    closeFlow();
  });
  document.getElementById("flowNeedPractice").addEventListener("click", ()=>{
    setWordStatus(entry.word, "learning");
    showToast(`"${entry.word}" added to your Learning list.`);
    if(currentEntry && currentEntry.word===entry.word) refreshStatusBadge(entry.word);
    closeFlow();
  });
}

/* ---------------- GRAMMAR PRACTICE ---------------- */
/* Heuristic English morphology — Free/fallback dictionaries don't return
   conjugations, so common regular-inflection rules are applied here based
   on the part(s) of speech the dictionary reports for the word. */
function conjugateVerb(base){
  const b = base.toLowerCase();
  let ing, ed;
  if(/e$/.test(b) && !/ee$/.test(b)){ ing = b.slice(0,-1)+"ing"; ed = b.slice(0,-1)+"ed"; }
  else if(/[^aeiou][aeiou][^aeiouwxy]$/.test(b) && b.length<=6){ ing = b+b.slice(-1)+"ing"; ed = b+b.slice(-1)+"ed"; }
  else { ing = b+"ing"; ed = /[^aeiou]y$/.test(b) ? b.slice(0,-1)+"ied" : b+"ed"; }
  return { base:b, ing, ed };
}
function nounForms(base){ return [base.toLowerCase()]; }
function adjectiveForms(base){
  const b = base.toLowerCase();
  const adv = /y$/.test(b) ? b.slice(0,-1)+"ily" : /le$/.test(b) ? b.slice(0,-1)+"y" : b+"ly";
  return { adjective:b, adverb:adv };
}
function buildGrammarForms(entry){
  const forms = [];
  const posList = entry.posList && entry.posList.length ? entry.posList : (entry.pos ? [entry.pos] : ["noun"]);
  posList.forEach(pos=>{
    if(pos==="verb"){
      const {base,ing,ed} = conjugateVerb(entry.word);
      forms.push({ pos:"Verb", values:[base, ed, ing] });
    } else if(pos==="noun"){
      forms.push({ pos:"Noun", values: nounForms(entry.word) });
    } else if(pos==="adjective"){
      const {adverb} = adjectiveForms(entry.word);
      forms.push({ pos:"Adjective", values:[entry.word.toLowerCase()] });
      forms.push({ pos:"Adverb", values:[adverb] });
    } else if(pos==="adverb"){
      forms.push({ pos:"Adverb", values:[entry.word.toLowerCase()] });
    }
  });
  if(forms.length===0) forms.push({ pos:"Word", values:[entry.word.toLowerCase()] });
  return forms;
}
function buildGrammarExercise(entry, forms){
  const verbForm = forms.find(f=>f.pos==="Verb");
  if(verbForm){
    const base = verbForm.values[0], ed = verbForm.values[1];
    return { type:"type", prompt:`Yesterday they ______ about the terms. (${base})`, answer: ed };
  }
  if(entry.examples && entry.examples[0]){
    const re = new RegExp(entry.word, "i");
    const options = [entry.word, entry.word+"s", entry.word.slice(0,-1)||entry.word, entry.word+"ly"]
      .filter((v,i,arr)=>arr.indexOf(v)===i).slice(0,4);
    return { type:"choice", prompt:`${entry.examples[0].text.replace(re,"______")}`, options: options.sort(()=>Math.random()-0.5), answer: entry.word };
  }
  return null;
}

const grammarChipRow = document.getElementById("grammarChipRow");
function renderGrammarChips(){
  const learning = wordsByStatus("learning");
  const pool = Array.from(new Set([...learning, ...SUGGESTED_WORDS])).slice(0,8);
  grammarChipRow.innerHTML = "";
  pool.forEach(w=>{
    const c=document.createElement("button"); c.className="chip"; c.style.color="var(--blue)"; c.style.border="1px solid var(--line)"; c.style.background="var(--blue-light)";
    c.textContent=w;
    c.addEventListener("click", ()=>{ document.getElementById("grammarWordInput").value=w; loadGrammarWord(w); });
    grammarChipRow.appendChild(c);
  });
}
document.getElementById("grammarLoadBtn").addEventListener("click", ()=> loadGrammarWord(document.getElementById("grammarWordInput").value));
document.getElementById("grammarWordInput").addEventListener("keydown", e=>{ if(e.key==="Enter") loadGrammarWord(e.target.value); });

async function loadGrammarWord(raw){
  const key = (raw||"").trim().toLowerCase();
  if(!key) return;
  const content = document.getElementById("grammarContent");
  content.innerHTML = `<div class="quiz-loading">Loading grammar data…</div>`;
  let entry;
  try{ entry = await fetchWordEntry(key); }
  catch(err){
    content.innerHTML = `<p class="error-msg">Couldn't find "${key}" in either dictionary source.</p>`;
    return;
  }
  getWordRecord(entry.word);
  const forms = buildGrammarForms(entry);
  const exercise = buildGrammarExercise(entry, forms);
  content.innerHTML = `
    <div class="card" style="padding:24px; margin-bottom:22px;">
      <div class="gram-word-title">${entry.word}</div>
      <div class="gram-pos-pills">${forms.map(f=>`<span class="gram-pos-pill">${f.pos}</span>`).join("")}</div>
      <div class="forms-grid">${forms.map(f=>`<div class="form-card"><div class="fname">${f.pos}</div><ul>${f.values.map(v=>`<li>${v}</li>`).join("")}</ul></div>`).join("")}</div>
    </div>
    ${exercise ? `<div class="card gram-exercise">
      <div class="quiz-type-label" style="text-align:left;">Exercise</div>
      <div class="sentence">${exercise.prompt}</div>
      ${exercise.type==="choice"
        ? `<div class="quiz-options">${exercise.options.map(o=>`<button class="quiz-option" data-correct="${o===exercise.answer}">${o}</button>`).join("")}</div>`
        : `<div class="quiz-input-row"><input type="text" id="gramInput" placeholder="Type the missing form…" autocomplete="off"></div>`}
      <div class="quiz-feedback" id="gramFeedback"></div>
    </div>` : ""}`;

  if(exercise && exercise.type==="choice"){
    content.querySelectorAll(".quiz-option").forEach(btn=>btn.addEventListener("click", ()=>{
      const correct = btn.dataset.correct==="true";
      content.querySelectorAll(".quiz-option").forEach(b=>{ b.disabled=true; });
      btn.classList.add(correct?"correct":"wrong");
      finishGrammar(correct, entry);
    }));
  } else if(exercise){
    const input = content.querySelector("#gramInput");
    input.addEventListener("keydown", e=>{
      if(e.key==="Enter"){
        const correct = e.target.value.trim().toLowerCase() === exercise.answer.toLowerCase();
        input.disabled = true;
        finishGrammar(correct, entry);
      }
    });
  }
  function finishGrammar(correct, entry){
    const fb = document.getElementById("gramFeedback");
    if(fb){
      fb.textContent = correct ? "Correct!" : `Not quite — the answer was "${exercise.answer}."`;
      fb.className = "quiz-feedback " + (correct?"good":"bad");
    }
    recordAttempt(entry.word, correct);
    state.grammarCompleted++; saveState();
    awardXP(10);
    if(state.grammarCompleted >= 10) unlock("grammarMaster");
  }
}

/* ---------------- WORD LIBRARY ---------------- */
let currentLibTab = "learned";
document.querySelectorAll("#libTabs button").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll("#libTabs button").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    currentLibTab = btn.dataset.lib;
    renderLibrary();
  });
});
document.getElementById("libSearchInput").addEventListener("input", renderLibrary);

function renderLibrary(){
  const grid = document.getElementById("libraryGrid");
  const filter = document.getElementById("libSearchInput").value.trim().toLowerCase();
  const words = wordsByStatus(currentLibTab).filter(w=>!filter || w.includes(filter));
  grid.innerHTML = "";
  if(words.length===0){
    grid.innerHTML = `<div class="lib-empty">No words in "${currentLibTab}" yet${filter?" matching your search":""}. Search a word and use "Start Learning" or "✓ Mark as Learned" to add one.</div>`;
    return;
  }
  words.forEach(w=>{
    const rec = state.words[w];
    const card = document.createElement("div"); card.className="lib-word-card";
    let meta = "";
    if(currentLibTab==="learning") meta = `${rec.attempts} quiz attempt${rec.attempts===1?"":"s"} · last reviewed ${rec.lastReviewed ? new Date(rec.lastReviewed).toLocaleDateString() : "never"}`;
    if(currentLibTab==="learned") meta = `Learned ${rec.lastReviewed ? new Date(rec.lastReviewed).toLocaleDateString() : new Date(rec.firstSeen).toLocaleDateString()}`;
    if(currentLibTab==="new") meta = `First seen ${new Date(rec.firstSeen).toLocaleDateString()}`;
    card.innerHTML = `
      <div class="lname">${w}</div>
      <div class="lmeta">${meta}</div>
      ${currentLibTab==="learning" ? `<div class="lprogress"><div style="width:${rec.progress}%"></div></div>` : ""}
      <div class="lactions">
        <button class="icon-btn lib-play" title="Play">🔊</button>
        ${currentLibTab==="learned" ? `<button class="control-btn lib-practice">Need Practice Again</button>` : ""}
        ${currentLibTab==="new" ? `<button class="control-btn lib-start">Start Learning</button>` : ""}
      </div>`;
    card.querySelector(".lib-play").addEventListener("click", async ()=>{
      try{ const entry = await fetchWordEntry(w); playPronunciation(w, entry.audioUs||entry.audioUk, "en-US"); }
      catch(err){ speakFallback(w, "en-US"); }
    });
    const practiceBtn = card.querySelector(".lib-practice");
    if(practiceBtn) practiceBtn.addEventListener("click", ()=>{
      setWordStatus(w, "learning");
      showToast(`"${w}" moved back to Learning.`);
      renderLibrary();
    });
    const startBtn = card.querySelector(".lib-start");
    if(startBtn) startBtn.addEventListener("click", async ()=>{
      try{ const entry = await fetchWordEntry(w); openLearningFlow(entry); }
      catch(err){ showToast("Couldn't load this word right now."); }
    });
    grid.appendChild(card);
  });
}

/* ---------------- QUIZ ---------------- */
let quizQueue=[], quizIndex=0; const QUIZ_LEN=5;

async function buildQuizQueue(){
  const card=document.getElementById("quizCard");
  card.innerHTML = `<div class="quiz-loading">Loading questions from the dictionary…</div>`;

  const types=["mcq","spelling","fillblank"];
  const activePool = Array.from(new Set([...wordsByStatus("new"), ...wordsByStatus("learning")]));
  const pool = activePool.length ? activePool : SUGGESTED_WORDS.slice();
  const picks = [];
  for(let i=0;i<QUIZ_LEN;i++){
    picks.push(pool[Math.floor(Math.random()*pool.length)] || SUGGESTED_WORDS[i % SUGGESTED_WORDS.length]);
  }

  const entries = await Promise.all(picks.map(w => fetchWordEntry(w).catch(()=>null)));

  quizQueue = [];
  entries.forEach((entry, i)=>{
    if(!entry) return;
    let type = types[i % types.length];
    if(type==="fillblank" && entry.examples.length===0) type = "mcq";
    quizQueue.push({ entry, type });
  });
  quizIndex = 0;
}

async function startQuiz(){
  await buildQuizQueue();
  renderQuizProgress();
  renderQuizQuestion();
}
function renderQuizProgress(){
  const wrap=document.getElementById("quizProgress"); wrap.innerHTML="";
  for(let i=0;i<quizQueue.length;i++){ const b=document.createElement("i"); if(i<quizIndex) b.classList.add("done"); wrap.appendChild(b); }
}
function renderQuizQuestion(){
  const card=document.getElementById("quizCard");
  if(quizQueue.length===0){
    card.innerHTML = `<span class="quiz-type-label">Couldn't load a quiz</span>
      <div class="quiz-question">The dictionary API didn't return usable questions this time.</div>
      <button class="quiz-next" style="display:inline-block" id="restartQuiz">Try again</button>`;
    document.getElementById("restartQuiz").addEventListener("click", startQuiz);
    return;
  }
  if(quizIndex>=quizQueue.length){
    state.quizzesCompleted++; saveState();
    awardXP(5);
    card.innerHTML = `<span class="quiz-type-label">Session complete</span>
      <div class="quiz-question">Nice work — ${state.quizCorrect}/${quizQueue.length} correct this round. (+5 XP)</div>
      <button class="quiz-next" style="display:inline-block" id="restartQuiz">Start another round</button>`;
    document.getElementById("restartQuiz").addEventListener("click", startQuiz);
    return;
  }
  const {entry,type}=quizQueue[quizIndex];
  const key = entry.word.toLowerCase();
  const knowItRow = `<button class="quiz-option" id="alreadyKnowBtn" style="background:#d7f3ea; color:#0d7a55; font-weight:700;">✓ I already know this word</button>`;

  if(type==="mcq"){
    const otherEntries = quizQueue.filter((q,i)=>i!==quizIndex).map(q=>q.entry.definition);
    const distractors = otherEntries.length>=3 ? otherEntries.slice(0,3) :
      SUGGESTED_WORDS.filter(w=>w!==key).slice(0,3).map(()=> "A different, unrelated meaning.");
    const options=[entry.definition, ...distractors].sort(()=>Math.random()-0.5);
    card.innerHTML = `<span class="quiz-type-label">Choose the correct meaning</span>
      <div class="quiz-question">What does <mark>${key}</mark> mean?</div>
      <div class="quiz-options">${options.map(o=>`<button class="quiz-option" data-correct="${o===entry.definition}">${o}</button>`).join("")}${knowItRow}</div>
      <div class="quiz-feedback"></div><button class="quiz-next">Next</button>`;
    card.querySelectorAll(".quiz-option[data-correct]").forEach(btn=>btn.addEventListener("click", ()=>{
      const correct = btn.dataset.correct==="true";
      card.querySelectorAll(".quiz-option[data-correct]").forEach(b=>{ b.disabled=true; if(b.dataset.correct==="true") b.classList.add("correct"); });
      if(!correct) btn.classList.add("wrong");
      markResult(correct, card, entry);
    }));
  }
  if(type==="spelling"){
    card.innerHTML = `<span class="quiz-type-label">Write the word correctly</span>
      <div class="quiz-question">"${entry.definition}"</div>
      <div class="quiz-input-row"><input type="text" id="spellInput" placeholder="Type the word…" autocomplete="off"></div>
      <div class="quiz-options">${knowItRow}</div>
      <div class="quiz-feedback"></div><button class="quiz-next">Next</button>`;
    const input=card.querySelector("#spellInput");
    input.addEventListener("keydown", e=>{ if(e.key==="Enter"){ const c=e.target.value.trim().toLowerCase()===key; input.disabled=true; markResult(c,card,entry,c?null:key);} });
  }
  if(type==="fillblank"){
    const ex = entry.examples[0].text; const re = new RegExp(key,"i");
    const blanked = ex.replace(re, "_____");
    card.innerHTML = `<span class="quiz-type-label">Fill in the missing word</span>
      <div class="quiz-question">${blanked}</div>
      <div class="quiz-input-row"><input type="text" id="blankInput" placeholder="Type the missing word…" autocomplete="off"></div>
      <div class="quiz-options">${knowItRow}</div>
      <div class="quiz-feedback"></div><button class="quiz-next">Next</button>`;
    const input=card.querySelector("#blankInput");
    input.addEventListener("keydown", e=>{ if(e.key==="Enter"){ const c=e.target.value.trim().toLowerCase()===key; input.disabled=true; markResult(c,card,entry,c?null:key);} });
  }
  card.querySelector("#alreadyKnowBtn").addEventListener("click", ()=>{
    setWordStatus(entry.word, "learned");
    awardXP(6);
    showToast(`"${entry.word}" marked as learned and removed from quizzes.`);
    quizIndex++; renderQuizProgress(); renderQuizQuestion();
  });
  card.querySelector(".quiz-next").addEventListener("click", ()=>{ quizIndex++; renderQuizProgress(); renderQuizQuestion(); });
}
function markResult(correct, card, entry, revealWord){
  state.quizTotal++; if(correct) state.quizCorrect++;
  recordAttempt(entry.word, correct);
  awardXP(correct?6:2);
  const fb=card.querySelector(".quiz-feedback");
  fb.textContent = correct ? "Correct." : (revealWord?`Not quite — it was "${revealWord}."`:"Not quite.");
  fb.className = "quiz-feedback " + (correct?"good":"bad");
  card.querySelector(".quiz-next").style.display="inline-block";
  if(state.quizTotal===quizQueue.length && state.quizCorrect===quizQueue.length) unlock("perfect");
}

/* ---------------- TIME TRACKER ---------------- */
const liveTimerEl = document.getElementById("liveTimer");
const miniTimer = document.getElementById("miniTimer");
const miniTime = document.getElementById("miniTime");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");
let tickHandle = null;

function tick(){
  state.timer.elapsed++;
  state.todaySeconds++;
  state.weekSeconds++;
  state.monthSeconds++;
  state.totalSeconds++;
  const display = fmtHMS(state.timer.elapsed);
  liveTimerEl.textContent = display;
  miniTime.textContent = display;

  if(state.timer.elapsed - state.timer.lastXpAward >= 1800){
    state.timer.lastXpAward = state.timer.elapsed;
    awardXP(10);
    showToast("+10 XP for 30 minutes of learning");
  }
  checkHourBadges();
  saveState();
  if(state.tab==="dashboard") updateTimeDisplaysOnly();
}
function checkHourBadges(){
  const hours = state.totalSeconds/3600;
  if(hours>=10) unlock("hours10");
  if(hours>=50) unlock("hours50");
  if(hours>=100) unlock("hours100");
}
function startTimer(){
  tickHandle = setInterval(tick, 1000);
  startBtn.disabled = true; pauseBtn.disabled = false; stopBtn.disabled = false;
  miniTimer.classList.add("show");
}
function pauseTimer(){
  clearInterval(tickHandle);
  startBtn.disabled = false; startBtn.textContent = "▶️ Resume Learning";
  pauseBtn.disabled = true;
}
function stopTimer(){
  clearInterval(tickHandle);
  const durationMin = Math.max(1, Math.round(state.timer.elapsed/60));
  if(state.timer.elapsed>0){
    state.history.unshift({date:"Today", durationMin, activity:"Free Study"});
    state.weekly[6] = (state.weekly[6]||0) + durationMin;
    showToast(`Session saved — ${durationMin} min added to your totals`);
  }
  state.timer.elapsed = 0; state.timer.lastXpAward=0;
  saveState();
  liveTimerEl.textContent = "00:00:00";
  startBtn.disabled=false; startBtn.textContent="▶️ Start Learning";
  pauseBtn.disabled=true; stopBtn.disabled=true;
  miniTimer.classList.remove("show");
  if(state.tab==="dashboard") renderDashboard();
}
startBtn.addEventListener("click", startTimer);
pauseBtn.addEventListener("click", pauseTimer);
stopBtn.addEventListener("click", stopTimer);
document.getElementById("miniPause").addEventListener("click", ()=>{
  if(tickHandle && !pauseBtn.disabled) pauseTimer(); else startTimer();
});
document.getElementById("miniStop").addEventListener("click", stopTimer);

function updateTimeDisplaysOnly(){
  document.getElementById("timeTotal").textContent = fmtHM(state.totalSeconds);
  document.getElementById("timeToday").textContent = fmtHM(state.todaySeconds);
  document.getElementById("timeWeek").textContent = fmtHM(state.weekSeconds);
  document.getElementById("timeMonth").textContent = fmtHM(state.monthSeconds);
}

/* ---------------- DASHBOARD ---------------- */
function renderDashboard(){
  renderProfileCard();
  const cefr = cefrInfo();
  document.getElementById("dLevel").textContent = Math.floor(state.xp/XP_PER_LEVEL) + 1;
  document.getElementById("streakDays").textContent = state.streak;
  document.getElementById("dCefr").textContent = `${cefr.code} · ${cefr.title}`;
  document.getElementById("xpFill").style.width = (state.xp % XP_PER_LEVEL)+"%";
  document.getElementById("xpLabel").textContent = `${state.xp % XP_PER_LEVEL} / ${XP_PER_LEVEL} XP to next level · ${cefr.wordsNeeded>0 ? cefr.wordsNeeded+" words to "+cefr.nextCode : "top CEFR level reached"}`;

  document.getElementById("statWords").textContent = wordsByStatus("learned").length;
  document.getElementById("statStreak").textContent = state.streak;
  document.getElementById("statAccuracy").textContent = state.quizTotal ? Math.round(100*state.quizCorrect/state.quizTotal)+"%" : "—";
  document.getElementById("statClips").textContent = state.clipsWatched;

  updateTimeDisplaysOnly();

  const pct = cefr.pct;
  document.getElementById("progressRing").style.background = `conic-gradient(var(--blue-2) ${pct*3.6}deg, var(--blue-light) 0deg)`;
  document.getElementById("progressPct").textContent = pct+"%";
  const ringLabel = document.querySelector("#progressRing .plabel");
  if(ringLabel) ringLabel.textContent = cefr.nextCode ? `TOWARD ${cefr.nextCode}` : "TOP LEVEL";

  const weekBox = document.getElementById("weeklyChart"); weekBox.innerHTML="";
  const days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const maxMin = Math.max(...state.weekly, 60);
  state.weekly.forEach((min,i)=>{
    const col=document.createElement("div"); col.className="week-col";
    const barHeight = Math.max(6, Math.round((min/maxMin)*100));
    col.innerHTML = `<div class="week-bar" style="height:${barHeight}%"></div><div class="week-label">${days[i]}</div>`;
    weekBox.appendChild(col);
  });

  const grid=document.getElementById("heatmapGrid"); grid.innerHTML="";
  for(let i=0;i<30;i++){
    const seed=(i*13+state.totalSeconds) % 5;
    const cell=document.createElement("div"); cell.className="heat-cell"+(i===29?" today":"");
    const alpha = seed===0?0.15:seed===1?0.35:seed===2?0.55:seed===3?0.75:0.95;
    cell.style.background = `rgba(30,150,252,${alpha})`;
    grid.appendChild(cell);
  }

  const histBody = document.getElementById("historyBody"); histBody.innerHTML="";
  if(state.history.length===0){
    histBody.innerHTML = `<tr><td colspan="3" style="font-family:var(--mono); color:var(--gray);">No sessions yet — start the timer above.</td></tr>`;
  }
  state.history.slice(0,8).forEach(h=>{
    const tr=document.createElement("tr");
    tr.innerHTML = `<td>${h.date}</td><td>${h.durationMin>=60?Math.floor(h.durationMin/60)+"h "+(h.durationMin%60)+"m":h.durationMin+" min"}</td><td>${h.activity}</td>`;
    histBody.appendChild(tr);
  });

  const catGrid=document.getElementById("catGrid"); catGrid.innerHTML="";
  const newCount = wordsByStatus("new").length, learningCount = wordsByStatus("learning").length, learnedCount = wordsByStatus("learned").length;
  const totalTracked = Math.max(1, newCount+learningCount+learnedCount);
  [["New words", newCount], ["Learning", learningCount], ["Learned", learnedCount]].forEach(([name,count])=>{
    const pctC = Math.round(100*count/totalTracked);
    const div=document.createElement("div"); div.className="cat-card";
    div.innerHTML = `<div class="cname">${name}</div><div class="cnum">${count} word${count===1?"":"s"} · ${pctC}%</div><div class="bar"><div style="width:${pctC}%"></div></div>`;
    catGrid.appendChild(div);
  });
  // Word-category catalog (categories.json) — shown as a reference collection.
  // Individual words aren't tagged by category yet, so this intentionally shows
  // the collection size rather than a fabricated per-category completion %.
  CATEGORIES.forEach(c=>{
    const div=document.createElement("div"); div.className="cat-card";
    div.innerHTML = `<div class="cname">${c.name}</div><div class="cnum">${c.total} words in this collection</div>`;
    catGrid.appendChild(div);
  });

  const badgeRow=document.getElementById("badgeRow"); badgeRow.innerHTML="";
  ACHIEVEMENTS.forEach(a=>{
    const unlocked = state.unlocked.includes(a.key);
    const div=document.createElement("div"); div.className="achievement"+(unlocked?" unlocked":"");
    div.innerHTML = `<span class="ic">${a.ic}</span>${a.name}`;
    badgeRow.appendChild(div);
  });
}

renderDashboard();
loadStaticData();
initAuth();
