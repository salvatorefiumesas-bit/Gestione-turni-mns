// =====================================================================
//  Login amministratore + sincronizzazione cloud (Firebase)
//  L'app continua a usare il localStorage come sempre; questo modulo
//  intercetta le scritture e le copia su Firestore, e viceversa.
//
//  Dati su Firestore (collezione "turni"):
//    turni/storico        -> storico notti festive
//    turni/fineMese       -> notti di fine mese (per i riposi)
//    turni/coppie         -> coppie fisse
//    turni/mesi_AAAA-M    -> un documento per ogni mese (celle + blocchi manuali)
// =====================================================================
window.__syncBoot = true; // segnala a index.html che questo file è stato caricato

const $ = id => document.getElementById(id);
const FB = "https://www.gstatic.com/firebasejs/10.14.1/";
const MIN_SPLASH = 1900; // ms di splash screen

// chiave localStorage dell'app -> nome logico
const LK = { storico: "turni_storico_v1", fineMese: "turni_fine_v1", mesi: "turni_celle_v1", coppie: "turni_coppie_v1" };
const DEF = { storico: "{}", fineMese: "{}", mesi: "{}", coppie: "[]" };
const SIMPLE = ["storico", "fineMese", "coppie"];
const byLocal = Object.fromEntries(Object.entries(LK).map(([n, k]) => [k, n]));

const _set = Storage.prototype.setItem, _rem = Storage.prototype.removeItem, _get = Storage.prototype.getItem;
const rd = n => { const v = _get.call(localStorage, LK[n]); return v === null ? DEF[n] : v; };
const parse = (s, f) => { try { const v = JSON.parse(s); return v === undefined ? f : v; } catch (e) { return f; } };
const applyLocal = (n, v) => _set.call(localStorage, LK[n], v);

// ---------- Stato ----------
let active = false, reconciled = false, unlocked = false;
let db = null, auth = null, fb = null, unsub = null, currentUid = null;
let timer = null, retry = null, lastSnap = null, quietUntil = 0, errMsg = "";
let remoteMesi = {};
const dirty = new Set();

const minSplash = new Promise(r => setTimeout(r, Math.max(0, MIN_SPLASH - performance.now())));

// ---------- Intercetta le scritture dell'app ----------
Storage.prototype.setItem = function (k, v) {
  _set.call(this, k, v);
  if (this === localStorage && active && byLocal[k]) markDirty(byLocal[k]);
};
Storage.prototype.removeItem = function (k) {
  _rem.call(this, k);
  if (this === localStorage && active && byLocal[k]) markDirty(byLocal[k]);
};

// ---------- Interfaccia ----------
function setMsg(t) { const e = $("spMsg"); if (e) e.textContent = t; }
function showBusy(t) {
  $("loginForm").hidden = true; $("spBar").hidden = false; $("spMsg").hidden = false; setMsg(t);
}
function showLogin(msg) {
  const s = $("splash");
  s.style.display = ""; void s.offsetWidth; s.classList.remove("hide");
  document.body.classList.add("locked");
  $("logout").hidden = true;
  $("spBar").hidden = true; $("spMsg").hidden = true; $("loginForm").hidden = false;
  $("lgBtn").disabled = false; $("lgBtn").textContent = "ACCEDI";
  $("loginErr").className = ""; $("loginErr").textContent = msg || "";
  setTimeout(() => { try { ($("lgEmail").value ? $("lgPass") : $("lgEmail")).focus(); } catch (e) {} }, 100);
}
function unlock() {
  document.body.classList.remove("locked");
  const s = $("splash"); s.classList.add("hide");
  setTimeout(() => { if (s.classList.contains("hide")) s.style.display = "none"; }, 700);
  window.scrollTo(0, 0);
}
function fatal(t) {
  $("spBar").hidden = true; $("spMsg").hidden = true; $("loginForm").hidden = true;
  const c = $("cfgErr"); c.hidden = false;
  c.innerHTML = t + '<br><br><button class="primary" onclick="location.reload()">RIPROVA</button>';
}
function setStatus(txt, cls) { const e = $("syncStatus"); if (e) { e.textContent = txt; e.className = cls || ""; } }
function updStatus() {
  if (!db) return;
  if (errMsg) return setStatus("⚠ " + errMsg, "err");
  const pend = dirty.size || (lastSnap && lastSnap.metadata.hasPendingWrites);
  if (!navigator.onLine) return setStatus("☁ Offline" + (pend ? " · modifiche in coda" : ""), "wait");
  if (pend) return setStatus("☁ Sincronizzazione…", "wait");
  setStatus("☁ Sincronizzato", "ok");
}
function reloadApp() { if (typeof window.appReload === "function") window.appReload(); }

