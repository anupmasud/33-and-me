/* ============================================================
   33&Me — a personal record collection PWA
   Data lives in the owner's Google Sheet. No server, no DB.
   ============================================================ */
(() => {
  "use strict";

  const C = window.CONFIG;
  const API = "https://sheets.googleapis.com/v4/spreadsheets/" + C.SPREADSHEET_ID;

  // Columns the app guarantees exist on the collection tab.
  const APP_COLUMNS = ["Format", "Condition", "Listen Count", "Last Listened", "Rating", "Notes"];
  const WISH_HEADER = ["Artist", "Title", "Genre", "Notes", "Added"];

  // ---------- state ----------
  const state = {
    token: null,
    tokenExp: 0,
    headers: [],            // collection header row
    col: {},                // header name -> column index
    collection: [],         // {row, artist, title, genre, ...}
    wishlist: [],           // {row, artist, title, genre, notes}
    collectionSheet: null,  // {title, sheetId}
    wishlistSheet: null,
    scope: "all",
    addMode: "record",
    pendingWishRow: null,   // wish row to delete after "Got it" save
    busy: 0,
  };

  // ---------- tiny helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const norm = (s) => (s || "").toString().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const colLetter = (i) => { // 0-based index -> A1 letter
    let s = ""; i += 1;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  };
  const esc = (s) => (s || "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function toast(msg, ms = 2600) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.add("hidden"), ms);
  }

  function setBusy(on) {
    state.busy += on ? 1 : -1;
    $("#sync-disc").classList.toggle("spinning", state.busy > 0);
  }

  // ---------- auth (Google Identity Services) ----------
  let tokenClient = null;

  function initAuth() {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: C.CLIENT_ID,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      callback: () => {},
    });
    // restore session token if still valid
    try {
      const saved = JSON.parse(sessionStorage.getItem("t33") || "null");
      if (saved && saved.exp > Date.now() + 60000) {
        state.token = saved.token; state.tokenExp = saved.exp;
      }
    } catch (_) { /* ignore */ }
  }

  function getToken(interactive) {
    return new Promise((resolve, reject) => {
      if (state.token && state.tokenExp > Date.now() + 60000) return resolve(state.token);
      if (!tokenClient) return reject(new Error("Auth not ready"));
      tokenClient.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        state.token = resp.access_token;
        state.tokenExp = Date.now() + (resp.expires_in ? resp.expires_in * 1000 : 3500 * 1000);
        sessionStorage.setItem("t33", JSON.stringify({ token: state.token, exp: state.tokenExp }));
        resolve(state.token);
      };
      try {
        tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
      } catch (e) { reject(e); }
    });
  }

  function signOut() {
    if (state.token) { try { google.accounts.oauth2.revoke(state.token); } catch (_) {} }
    state.token = null; state.tokenExp = 0;
    sessionStorage.removeItem("t33");
    showSignin();
  }

  // ---------- Sheets API ----------
  async function api(path, opts = {}, retry = true) {
    const token = await getToken(false).catch(() => getToken(true));
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401 && retry) {
      state.token = null;
      return api(path, opts, false);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error("Sheets API " + res.status + ": " + body.slice(0, 200));
    }
    return res.json();
  }

  const q = encodeURIComponent;

  // Google Sheets treats tab names case-insensitively for uniqueness,
  // so match the same way (and ignore stray whitespace).
  const sameName = (a, b) =>
    (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();

  async function ensureSetup() {
    let sheets = (await api("?fields=sheets.properties")).sheets.map((s) => s.properties);
    state.collectionSheet =
      sheets.find((s) => sameName(s.title, C.COLLECTION_SHEET)) || sheets[0];
    state.wishlistSheet = sheets.find((s) => sameName(s.title, C.WISHLIST_SHEET)) || null;

    // create Wishlist tab if missing
    if (!state.wishlistSheet) {
      try {
        const r = await api(":batchUpdate", {
          method: "POST",
          body: JSON.stringify({ requests: [{ addSheet: { properties: { title: C.WISHLIST_SHEET } } }] }),
        });
        state.wishlistSheet = r.replies[0].addSheet.properties;
        await api("/values/" + q(`${state.wishlistSheet.title}!A1`) + "?valueInputOption=USER_ENTERED", {
          method: "PUT",
          body: JSON.stringify({ values: [WISH_HEADER] }),
        });
      } catch (e) {
        // A tab differing only by case can slip past the check above and make
        // addSheet fail with "already exists" — re-read the tabs and use it.
        sheets = (await api("?fields=sheets.properties")).sheets.map((s) => s.properties);
        state.wishlistSheet = sheets.find((s) => sameName(s.title, C.WISHLIST_SHEET)) || null;
        if (!state.wishlistSheet) throw e;
      }
    }

    // ensure app columns exist on the collection header row
    const t = state.collectionSheet.title;
    const head = await api("/values/" + q(`${t}!1:1`));
    let headers = (head.values && head.values[0]) || [];
    const missing = APP_COLUMNS.filter((h) => !headers.includes(h));
    if (missing.length) {
      headers = headers.concat(missing);
      await api("/values/" + q(`${t}!1:1`) + "?valueInputOption=USER_ENTERED", {
        method: "PUT",
        body: JSON.stringify({ values: [headers] }),
      });
    }
    state.headers = headers;
    state.col = {};
    headers.forEach((h, i) => { state.col[h] = i; });
  }

  function hv(row, name) { // header value
    const i = state.col[name];
    return i === undefined ? "" : (row[i] || "");
  }

  async function loadData() {
    const t = state.collectionSheet.title;
    const data = await api(
      "/values:batchGet?ranges=" + q(t) + "&ranges=" + q(state.wishlistSheet.title) +
      "&majorDimension=ROWS"
    );
    const [colRange, wishRange] = data.valueRanges;

    const rows = (colRange.values || []).slice(1);
    state.collection = rows.map((r, i) => ({
      row: i + 2, // 1-based + header
      artist: hv(r, "Artist"),
      title: hv(r, "Album Name") || hv(r, "Title"),
      genre: hv(r, "Genre"),
      location: hv(r, "Location"),
      year: hv(r, "Year"),
      format: hv(r, "Format"),
      condition: hv(r, "Condition"),
      listens: parseInt(hv(r, "Listen Count"), 10) || 0,
      lastListened: hv(r, "Last Listened"),
      notes: hv(r, "Notes"),
    })).filter((x) => x.artist || x.title);

    const wrows = (wishRange.values || []).slice(1);
    state.wishlist = wrows.map((r, i) => ({
      row: i + 2,
      artist: r[0] || "", title: r[1] || "", genre: r[2] || "", notes: r[3] || "",
    })).filter((x) => x.artist || x.title || x.genre);

    localStorage.setItem("cache33", JSON.stringify({
      ts: Date.now(), collection: state.collection, wishlist: state.wishlist,
    }));
  }

  function loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem("cache33") || "null");
      if (c) { state.collection = c.collection; state.wishlist = c.wishlist; return true; }
    } catch (_) {}
    return false;
  }

  // ---------- actions ----------
  async function markListened(item) {
    const t = state.collectionSheet.title;
    const count = item.listens + 1;
    const date = todayISO();
    const cCol = colLetter(state.col["Listen Count"]);
    const dCol = colLetter(state.col["Last Listened"]);
    setBusy(true);
    try {
      await api("/values:batchUpdate", {
        method: "POST",
        body: JSON.stringify({
          valueInputOption: "USER_ENTERED",
          data: [
            { range: `${t}!${cCol}${item.row}`, values: [[count]] },
            { range: `${t}!${dCol}${item.row}`, values: [[date]] },
          ],
        }),
      });
      item.listens = count; item.lastListened = date;
      toast(`♪ Listen #${count} logged`);
      render();
    } catch (e) {
      toast("Couldn't save — are you online?");
    } finally { setBusy(false); }
  }

  async function addRecord(f) {
    const width = state.headers.length;
    const row = new Array(width).fill("");
    const put = (name, val) => { if (state.col[name] !== undefined) row[state.col[name]] = val; };
    const maxSN = state.collection.reduce((m) => m + 1, 1);
    put("SN", String(maxSN));
    put("Artist", f.artist); put("Album Name", f.title); put("Genre", f.genre);
    put("Location", f.location); put("Year", f.year);
    put("Date", f.date); put("Original Cost", f.price); put("Original Currency", f.currency);
    if (norm(f.currency) === "usd") put("Cost (USD)", f.price);
    put("Format", f.format); put("Condition", f.condition); put("Notes", f.notes);
    put("Listen Count", "0");

    const t = state.collectionSheet.title;
    setBusy(true);
    try {
      await api("/values/" + q(t) + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", {
        method: "POST",
        body: JSON.stringify({ values: [row] }),
      });
      if (state.pendingWishRow) {
        await deleteWishRow(state.pendingWishRow);
        state.pendingWishRow = null;
      }
      await loadData();
      toast(`Added "${f.title}" to your crates ♪`);
      closeSheet(); render();
    } catch (e) {
      toast("Couldn't save — are you online?");
    } finally { setBusy(false); }
  }

  async function addWish(f) {
    setBusy(true);
    try {
      await api("/values/" + q(state.wishlistSheet.title) + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", {
        method: "POST",
        body: JSON.stringify({ values: [[f.artist, f.title, f.genre, f.notes, todayISO()]] }),
      });
      await loadData();
      toast("Added to wishlist ✦");
      closeSheet(); render();
    } catch (e) {
      toast("Couldn't save — are you online?");
    } finally { setBusy(false); }
  }

  async function deleteWishRow(rowNumber) {
    await api(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        requests: [{
          deleteDimension: {
            range: {
              sheetId: state.wishlistSheet.sheetId, dimension: "ROWS",
              startIndex: rowNumber - 1, endIndex: rowNumber,
            },
          },
        }],
      }),
    });
  }

  async function removeWish(item) {
    setBusy(true);
    try {
      await deleteWishRow(item.row);
      await loadData();
      toast("Removed from wishlist");
      render();
    } catch (e) {
      toast("Couldn't remove — are you online?");
    } finally { setBusy(false); }
  }

  // ---------- search & render ----------
  function matches(item, terms) {
    const hay = norm(item.artist + " " + item.title + " " + item.genre);
    return terms.every((t) => hay.includes(t));
  }

  function render() {
    const qv = norm($("#search-input").value);
    const terms = qv.split(/\s+/).filter(Boolean);
    const scope = state.scope;
    const out = [];

    const colHits = terms.length ? state.collection.filter((i) => matches(i, terms)) : state.collection;
    const wishHits = terms.length ? state.wishlist.filter((i) => matches(i, terms)) : state.wishlist;

    if (scope !== "wishlist") {
      out.push(`<div class="group-label">Collection · ${colHits.length}</div>`);
      if (!colHits.length && terms.length) {
        out.push(`<div class="card"><div class="card-main">
          <div class="card-title">Not in your crates</div>
          <div class="card-meta">No copy of this in your collection.</div></div>
          <button class="chip-btn" data-wishquick="1">+ Wishlist</button></div>`);
      }
      colHits.slice(0, 80).forEach((i, idx) => {
        out.push(`<div class="card rec">
          <div class="card-main">
            <div class="card-title">${esc(i.title)}</div>
            <div class="card-artist">${esc(i.artist)}</div>
            <div class="card-meta">${esc([i.genre, i.format, i.year, i.location].filter(Boolean).join(" · "))}</div>
            ${i.notes ? `<div class="card-notes">${esc(i.notes)}</div>` : ""}
          </div>
          <div>
            <button class="listen-btn" data-listen="${idx}">♪ Listened</button>
            <div class="listen-meta">${i.listens ? `${i.listens}× · ${esc(i.lastListened || "")}` : "never played"}</div>
          </div>
        </div>`);
      });
      render._colHits = colHits;
    }

    if (scope !== "collection") {
      out.push(`<div class="group-label">Wishlist · ${wishHits.length}</div>`);
      if (!wishHits.length && terms.length) {
        out.push(`<div class="empty" style="padding:12px">Not on your wishlist either.</div>`);
      }
      wishHits.slice(0, 80).forEach((i, idx) => {
        out.push(`<div class="card wish">
          <div class="card-main">
            <div class="card-title">${esc(i.title || "Anything by…")}</div>
            <div class="card-artist">${esc(i.artist)}</div>
            <div class="card-meta">${esc([i.genre, i.notes].filter(Boolean).join(" · "))}</div>
          </div>
          <div class="wish-actions">
            <button class="chip-btn got" data-got="${idx}">Got it!</button>
            <button class="chip-btn" data-unwish="${idx}">Remove</button>
          </div>
        </div>`);
      });
      render._wishHits = wishHits;
    }

    if (!terms.length && !state.collection.length && !state.wishlist.length) {
      out.length = 0;
      out.push(`<div class="empty"><div class="big">The crates are empty</div>
        Tap + to add your first record or wish.</div>`);
    }

    $("#results").innerHTML = out.join("");
    $("#count-line").textContent =
      `${state.collection.length} records · ${state.wishlist.length} wishes`;
  }

  // ---------- add sheet UI ----------
  function openSheet(mode, prefill) {
    state.addMode = mode || "record";
    $("#add-sheet").classList.remove("hidden");
    $("#sheet-backdrop").classList.remove("hidden");
    document.querySelectorAll("[data-addmode]").forEach((b) =>
      b.classList.toggle("active", b.dataset.addmode === state.addMode));
    applyAddMode();
    const form = $("#add-form");
    form.reset();
    form.date.value = todayISO();
    if (prefill) {
      form.artist.value = prefill.artist || "";
      form.title.value = prefill.title || "";
      form.genre.value = prefill.genre || "";
    }
    // genre suggestions from existing data
    const genres = [...new Set(state.collection.map((i) => i.genre).filter(Boolean))].sort();
    $("#genre-list").innerHTML = genres.map((g) => `<option value="${esc(g)}">`).join("");
    checkDup();
    setTimeout(() => form.artist.focus(), 60);
  }

  function applyAddMode() {
    const record = state.addMode === "record";
    document.querySelectorAll(".record-only").forEach((el) => el.classList.toggle("hidden-mode", !record));
    document.querySelectorAll(".req-record").forEach((el) => el.classList.toggle("hidden-mode", !record));
    $("#save-add").textContent = record ? "Save record" : "Save wish";
  }

  function closeSheet() {
    $("#add-sheet").classList.add("hidden");
    $("#sheet-backdrop").classList.add("hidden");
    state.pendingWishRow = null;
  }

  function checkDup() {
    const f = $("#add-form");
    const a = norm(f.artist.value), t = norm(f.title.value);
    const warn = $("#dup-warning");
    if (!a && !t) { warn.classList.add("hidden"); return; }
    const dup = state.collection.find((i) =>
      (a && norm(i.artist).includes(a) || !a) &&
      (t && norm(i.title).includes(t) || !t) && (a || t) && (a && t));
    if (dup) {
      warn.textContent = `⚠ You may already own this: "${dup.title}" — ${dup.artist}`;
      warn.classList.remove("hidden");
    } else {
      warn.classList.add("hidden");
    }
  }

  // ---------- boot ----------
  function showSignin() {
    $("#signin-view").classList.remove("hidden");
    $("#app-view").classList.add("hidden");
  }

  async function showApp() {
    $("#signin-view").classList.add("hidden");
    $("#app-view").classList.remove("hidden");
    const hadCache = loadCache();
    if (hadCache) render();
    setBusy(true);
    try {
      await ensureSetup();
      await loadData();
      $("#offline-badge").classList.add("hidden");
      render();
    } catch (e) {
      if (hadCache) {
        $("#offline-badge").classList.remove("hidden");
        toast("Offline — showing your last sync");
      } else {
        toast("Couldn't reach Google Sheets. Check connection & config.");
        console.error(e);
      }
    } finally { setBusy(false); }
  }

  function wire() {
    $("#signin-btn").addEventListener("click", async () => {
      const err = $("#signin-error");
      err.classList.add("hidden");
      if (!C.CLIENT_ID || C.CLIENT_ID.startsWith("PASTE")) {
        err.textContent = "Setup needed: add your Google OAuth Client ID in config.js (see README).";
        err.classList.remove("hidden");
        return;
      }
      try { await getToken(true); showApp(); }
      catch (e) { err.textContent = "Sign-in didn't complete. Try again."; err.classList.remove("hidden"); }
    });
    $("#signout-btn").addEventListener("click", signOut);
    $("#refresh-btn").addEventListener("click", showApp);
    $("#search-input").addEventListener("input", render);
    document.querySelectorAll(".segments [data-scope]").forEach((b) =>
      b.addEventListener("click", () => {
        state.scope = b.dataset.scope;
        document.querySelectorAll("[data-scope]").forEach((x) => x.classList.toggle("active", x === b));
        render();
      }));
    $("#add-btn").addEventListener("click", () => openSheet("record"));
    $("#sheet-backdrop").addEventListener("click", closeSheet);
    $("#cancel-add").addEventListener("click", closeSheet);
    document.querySelectorAll("[data-addmode]").forEach((b) =>
      b.addEventListener("click", () => {
        state.addMode = b.dataset.addmode;
        document.querySelectorAll("[data-addmode]").forEach((x) => x.classList.toggle("active", x === b));
        applyAddMode();
      }));
    $("#add-form").artist.addEventListener("input", checkDup);
    $("#add-form").title.addEventListener("input", checkDup);

    $("#add-form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const data = {
        artist: f.artist.value.trim(), title: f.title.value.trim(),
        genre: f.genre.value.trim(), year: f.year.value.trim(),
        format: f.format.value, condition: f.condition.value,
        location: f.location.value.trim(), price: f.price.value.trim(),
        currency: f.currency.value.trim(), date: f.date.value,
        notes: f.notes.value.trim(),
      };
      if (state.addMode === "record") {
        if (!data.artist || !data.title) return toast("Artist and title are required");
        if (!data.location || !data.price || !data.currency || !data.date)
          return toast("Purchase info is required (where, price, currency, date)");
        addRecord(data);
      } else {
        if (!data.artist && !data.title && !data.genre)
          return toast("Give the wish at least an artist, title, or genre");
        addWish(data);
      }
    });

    // delegated card actions
    $("#results").addEventListener("click", (ev) => {
      const btn = ev.target.closest("button");
      if (!btn) return;
      if (btn.dataset.listen !== undefined) markListened(render._colHits[+btn.dataset.listen]);
      else if (btn.dataset.got !== undefined) {
        const w = render._wishHits[+btn.dataset.got];
        state.pendingWishRow = w.row;
        openSheet("record", w);
        toast("Fill in the purchase — the wish clears itself when you save");
      }
      else if (btn.dataset.unwish !== undefined) removeWish(render._wishHits[+btn.dataset.unwish]);
      else if (btn.dataset.wishquick !== undefined) {
        const qv = $("#search-input").value.trim();
        openSheet("wish", { artist: qv });
      }
    });

    window.addEventListener("online", () => $("#offline-badge").classList.add("hidden"));
    window.addEventListener("offline", () => $("#offline-badge").classList.remove("hidden"));
  }

  function start() {
    wire();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    const tryInit = () => {
      if (window.google && google.accounts) {
        initAuth();
        if (state.token && state.tokenExp > Date.now()) showApp(); else showSignin();
      } else {
        setTimeout(tryInit, 150);
      }
    };
    tryInit();
  }

  document.addEventListener("DOMContentLoaded", start);
})();
