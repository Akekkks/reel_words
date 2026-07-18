/* ============================================================
   Reel Words — script.js
   All word data (definitions, phonetics, examples, synonyms,
   antonyms, pronunciation audio) is fetched live from the
   Free Dictionary API: https://api.dictionaryapi.dev
   No dictionary content is hardcoded in this file.
   ============================================================ */

const API_BASE = "https://api.dictionaryapi.dev/api/v2/entries/en/";

/* A short list of *words* (not definitions) used to seed the search
   chips and the quiz. This is just a word list, all the actual
   dictionary content for each word is fetched from the API. */
const SUGGESTED_WORDS = ["eloquent", "reluctant", "thriving", "negotiate", "overwhelmed", "persistent"];

const CATEGORIES = [
  {name:"Travel", total:120, done:64}, {name:"Business", total:150, done:38},
  {name:"Movies", total:90, done:71}, {name:"IELTS", total:200, done:52},
  {name:"Idioms", total:110, done:19}, {name:"Emotions", total:80, done:44}
];
const ACHIEVEMENTS = [
  {ic:"🎬", name:"First Word", key:"first"},
  {ic:"🔥", name:"7-Day Streak", key:"streak7"},
  {ic:"🎯", name:"Perfect Quiz", key:"perfect"},
  {ic:"📚", name:"100 Words", key:"words100"},
  {ic:"⏱️", name:"10 Hours", key:"hours10"},
  {ic:"🏅", name:"50 Hours", key:"hours50"},
  {ic:"👑", name:"100 Hours (Advanced)", key:"hours100"}
];

/* ---------------- STATE (in-memory only, resets on page reload) ---------------- */
const state = {
  tab:"search",
  xp:35, level:3, streak:12,
  wordsLearned:new Set(),
  clipsWatched:0,
  quizCorrect:0, quizTotal:0,
  unlocked:new Set(),
  savedExamples:new Set(),
  totalSeconds: 24*3600 + 35*60,
  todaySeconds: 0,
  weekSeconds: 5*3600 + 20*60,
  monthSeconds: 18*3600 + 45*60,
  history: [
    {date:"18 July", durationMin:45, activity:"Vocabulary Quiz"},
    {date:"17 July", durationMin:80, activity:"Movie Words"},
    {date:"16 July", durationMin:30, activity:"Flashcards"}
  ],
  weekly:[20,45,30,60,15,50,10], // minutes Mon..Sun (mock, except today updates live)
  timer:{ running:false, paused:false, elapsed:0, tickHandle:null, lastXpAward:0 }
};
const XP_PER_LEVEL = 100;

/* Cache of already-fetched API entries so we don't re-fetch the
   same word twice (used by both search and the quiz). */
const wordCache = new Map();

/* ---------------- API ---------------- */
async function fetchWordEntry(word){
  const key = word.trim().toLowerCase();
  if(wordCache.has(key)) return wordCache.get(key);

  const res = await fetch(API_BASE + encodeURIComponent(key));
  if(!res.ok){
    throw new Error(res.status === 404 ? "not-found" : "request-failed");
  }
  const data = await res.json();
  const parsed = parseApiResponse(data);
  wordCache.set(key, parsed);
  return parsed;
}

