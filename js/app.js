// js/app.js
// ==========================================
// IMPORTS
// ==========================================
import {
  db, ref, set, update, get, onValue,
  auth, signInAnonymously, onAuthStateChanged
} from "./firebase.js";

// ==========================================
// DOM ELEMENTS
// ==========================================
const screenRoom = document.getElementById("screen-room");
const screenQuestions = document.getElementById("screen-questions");
const screenResult = document.getElementById("screen-result");

const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("JoinRoomBtn");

const createRoomInput = document.getElementById("createRoomInput");
const joinRoomInput = document.getElementById("joinRoomInput");

const submitAnswersBtn = document.getElementById("submitAnswersBtn");

const q1 = document.getElementById("q1");
const q2 = document.getElementById("q2");
const q3 = document.getElementById("q3");

const compatibilityScoreEl = document.getElementById("compatibilityScore");
const compatibilityTextEl = document.getElementById("compatibilityText");

let currentRoom = null;
let currentUid = null;

// ==========================================
// HELPERS
// ==========================================
function showScreen(screen) {
  [screenRoom, screenQuestions, screenResult].forEach(s => s.classList.add("hidden"));
  screen.classList.remove("hidden");
}
function showScreenDelayed(screen, ms = 500) {
  setTimeout(() => showScreen(screen), ms);
}
function roomKey(name) {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

// ==========================================
// AUTH
// ==========================================
async function ensureAuth() {
  if (auth.currentUser) {
    currentUid = auth.currentUser.uid;
    return currentUid;
  }
  const res = await signInAnonymously(auth);
  currentUid = res.user.uid;
  return currentUid;
}
onAuthStateChanged(auth, (user) => {
  if (user) currentUid = user.uid;
});

// ==========================================
// CREATE ROOM
// ==========================================
createRoomBtn.addEventListener("click", async () => {
  await ensureAuth();
  const name = createRoomInput.value.trim();
  if (!name) return alert("Enter a room name.");
  const key = roomKey(name);
  const roomRef = ref(db, `rooms/${key}`);
  const snap = await get(roomRef);
  if (snap.exists()) return alert("Room exists — join it instead.");
  await set(roomRef, {
    name,
    createdAt: Date.now(),
    participants: { [currentUid]: { joinedAt: Date.now() } },
    answers: {},
    result: null
  });
  joinRoomInternal(key);
});

// ==========================================
// JOIN ROOM
// ==========================================
joinRoomBtn.addEventListener("click", async () => {
  await ensureAuth();
  const name = joinRoomInput.value.trim();
  if (!name) return alert("Enter room name.");
  const key = roomKey(name);
  const roomRef = ref(db, `rooms/${key}`);
  const snap = await get(roomRef);
  if (!snap.exists()) return alert("Room not found.");
  await update(ref(db, `rooms/${key}/participants`), {
    [currentUid]: { joinedAt: Date.now() }
  });
  joinRoomInternal(key);
});

function joinRoomInternal(key) {
  currentRoom = key;
  showScreenDelayed(screenQuestions);
  listenRoom(key);
}

// ==========================================
// SUBMIT ANSWERS
// ==========================================
submitAnswersBtn.addEventListener("click", async () => {
  await ensureAuth();
  if (!currentRoom) return alert("Not in a room.");
  const a1 = q1.value.trim(), a2 = q2.value.trim(), a3 = q3.value.trim();
  if (!a1 || !a2 || !a3) return alert("Answer all 3 questions.");
  await set(ref(db, `rooms/${currentRoom}/answers/${currentUid}`), {
    q1: a1, q2: a2, q3: a3, submittedAt: Date.now()
  });
  compatibilityScoreEl.textContent = "Score: --%";
  compatibilityTextEl.textContent = "Waiting for your partner…";
  showScreenDelayed(screenResult);
});

// ==========================================
// LISTEN ROOM (server evaluate + fallback)
// ==========================================
function listenRoom(key) {
  const roomRef = ref(db, `rooms/${key}`);
  onValue(roomRef, async (snap) => {
    const data = snap.val();
    if (!data) return;

    // if result exists: show & schedule delete
    if (data.result) {
      displayResult(data.result);
      setTimeout(async () => {
        try { await set(ref(db, `rooms/${key}`), null); } catch (e) { console.error("Delete failed:", e); }
      }, 2 * 60 * 1000);
      return;
    }

    const answers = data.answers || {};
    const ids = Object.keys(answers);

    if (ids.length >= 2) {
      // call server /api/evaluate with both answers
      let result = null;
      try {
        result = await fetch("/api/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ a: answers[ids[0]], b: answers[ids[1]] })
        }).then(r => {
          if (!r.ok) throw new Error("evaluate failed");
          return r.json();
        });
      } catch (err) {
        console.warn("Server evaluate failed, falling back to local:", err);
      }

      if (!result) {
        result = computeCompatibility(answers[ids[0]], answers[ids[1]]);
      }

      try {
        await set(ref(db, `rooms/${key}/result`), result);
      } catch (e) { console.error("Write result failed:", e); }

      displayResult(result);

      // auto-delete after 2 minutes (safety)
      setTimeout(async () => {
        try { await set(ref(db, `rooms/${key}`), null); } catch (e) { console.error("Delete failed:", e); }
      }, 2 * 60 * 1000);
    } else {
      if (answers[currentUid]) {
        compatibilityTextEl.textContent = "Waiting for your partner…";
        showScreenDelayed(screenResult);
      }
    }
  });
}

// ==========================================
// DISPLAY RESULT
// ==========================================
function displayResult(result) {
  compatibilityScoreEl.textContent = `Score: ${Math.round(result.percentage)}%`;
  compatibilityTextEl.textContent = result.message;
  showScreenDelayed(screenResult);
}

// ==========================================
// FALLBACK LOCAL JACCARD COMPATIBILITY
// ==========================================
function computeCompatibility(a, b) {
  const s1 = jaccard(simTokens(a.q1), simTokens(b.q1));
  const s2 = jaccard(simTokens(a.q2), simTokens(b.q2));
  const s3 = jaccard(simTokens(a.q3), simTokens(b.q3));
  const avg = (s1 + s2 + s3) / 3;
  const percentage = avg * 100;
  let message =
    percentage >= 80 ? "Perfect match ❤️" :
    percentage >= 60 ? "Great compatibility 💕" :
    percentage >= 40 ? "Some differences 😊" :
    "Very different answers 😅";
  return { percentage, message, computedAt: Date.now() };
}
function simTokens(text) {
  if (!text) return new Set();
  const stop = new Set(["a","the","and","or","to","of","in","is","are","it","you","your","my","me","for","with","that","this","as","be","so","do"]);
  const cleaned = (text||"").toLowerCase().replace(/[^\w\s]/g," ");
  return new Set(cleaned.split(/\s+/).filter(t => t && !stop.has(t) && t.length>1));
}
function jaccard(sa, sb) {
  const A = Array.from(sa), B = new Set(Array.from(sb));
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}

// ==========================================
// START APP
// ==========================================
(async () => {
  await ensureAuth();
  showScreen(screenRoom);
})();
