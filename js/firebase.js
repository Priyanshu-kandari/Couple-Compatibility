// js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getDatabase,
  ref as dbRef,
  set as dbSet,
  update as dbUpdate,
  get as dbGet,
  onValue as dbOnValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDq52GKbccCA1zWbkGUk_OAVDg2j65jcIg",
  authDomain: "couple-compatibility.firebaseapp.com",
  databaseURL: "https://couple-compatibility-default-rtdb.firebaseio.com",
  projectId: "couple-compatibility",
  storageBucket: "couple-compatibility.firebasestorage.app",
  messagingSenderId: "18122368486",
  appId: "1:18122368486:web:4a3f9c6d1a89f3ed8e2227"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

// Optional: expose to window for quick console checks (remove if you don't want globals)
window.db = db;
window.ref = dbRef;
window.set = dbSet;
window.update = dbUpdate;
window.get = dbGet;
window.onValue = dbOnValue;
window.auth = auth;
window.signInAnonymously = signInAnonymously;
window.onAuthStateChanged = onAuthStateChanged;
window.signOut = signOut;

// Export named bindings so other modules (app.js) can import them
export {
  db,
  dbRef as ref,
  dbSet as set,
  dbUpdate as update,
  dbGet as get,
  dbOnValue as onValue,
  auth,
  signInAnonymously,
  onAuthStateChanged,
  signOut
};