/* Normalize the Free Dictionary API response into the shape the UI needs. */
function parseApiResponse(data){
  const entry = data[0];

  // Pronunciation: try to find distinct UK / US audio files, otherwise fall back
  // to whatever audio is available.
  const phoneticsWithAudio = (entry.phonetics || []).filter(p => p.audio);
  const uk = phoneticsWithAudio.find(p => /uk/i.test(p.audio)) || phoneticsWithAudio[0] || null;
  const us = phoneticsWithAudio.find(p => /us/i.test(p.audio)) || phoneticsWithAudio.find(p => p !== uk) || uk;

  const meanings = entry.meanings || [];
  const firstMeaning = meanings[0] || {};
  const firstDef = (firstMeaning.definitions || [])[0] || {};

  // Collect example sentences across all meanings/definitions.
  const examples = [];
  meanings.forEach(m=>{
    (m.definitions || []).forEach(d=>{
      if(d.example){ examples.push({ tag: m.partOfSpeech || "usage", text: d.example }); }
    });
  });

  // Collect synonyms/antonyms across meaning- and definition-level fields.
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
    phonetic: entry.phonetic || (phoneticsWithAudio[0] && phoneticsWithAudio[0].text) || "",
    pos: firstMeaning.partOfSpeech || "",
    definition: firstDef.definition || "No definition available.",
    audioUk: uk ? uk.audio : null,
    audioUs: us ? us.audio : null,
    examples: examples.slice(0, 4),
    synonyms: Array.from(synonyms).slice(0, 6),
    antonyms: Array.from(antonyms).slice(0, 6)
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
  if(state.unlocked.has(key)) return;
  state.unlocked.add(key);
  const a = ACHIEVEMENTS.find(x=>x.key===key);
  if(a) showToast("🏅 Achievement unlocked: "+a.name);
  if(state.tab==="dashboard") renderDashboard();
}
function awardXP(amount){
  state.xp += amount;
  while(state.xp >= XP_PER_LEVEL){ state.xp -= XP_PER_LEVEL; state.level++; }
  if(state.wordsLearned.size>=1) unlock("first");
  if(state.wordsLearned.size>=100) unlock("words100");
  if(state.streak>=7) unlock("streak7");
  if(state.tab==="dashboard") renderDashboard();
}
function playAudio(url, btn){
  if(!url){ return; }
  const audio = new Audio(url);
  audio.play().catch(()=> showToast("Couldn't play pronunciation audio."));
}

/* ---------------- TABS ---------------- */
document.querySelectorAll("nav.tabs button").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll("nav.tabs button").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll("main > section").forEach(s=>s.classList.remove("active"));
    document.getElementById(btn.dataset.tab).classList.add("active");
    state.tab = btn.dataset.tab;
    if(btn.dataset.tab==="dashboard") renderDashboard();
    if(btn.dataset.tab==="quiz") startQuiz();
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
      ? `No dictionary entry found for “${key}.” Try one of the suggestions below.`
      : "Something went wrong reaching the dictionary API. Please try again.";
    defEl.classList.remove("definition"); defEl.classList.add("error-msg");
    document.getElementById("rPos").textContent = "";
    document.getElementById("rIpa").textContent = "";
    document.getElementById("rCefr").textContent = "—";
    document.getElementById("rFreq").textContent = "—";
    document.getElementById("examplesGrid").innerHTML = "";
    document.getElementById("synGroups").innerHTML = "";
    document.getElementById("rSubtitle").innerHTML = "";
    document.getElementById("rSpeaker").textContent = "";
    document.getElementById("rTime").textContent = "";
    searchBtn.disabled = false;
    return;
  }

  renderWordEntry(entry);
  searchBtn.disabled = false;

  if(!state.wordsLearned.has(entry.word.toLowerCase())){
    state.wordsLearned.add(entry.word.toLowerCase());
    state.clipsWatched += 1;
    awardXP(8);
  }
}