// ---------- Scrittura su Firestore ----------
function onWriteErr(e) {
  errMsg = e && e.code === "permission-denied" ? "Accesso negato (controlla le regole Firestore)" : "Errore di sincronizzazione";
  updStatus();
}
const stamp = () => fb.serverTimestamp();
function pushSimple(n) {
  fb.setDoc(fb.doc(db, "turni", n), { json: rd(n), updatedAt: stamp() }).then(() => { errMsg = ""; }).catch(onWriteErr);
}
function pushMonth(k, j) {
  fb.setDoc(fb.doc(db, "turni", "mesi_" + k), { json: j, updatedAt: stamp() }).then(() => { errMsg = ""; }).catch(onWriteErr);
}
function pushMesi() {
  const lm = parse(rd("mesi"), {});
  for (const k of Object.keys(lm)) {
    const j = JSON.stringify(lm[k]);
    if (remoteMesi[k] !== j) { remoteMesi[k] = j; pushMonth(k, j); }
  }
  for (const k of Object.keys(remoteMesi)) {
    if (!(k in lm)) { delete remoteMesi[k]; fb.deleteDoc(fb.doc(db, "turni", "mesi_" + k)).catch(onWriteErr); }
  }
}
function markDirty(n) {
  dirty.add(n);
  clearTimeout(timer); timer = setTimeout(flush, 700);
  updStatus();
}
function flush() {
  clearTimeout(timer); timer = null;
  if (!active || !db || !dirty.size) return;
  const names = [...dirty]; dirty.clear();
  quietUntil = Date.now() + 1500;
  names.forEach(n => n === "mesi" ? pushMesi() : pushSimple(n));
  updStatus();
}
document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });
addEventListener("pagehide", flush);
addEventListener("online", updStatus);
addEventListener("offline", updStatus);

// ---------- Ricezione da Firestore ----------
function onSnap(snap) {
  lastSnap = snap;
  // Non sovrascrivere modifiche locali appena fatte o in invio
  if (dirty.size || Date.now() < quietUntil) {
    clearTimeout(retry); retry = setTimeout(() => lastSnap && onSnap(lastSnap), 400);
    updStatus(); return;
  }
  const server = !snap.metadata.fromCache;
  const docs = {}; snap.forEach(d => { docs[d.id] = d.data(); });
  remoteMesi = {};
  for (const id in docs) if (id.startsWith("mesi_") && typeof docs[id].json === "string") remoteMesi[id.slice(5)] = docs[id].json;

  // Prima sincronizzazione con il server: i dati presenti solo in locale vengono caricati
  if (!reconciled && server) {
    for (const n of SIMPLE) if (!docs[n] && rd(n) !== DEF[n]) pushSimple(n);
    const lm = parse(rd("mesi"), {});
    for (const k of Object.keys(lm)) if (!(k in remoteMesi)) { const j = JSON.stringify(lm[k]); remoteMesi[k] = j; pushMonth(k, j); }
    reconciled = true;
  }

  let changed = false;
  for (const n of SIMPLE) {
    if (docs[n] && typeof docs[n].json === "string" && docs[n].json !== rd(n)) { applyLocal(n, docs[n].json); changed = true; }
  }
  const lm = parse(rd("mesi"), {}), out = reconciled ? {} : { ...lm };
  for (const k of Object.keys(remoteMesi)) { const v = parse(remoteMesi[k], null); if (v) out[k] = v; }
  const same = Object.keys(out).length === Object.keys(lm).length &&
    Object.keys(out).every(k => k in lm && JSON.stringify(lm[k]) === JSON.stringify(out[k]));
  if (!same) { applyLocal("mesi", JSON.stringify(out)); changed = true; }

  if (changed) reloadApp();
  if (server) errMsg = "";
  updStatus();
  if (server || snap.size > 0) tryUnlock();
}
function onSnapErr(e) {
  errMsg = e && e.code === "permission-denied" ? "Accesso negato (controlla le regole Firestore)" : "Errore di connessione al cloud";
  updStatus(); tryUnlock();
}
function tryUnlock() {
  if (unlocked) return;
  unlocked = true; reloadApp(); $("logout").hidden = false; unlock();
}