function renderWordEntry(entry){
  document.getElementById("rWord").textContent = entry.word;
  document.getElementById("rPos").textContent = entry.pos || "—";
  document.getElementById("rIpa").textContent = entry.phonetic || "";
  document.getElementById("rCefr").textContent = "—";
  document.getElementById("rFreq").textContent = "—";
  document.getElementById("rDef").textContent = entry.definition;
  document.getElementById("rDef").classList.remove("error-msg"); document.getElementById("rDef").classList.add("definition");

  // pronunciation buttons
  const ukBtn = document.getElementById("playBritish");
  const usBtn = document.getElementById("playAmerican");
  ukBtn.disabled = !entry.audioUk;
  usBtn.disabled = !entry.audioUs;
  ukBtn.onclick = ()=> playAudio(entry.audioUk, ukBtn);
  usBtn.onclick = ()=> playAudio(entry.audioUs, usBtn);

  // scene / example-in-context card, driven by the first live example if there is one
  const firstExample = entry.examples[0];
  document.getElementById("rSpeaker").textContent = "Example in context";
  document.getElementById("rTime").textContent = entry.pos || "";
  if(firstExample){
    const re = new RegExp(entry.word, "i");
    const highlighted = firstExample.text.replace(re, m=>`<mark>${m}</mark>`);
    document.getElementById("rSubtitle").innerHTML = highlighted;
  } else {
    document.getElementById("rSubtitle").innerHTML = "No example sentence was returned for this word.";
  }

  // example sentences grid
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
        <button class="icon-btn ${state.savedExamples.has(id)?'saved':''}" title="Save" data-id="${id}">♥️</button>
      </div>`;
    card.querySelector(".play-ex").addEventListener("click", ()=> playAudio(entry.audioUs || entry.audioUk));
    card.querySelector('[title="Save"]').addEventListener("click", e=>{
      if(state.savedExamples.has(id)){ state.savedExamples.delete(id); e.target.classList.remove("saved"); }
      else { state.savedExamples.add(id); e.target.classList.add("saved"); }
    });
    grid.appendChild(card);
  });

  // synonyms / antonyms
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

/* ---------------- QUIZ ---------------- */
let quizQueue=[], quizIndex=0; const QUIZ_LEN=5;

async function buildQuizQueue(){
  const card=document.getElementById("quizCard");
  card.innerHTML = `<div class="quiz-loading">Loading questions from the dictionary…</div>`;

  const types=["mcq","spelling","fillblank"];
  const picks = [];
  // sample QUIZ_LEN words (with repeats allowed if the list is short)
  for(let i=0;i<QUIZ_LEN;i++){
    picks.push(SUGGESTED_WORDS[Math.floor(Math.random()*SUGGESTED_WORDS.length)]);
  }

  const entries = await Promise.all(picks.map(w => fetchWordEntry(w).catch(()=>null)));

  quizQueue = [];
  entries.forEach((entry, i)=>{
    if(!entry) return; // skip any word the API failed to resolve
    let type = types[i % types.length];
    // spelling / fillblank need an example sentence — fall back to mcq if none
    if((type==="fillblank") && entry.examples.length===0) type = "mcq";
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
    card.innerHTML = `<span class="quiz-type-label">Session complete</span>
      <div class="quiz-question">Nice work — ${state.quizCorrect}/${quizQueue.length} correct this round.</div>
      <button class="quiz-next" style="display:inline-block" id="restartQuiz">Start another round</button>`;
    document.getElementById("restartQuiz").addEventListener("click", startQuiz);
    return;
  }
  const {entry,type}=quizQueue[quizIndex];
  const key = entry.word.toLowerCase();

  if(type==="mcq"){
    const otherEntries = quizQueue.filter((q,i)=>i!==quizIndex).map(q=>q.entry.definition);
    const distractors = otherEntries.length>=3 ? otherEntries.slice(0,3) :
      SUGGESTED_WORDS.filter(w=>w!==key).slice(0,3).map(()=> "A different, unrelated meaning.");
    const options=[entry.definition, ...distractors].sort(()=>Math.random()-0.5);
    card.innerHTML = `<span class="quiz-type-label">Choose the correct meaning</span>
      <div class="quiz-question">What does <mark>${key}</mark> mean?</div>
      <div class="quiz-options">${options.map(o=>`<button class="quiz-option" data-correct="${o===entry.definition}">${o}</button>`).join("")}</div>
      <div class="quiz-feedback"></div><button class="quiz-next">Next</button>`;
    card.querySelectorAll(".quiz-option").forEach(btn=>btn.addEventListener("click", ()=>{
      const correct = btn.dataset.correct==="true";
      card.querySelectorAll(".quiz-option").forEach(b=>{ b.disabled=true; if(b.dataset.correct==="true") b.classList.add("correct"); });
      if(!correct) btn.classList.add("wrong");
      markResult(correct, card);
    }));
  }
  if(type==="spelling"){
    card.innerHTML = `<span class="quiz-type-label">Write the word correctly</span>
      <div class="quiz-question">"${entry.definition}"</div>
      <div class="quiz-input-row"><input type="text" id="spellInput" placeholder="Type the word…" autocomplete="off"></div>
      <div class="quiz-feedback"></div><button class="quiz-next">Next</button>`;
    const input=card.querySelector("#spellInput");
    input.addEventListener("keydown", e=>{ if(e.key==="Enter"){ const c=e.target.value.trim().toLowerCase()===key; input.disabled=true; markResult(c,card,c?null:key);} });
  }
  if(type==="fillblank"){
    const ex = entry.examples[0].text; const re = new RegExp(key,"i");
    const blanked = ex.replace(re, "_____");
    card.innerHTML = `<span class="quiz-type-label">Fill in the missing word</span>
      <div class="quiz-question">${blanked}</div>
      <div class="quiz-input-row"><input type="text" id="blankInput" placeholder="Type the missing word…" autocomplete="off"></div>
      <div class="quiz-feedback"></div><button class="quiz-next">Next</button>`;
    const input=card.querySelector("#blankInput");
    input.addEventListener("keydown", e=>{ if(e.key==="Enter"){ const c=e.target.value.trim().toLowerCase()===key; input.disabled=true; markResult(c,card,c?null:key);} });
  }
  card.querySelector(".quiz-next").addEventListener("click", ()=>{ quizIndex++; renderQuizProgress(); renderQuizQuestion(); });
}
function markResult(correct, card, revealWord){
  state.quizTotal++; if(correct) state.quizCorrect++;
  awardXP(correct?6:2);
  const fb=card.querySelector(".quiz-feedback");
  fb.textContent = correct ? "Correct." : (revealWord?`Not quite — it was “${revealWord}.”`:"Not quite.");
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

function tick(){
  state.timer.elapsed++;
  state.todaySeconds++;
  state.weekSeconds++;
  state.monthSeconds++;
  state.totalSeconds++;
  const display = fmtHMS(state.timer.elapsed);
  liveTimerEl.textContent = display;
  miniTime.textContent = display;

  // XP every 30 minutes of tracked time
  if(state.timer.elapsed - state.timer.lastXpAward >= 1800){
    state.timer.lastXpAward = state.timer.elapsed;
    awardXP(10);
    showToast("+10 XP for 30 minutes of learning");
  }
  checkHourBadges();
  if(state.tab==="dashboard") updateTimeDisplaysOnly();
}
function checkHourBadges(){
  const hours = state.totalSeconds/3600;
  if(hours>=10) unlock("hours10");
  if(hours>=50) unlock("hours50");
  if(hours>=100) unlock("hours100");
}
function startTimer(){
  state.timer.running = true; state.timer.paused = false;
  state.timer.tickHandle = setInterval(tick, 1000);
  startBtn.disabled = true; pauseBtn.disabled = false; stopBtn.disabled = false;
  miniTimer.classList.add("show");
}
function pauseTimer(){
  clearInterval(state.timer.tickHandle);
  state.timer.running = false; state.timer.paused = true;
  startBtn.disabled = false; startBtn.textContent = "▶️ Resume Learning";
  pauseBtn.disabled = true;
}
function stopTimer(){
  clearInterval(state.timer.tickHandle);
  const durationMin = Math.max(1, Math.round(state.timer.elapsed/60));
  if(state.timer.elapsed>0){
    state.history.unshift({date:"Today", durationMin, activity:"Free Study"});
    state.weekly[6] = (state.weekly[6]||0) + durationMin; // add to "today" column (Sun slot as placeholder end-of-week)
    showToast(`Session saved — ${durationMin} min added to your totals`);
  }
  state.timer.elapsed = 0; state.timer.running=false; state.timer.paused=false; state.timer.lastXpAward=0;
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
  if(state.timer.running) pauseTimer(); else startTimer();
});
document.getElementById("miniStop").addEventListener("click", stopTimer);

function updateTimeDisplaysOnly(){
  document.getElementById("timeTotal").textContent = fmtHM(state.totalSeconds);
  document.getElementById("timeToday").textContent = fmtHM(state.todaySeconds);
  document.getElementById("timeWeek").textContent = fmtHM(state.weekSeconds);
  document.getElementById("timeMonth").textContent = fmtHM(state.monthSeconds);
}

/* ---------------- DASHBOARD ---------------- */
function rankForLevel(level){
  if(level<3) return ["A2","Elementary Learner"];
  if(level<6) return ["B1","Independent Speaker"];
  if(level<10) return ["B2","Confident Communicator"];
  if(level<15) return ["C1","Advanced Speaker"];
  return ["C2","Master of English"];
}
function renderDashboard(){
  document.getElementById("dLevel").textContent = state.level;
  document.getElementById("streakDays").textContent = state.streak;
  const [cefr,title] = rankForLevel(state.level);
  document.getElementById("dCefr").textContent = `${cefr} · ${title}`;
  document.getElementById("xpFill").style.width = state.xp+"%";
  document.getElementById("xpLabel").textContent = `${state.xp} / ${XP_PER_LEVEL} XP to next level`;

  document.getElementById("statWords").textContent = state.wordsLearned.size;
  document.getElementById("statStreak").textContent = state.streak;
  document.getElementById("statAccuracy").textContent = state.quizTotal ? Math.round(100*state.quizCorrect/state.quizTotal)+"%" : "—";
  document.getElementById("statClips").textContent = state.clipsWatched;

  updateTimeDisplaysOnly();

  // progress ring
  const pct = 75;
  document.getElementById("progressRing").style.background = `conic-gradient(var(--blue-2) ${pct*3.6}deg, var(--blue-light) 0deg)`;
  document.getElementById("progressPct").textContent = pct+"%";

  // weekly chart
  const weekBox = document.getElementById("weeklyChart"); weekBox.innerHTML="";
  const days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const maxMin = Math.max(...state.weekly, 60);
  state.weekly.forEach((min,i)=>{
    const col=document.createElement("div"); col.className="week-col";
    const barHeight = Math.max(6, Math.round((min/maxMin)*100));
    col.innerHTML = `<div class="week-bar" style="height:${barHeight}%"></div><div class="week-label">${days[i]}</div>`;
    weekBox.appendChild(col);
  });

  // heatmap
  const grid=document.getElementById("heatmapGrid"); grid.innerHTML="";
  for(let i=0;i<30;i++){
    const seed=(i*13+state.totalSeconds) % 5;
    const cell=document.createElement("div"); cell.className="heat-cell"+(i===29?" today":"");
    const alpha = seed===0?0.15:seed===1?0.35:seed===2?0.55:seed===3?0.75:0.95;
    cell.style.background = `rgba(30,150,252,${alpha})`;
    grid.appendChild(cell);
  }

  // history
  const histBody = document.getElementById("historyBody"); histBody.innerHTML="";
  state.history.slice(0,8).forEach(h=>{
    const tr=document.createElement("tr");
    tr.innerHTML = `<td>${h.date}</td><td>${h.durationMin>=60?Math.floor(h.durationMin/60)+"h "+(h.durationMin%60)+"m":h.durationMin+" min"}</td><td>${h.activity}</td>`;
    histBody.appendChild(tr);
  });

  const catGrid=document.getElementById("catGrid"); catGrid.innerHTML="";
  CATEGORIES.forEach(c=>{
    const pctC = Math.round(100*c.done/c.total);
    const div=document.createElement("div"); div.className="cat-card";
    div.innerHTML = `<div class="cname">${c.name}</div><div class="cnum">${c.done}/${c.total} words · ${pctC}%</div><div class="bar"><div style="width:${pctC}%"></div></div>`;
    catGrid.appendChild(div);
  });

  const badgeRow=document.getElementById("badgeRow"); badgeRow.innerHTML="";
  ACHIEVEMENTS.forEach(a=>{
    const unlocked = state.unlocked.has(a.key);
    const div=document.createElement("div"); div.className="achievement"+(unlocked?" unlocked":"");
    div.innerHTML = `<span class="ic">${a.ic}</span>${a.name}`;
    badgeRow.appendChild(div);
  });
}

renderDashboard();