function startSync(user) {
  if (active && currentUid === user.uid) return;
  stopSync(false);
  currentUid = user.uid; active = true; reconciled = false; unlocked = false; errMsg = "";
  setMsg("Sincronizzazione dati…");
  setTimeout(tryUnlock, 4500); // se offline e senza cache, apri comunque con i dati locali
  unsub = fb.onSnapshot(fb.collection(db, "turni"), { includeMetadataChanges: true }, onSnap, onSnapErr);
}
function stopSync(clearLocal) {
  active = false; currentUid = null; reconciled = false; unlocked = false;
  clearTimeout(timer); clearTimeout(retry); dirty.clear(); lastSnap = null; remoteMesi = {};
  if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
  if (clearLocal) Object.values(LK).forEach(k => _rem.call(localStorage, k));
}

// ---------- Login ----------
function authErr(e) {
  switch (e && e.code) {
    case "auth/invalid-credential": case "auth/wrong-password": case "auth/user-not-found": case "auth/invalid-email":
      return "Email o password non corretti.";
    case "auth/too-many-requests": return "Troppi tentativi. Riprova tra qualche minuto.";
    case "auth/network-request-failed": return "Nessuna connessione a internet.";
    case "auth/user-disabled": return "Questo account è disabilitato.";
    case "auth/unauthorized-domain": return "Dominio non autorizzato: aggiungilo in Firebase > Authentication > Impostazioni > Domini autorizzati.";
    default: return "Accesso non riuscito (" + ((e && e.code) || "errore") + ").";
  }
}
function wireLogin() {
  $("loginForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const email = $("lgEmail").value.trim(), pass = $("lgPass").value;
    $("loginErr").className = ""; $("loginErr").textContent = "";
    $("lgBtn").disabled = true; $("lgBtn").textContent = "ACCESSO…";
    try {
      await fb.signInWithEmailAndPassword(auth, email, pass);
      $("lgPass").value = "";
      showBusy("Sincronizzazione dati…");
    } catch (e) {
      $("lgBtn").disabled = false; $("lgBtn").textContent = "ACCEDI";
      $("loginErr").textContent = authErr(e);
    }
  });
  $("lgReset").addEventListener("click", async () => {
    const email = $("lgEmail").value.trim(), er = $("loginErr");
    if (!email) { er.className = ""; er.textContent = "Scrivi prima la tua email."; return; }
    try { await fb.sendPasswordResetEmail(auth, email); er.className = "okmsg"; er.textContent = "Email di recupero inviata (controlla anche lo spam)."; }
    catch (e) { er.className = ""; er.textContent = authErr(e); }
  });
  $("logout").addEventListener("click", async () => {
    const pend = dirty.size || (lastSnap && lastSnap.metadata.hasPendingWrites);
    const q = pend ? "Ci sono modifiche non ancora sincronizzate: uscendo andranno perse. Uscire lo stesso?" : "Uscire dall'account? Dovrai rifare l'accesso.";
    if (!confirm(q)) return;
    stopSync(true);
    try { await fb.signOut(auth); } catch (e) {}
    try { await fb.terminate(db); await fb.clearIndexedDbPersistence(db); } catch (e) {}
    location.reload();
  });
}

// ---------- Avvio ----------
(async function boot() {
  let firebaseConfig;
  try {
    ({ firebaseConfig } = await import("./firebase-config.js"));
    if (!firebaseConfig || typeof firebaseConfig !== "object") throw new Error("config mancante");
  } catch (e) {
    fatal("Il file <b>firebase-config.js</b> non è valido o manca.<br>Deve contenere <code>export const firebaseConfig = {…}</code> come nel file originale: incolla solo i valori tra le graffe.");
    return;
  }
  const configured = !/INCOLLA/.test(JSON.stringify(firebaseConfig));
  if (!configured) {
    // Nessun Firebase configurato: l'app funziona solo in locale
    await minSplash; unlocked = true; unlock();
    setStatus("☁ Solo locale · Firebase non configurato", "wait");
    return;
  }
  try {
    const [A, Au, Fs] = await Promise.all([import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js")]);
    fb = { ...A, ...Au, ...Fs };
  } catch (e) {
    fatal("Impossibile caricare i componenti Firebase.<br>Controlla la connessione a internet e riprova.");
    return;
  }
  const app = fb.initializeApp(firebaseConfig);
  auth = fb.getAuth(app);
  try {
    db = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) });
  } catch (e) { db = fb.getFirestore(app); }
  wireLogin();
  fb.onAuthStateChanged(auth, async user => {
    await minSplash;
    if (user) { showBusy("Sincronizzazione dati…"); startSync(user); }
    else { stopSync(true); showLogin(); }
  });
})();
