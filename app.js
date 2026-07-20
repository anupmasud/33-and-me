/* ============================================================
   33&Me — a personal record collection PWA
   Data lives in the owner's Google Sheet. No server, no DB.
   ============================================================ */
(() => {
  "use strict";

  const C = window.CONFIG;
  // Each user connects their own Google Sheet at runtime (stored per-browser),
  // which makes the app reusable. config.js SPREADSHEET_ID is just a default.
  const CONFIG_SHEET = (C.SPREADSHEET_ID && !C.SPREADSHEET_ID.startsWith("PASTE")) ? C.SPREADSHEET_ID : "";
  const parseSheetId = (input) => {
    const s = (input || "").trim();
    const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : ""; // allow a bare ID too
  };
  const sheetUrl = (id) => id ? "https://docs.google.com/spreadsheets/d/" + id : "";

  // Shown in the footer so you can tell which build you're running. Bump this
  // (and the SW cache in sw.js) on each deploy.
  const APP_VERSION = "40";

  // Columns the app guarantees exist on the collection tab.
  const APP_COLUMNS = ["City", "Country", "Format", "Condition", "Listen Count", "Last Listened", "Rating", "Notes"];
  const WISH_HEADER = ["Artist", "Title", "Genre", "Notes", "Added"];

  // Allowed dropdown values the app enforces in the sheet. Change these lists
  // (and bump VALIDATION_VERSION) to re-apply new choices on next launch.
  const CONDITION_VALUES = ["New", "Used"];
  const RATING_VALUES = ["1", "2", "3", "4", "5"];
  const FORMAT_VALUES = ["LP", "2xLP", "EP", "7\"", "10\"", "Box set"];
  // Suggested genres (the field still accepts anything you type).
  const GENRE_VALUES = [
    "Acoustic", "Afrobeat", "Ambient", "Americana / Bluegrass", "Blues",
    "Bollywood", "Bollywood Soundtrack", "Bossa Nova", "Classic Rock", "Colombian",
    "Country", "Cuban", "Disco", "Electronic", "Experimental", "Fado", "Flamenco",
    "Folk", "French Jazz", "Funk", "Ghazals", "Gospel", "Hip-Hop / Rap", "House",
    "Indian Classical", "Indian Classical Vocal", "Indie / Alternative", "Jazz",
    "Jazz Fusion", "Jazz Vocal", "Latin", "Metal", "Middle Eastern", "Morna",
    "New Wave / Post-Punk", "Opera", "Pizzica", "Pop", "Portuguese",
    "Progressive Rock", "Psychedelic", "Punk", "R&B", "Reggae", "Rock", "Soul",
    "Soundtrack", "Spanish", "Spoken Word", "Synth-Pop", "Techno", "Traditional",
    "West African", "Western Classical", "Western Soundtrack", "World",
  ];
  // Countries for the Country dropdown (field still accepts anything you type).
  const COUNTRY_VALUES = [
    "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina",
    "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain",
    "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bolivia",
    "Bosnia and Herzegovina", "Botswana", "Brazil", "Bulgaria", "Burkina Faso",
    "Cambodia", "Cameroon", "Canada", "Cape Verde", "Chile", "China", "Colombia",
    "Congo", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czechia", "Denmark",
    "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Estonia",
    "Ethiopia", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany",
    "Ghana", "Greece", "Guatemala", "Guinea", "Haiti", "Honduras", "Hungary",
    "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel",
    "Italy", "Ivory Coast", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya",
    "Kuwait", "Laos", "Latvia", "Lebanon", "Liberia", "Libya", "Lithuania",
    "Luxembourg", "Madagascar", "Malaysia", "Mali", "Malta", "Mauritius",
    "Mexico", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco",
    "Mozambique", "Myanmar", "Nepal", "Netherlands", "New Zealand", "Nicaragua",
    "Niger", "Nigeria", "North Macedonia", "Norway", "Oman", "Pakistan",
    "Panama", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar",
    "Romania", "Russia", "Rwanda", "Saudi Arabia", "Senegal", "Serbia",
    "Singapore", "Slovakia", "Slovenia", "Somalia", "South Africa",
    "South Korea", "Spain", "Sri Lanka", "Sudan", "Sweden", "Switzerland",
    "Syria", "Taiwan", "Tanzania", "Thailand", "Togo", "Trinidad and Tobago",
    "Tunisia", "Turkey", "Uganda", "Ukraine", "United Arab Emirates",
    "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Venezuela",
    "Vietnam", "Yemen", "Zambia", "Zimbabwe",
  ];
  const VALIDATION_VERSION = "v8";

  // ---------- admin settings (Phase 1) ----------
  // Editable per-field settings. Defaults here; overrides load from a hidden
  // "33Settings" tab in the sheet so they travel with the data. Field keys match
  // the form input names.
  const SETTINGS_SHEET = "33Settings";
  // Long dropdowns (Genre 575 chars, Country 1262) blow past Sheets' ~500-char
  // limit for inline "list of items" validation, so the values live in a hidden
  // lookup tab and the columns validate against those ranges instead. Rewritten
  // from the admin settings on every app load.
  const LISTS_SHEET = "33Lists";
  const LIST_ROWS = 300; // generous fixed range so lists can grow without re-validating
  const LIST_SPECS = [
    { col: "A", header: "Genre", get: () => listOf("genre") },
    { col: "B", header: "Country", get: () => COUNTRY_VALUES },
    { col: "C", header: "Format", get: () => listOf("format") },
    { col: "D", header: "Condition", get: () => listOf("condition") },
    { col: "E", header: "Rating", get: () => RATING_VALUES },
  ];
  // Sheet names starting with a digit must be quoted inside a formula.
  const listRange = (col) => `='${LISTS_SHEET}'!$${col}$2:$${col}$${LIST_ROWS + 1}`;
  const FIELD_DEFS = [
    { key: "artist", label: "Artist", req: true, mode: "both" },
    { key: "title", label: "Title", req: true, mode: "both" },
    { key: "label", label: "Label", req: false, mode: "record" },
    { key: "yearReleased", label: "Year Released", req: false, mode: "record" },
    { key: "genre", label: "Genre", req: false, mode: "both" },
    { key: "format", label: "Format", req: true, mode: "record" },
    { key: "condition", label: "Condition", req: false, mode: "record" },
    { key: "location", label: "Where bought", req: true, mode: "record" },
    { key: "city", label: "City", req: false, mode: "record" },
    { key: "country", label: "Country", req: false, mode: "record" },
    { key: "price", label: "Amount Paid", req: true, mode: "record" },
    { key: "currency", label: "Paid In", req: false, mode: "record" },
    { key: "year", label: "Year Bought", req: false, mode: "record" },
    { key: "date", label: "Date bought", req: false, mode: "record" },
    { key: "notes", label: "Notes", req: false, mode: "both" },
  ];
  const DATE_FORMATS = ["yyyy-mm-dd", "dd/mm/yyyy", "mm/dd/yyyy", "d mmm yyyy"];
  const DEFAULT_LISTS = { format: FORMAT_VALUES, condition: CONDITION_VALUES, genre: GENRE_VALUES };
  const defaultSettings = () => ({
    labels: Object.fromEntries(FIELD_DEFS.map((f) => [f.key, f.label])),
    required: Object.fromEntries(FIELD_DEFS.map((f) => [f.key, f.req])),
    lists: { format: FORMAT_VALUES.slice(), condition: CONDITION_VALUES.slice(), genre: GENRE_VALUES.slice() },
    dateFormat: "yyyy-mm-dd",
    preferredCurrency: "USD",
    collectionTab: "",   // "" = first non-app tab
    wishlistTab: "",     // "" = "Wishlist" (created if absent)
    map: {},             // collection: app field key -> user's column header
    wishMap: {},         // wishlist:   app field key -> user's column header
    hidden: {},          // field key -> true means exclude from form + detail
    defaults: {},        // field key -> value prefilled when adding
    wish: { artist: true, title: true, genre: true, notes: true }, // fields on the wishlist
    v: 3,
  });
  // Artist/Title are load-bearing (dedupe, sort, genre lookup) — never hideable.
  const CORE_FIELDS = ["artist", "title"];
  // Wishlist column names (backward compatible with the original 4-column tab).
  const WISH_COL = { artist: "Artist", title: "Title", genre: "Genre", notes: "Notes" };
  // These already have their own value lists / controls, so no generic LOV box.
  const LOV_SPECIAL = ["genre", "format", "condition", "country", "artist"];
  let SETTINGS = defaultSettings();
  const prefCurrency = () => (SETTINGS.preferredCurrency || "USD").toUpperCase();
  const labelOf = (key) => (SETTINGS.labels && SETTINGS.labels[key]) || key;
  const requiredOf = (key) => !!(SETTINGS.required && SETTINGS.required[key]);
  const hiddenOf = (key) => !CORE_FIELDS.includes(key) && !!(SETTINGS.hidden && SETTINGS.hidden[key]);
  const defaultOf = (key) => (SETTINGS.defaults && SETTINGS.defaults[key]) || "";
  const onWish = (key) => !!(SETTINGS.wish && SETTINGS.wish[key]);
  // Column resolution: a user's per-tab mapping wins; otherwise the app's own
  // header. Empty map ⇒ identity ⇒ existing sheets behave exactly as before.
  const mapped = (key) => (SETTINGS.map && SETTINGS.map[key]) || "";        // collection map
  const mappedW = (key) => (SETTINGS.wishMap && SETTINGS.wishMap[key]) || ""; // wishlist map
  const colName = (key) => mapped(key) || FIELD_COLS[key] || key;                    // collection tab
  const wishColName = (key) => mappedW(key) || WISH_COL[key] || FIELD_COLS[key] || key; // wishlist tab
  const isMapped = () => SETTINGS.map && Object.keys(SETTINGS.map).length > 0;
  const isWishMapped = () => SETTINGS.wishMap && Object.keys(SETTINGS.wishMap).length > 0;
  // Never hand back an empty list: an empty/missing saved list would silently
  // wipe the sheet's dropdown, so fall back to the built-in defaults.
  const listOf = (key) => {
    const v = SETTINGS.lists && SETTINGS.lists[key];
    return (Array.isArray(v) && v.length) ? v : (DEFAULT_LISTS[key] || []);
  };

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
    wishHeaders: [],        // wishlist header row
    wishCol: {},            // wishlist header name -> index
    canWrite: true,         // false when the user only has view access
    sheetId: "",            // active spreadsheet id (chosen at runtime)
    scope: "all",
    sortBy: "artist",       // display sort (the sheet itself stays Artist → Album)
    sortDir: "asc",         // "asc" | "desc"
    addMode: "record",
    pendingWishRow: null,   // wish row to delete after "Got it" save
    editRow: null,          // collection row being edited (null = adding)
    editWishRow: null,      // wishlist row being edited (null = adding)
    editItem: null,         // full record object being edited (for edit-page delete)
    detailItem: null,       // record shown in the detail view
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
    const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + state.sheetId + path, {
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
    // A 403 on a write means view-only access — flip the UI to read-only.
    if (res.status === 403 && opts.method && opts.method !== "GET" && state.canWrite) {
      state.canWrite = false;
      try { applyReadOnlyUI(); render(); toast("This sheet is view-only for you"); } catch (_) {}
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

  // The app's own bookkeeping tabs are never offered as a collection/wishlist.
  const isAppTab = (title) => sameName(title, SETTINGS_SHEET) || sameName(title, LISTS_SHEET);

  // Detect view-only access: read A1 of the collection tab, then write it back
  // unchanged. Editors get a harmless no-op; viewers get a 403 → read-only.
  async function probeWrite() {
    try {
      const t = state.collectionSheet.title;
      const cur = ((await api("/values/" + q(`${t}!A1`))).values || [[]])[0] || [];
      await api("/values/" + q(`${t}!A1`) + "?valueInputOption=USER_ENTERED",
        { method: "PUT", body: JSON.stringify({ values: [cur.length ? cur : [""]] }) });
      return true;
    } catch (e) {
      return !String((e && e.message) || "").includes(" 403"); // 403 ⇒ view-only
    }
  }

  async function ensureSetup() {
    let sheets = (await api("?fields=sheets.properties")).sheets.map((s) => s.properties);
    const usable = sheets.filter((s) => !isAppTab(s.title));
    // Tab choices come from Setup; fall back to config, then the first real tab.
    const wantCollection = SETTINGS.collectionTab || C.COLLECTION_SHEET;
    const wantWishlist = SETTINGS.wishlistTab || C.WISHLIST_SHEET || "Wishlist";
    state.collectionSheet =
      (wantCollection && sheets.find((s) => sameName(s.title, wantCollection))) || usable[0] || sheets[0];
    state.wishlistSheet = sheets.find((s) => sameName(s.title, wantWishlist)) || null;

    state.canWrite = await probeWrite();

    // create the wishlist tab if it's missing (only when we can write)
    if (!state.wishlistSheet && state.canWrite) {
      try {
        const r = await api(":batchUpdate", {
          method: "POST",
          body: JSON.stringify({ requests: [{ addSheet: { properties: { title: wantWishlist } } }] }),
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
        state.wishlistSheet = sheets.find((s) => sameName(s.title, wantWishlist)) || null;
        if (!state.wishlistSheet) throw e;
      }
    }

    // Ensure the wishlist has a column for every wish-enabled field, plus "Added".
    // Columns are appended (never reordered) so existing wishlist data is safe.
    if (state.wishlistSheet) {
      const wt = state.wishlistSheet.title;
      let wh = ((await api("/values/" + q(`${wt}!1:1`))).values || [[]])[0] || [];
      if (!wh.length) wh = WISH_HEADER.slice();
      const need = [];
      FIELD_DEFS.forEach((fd) => {
        if (onWish(fd.key) && !wh.includes(wishColName(fd.key))) need.push(wishColName(fd.key));
      });
      if (!wh.includes("Added")) need.push("Added");
      // Create a column for every enabled wishlist field that's missing (by its
      // mapped/standard name). Skipped only for view-only access.
      if (state.canWrite && need.length) {
        wh = wh.concat([...new Set(need)]);
        await api("/values/" + q(`${wt}!1:1`) + "?valueInputOption=USER_ENTERED", {
          method: "PUT", body: JSON.stringify({ values: [wh] }),
        });
      }
      state.wishHeaders = wh;
      state.wishCol = {};
      wh.forEach((h, i) => { state.wishCol[h] = i; });
    }

    // ensure app columns exist on the collection header row
    const t = state.collectionSheet.title;
    let headers = ((await api("/values/" + q(`${t}!1:1`))).values || [[]])[0] || [];

    // When the user has mapped their own columns, or only has view access,
    // don't impose the app's schema — just use their file as-is.
    if (!isMapped() && state.canWrite) {
    // Insert Label + Year Released right after the Title column if they're missing.
    const titleIdx = headers.indexOf("Album Name") >= 0 ? headers.indexOf("Album Name") : headers.indexOf("Title");
    const insertCols = ["Label", "Year Released"].filter((c) => !headers.includes(c));
    if (insertCols.length && titleIdx >= 0) {
      try {
        await api(":batchUpdate", {
          method: "POST",
          body: JSON.stringify({
            requests: [{
              insertDimension: {
                range: { sheetId: state.collectionSheet.sheetId, dimension: "COLUMNS", startIndex: titleIdx + 1, endIndex: titleIdx + 1 + insertCols.length },
                inheritFromBefore: false,
              },
            }],
          }),
        });
        const from = colLetter(titleIdx + 1), to = colLetter(titleIdx + insertCols.length);
        await api("/values/" + q(`${t}!${from}1:${to}1`) + "?valueInputOption=USER_ENTERED", {
          method: "PUT",
          body: JSON.stringify({ values: [insertCols] }),
        });
        headers = ((await api("/values/" + q(`${t}!1:1`))).values || [[]])[0] || []; // re-read after insert
      } catch (e) {
        console.error("33&Me: couldn't insert Label/Year Released columns:", e);
      }
    }

    // Rename legacy headers, then consolidate down to ONE cost column named for
    // the preferred currency, e.g. "Cost (USD)".
    try {
      const sid = state.collectionSheet.sheetId;
      const reread = async () => { headers = ((await api("/values/" + q(`${t}!1:1`))).values || [[]])[0] || []; };
      const renameAt = async (i, name) => {
        await api("/values/" + q(`${t}!${colLetter(i)}1`) + "?valueInputOption=USER_ENTERED", {
          method: "PUT", body: JSON.stringify({ values: [[name]] }),
        });
        headers[i] = name;
      };
      const renameHeader = async (from, to) => {
        if (headers.includes(to) || !headers.includes(from)) return;
        await renameAt(headers.indexOf(from), to);
      };
      await renameHeader("Original Cost", "Amount Paid");
      await renameHeader("Original Currency", "Paid In");

      const target = costColName();
      const ci = headers.indexOf("Cost");                   // legacy USD column
      const pi = headers.indexOf("Cost (Preferred)");
      const xi = headers.findIndex((h) => h !== "Cost (Preferred)" && /^Cost \(/.test(h));

      if (pi >= 0) {
        // Fold "Cost" into "Cost (Preferred)", rename it, then drop "Cost".
        if (ci >= 0) {
          const src = colLetter(ci), dst = colLetter(pi);
          const vals = ((await api("/values/" + q(`${t}!${src}2:${src}`))).values) || [];
          if (vals.length) {
            await api("/values/" + q(`${t}!${dst}2:${dst}${vals.length + 1}`) + "?valueInputOption=RAW", {
              method: "PUT", body: JSON.stringify({ values: vals }),
            });
          }
        }
        await renameAt(pi, target);
        if (ci >= 0) {
          await api(":batchUpdate", {
            method: "POST",
            body: JSON.stringify({
              requests: [{ deleteDimension: { range: { sheetId: sid, dimension: "COLUMNS", startIndex: ci, endIndex: ci + 1 } } }],
            }),
          });
        }
        await reread();
      } else if (xi >= 0 && headers[xi] !== target) {
        await renameAt(xi, target);       // preferred currency changed
      } else if (xi < 0 && ci >= 0) {
        await renameAt(ci, target);       // only a plain "Cost" column
      } else if (xi < 0 && ci < 0) {
        const pIdx = headers.indexOf("Paid In");
        if (pIdx >= 0) {
          await api(":batchUpdate", {
            method: "POST",
            body: JSON.stringify({
              requests: [{ insertDimension: { range: { sheetId: sid, dimension: "COLUMNS", startIndex: pIdx + 1, endIndex: pIdx + 2 }, inheritFromBefore: false } }],
            }),
          });
          await api("/values/" + q(`${t}!${colLetter(pIdx + 1)}1`) + "?valueInputOption=USER_ENTERED", {
            method: "PUT", body: JSON.stringify({ values: [[target]] }),
          });
          await reread();
        }
      }
    } catch (e) {
      console.error("33&Me: cost column setup failed:", e);
    }

    } // end !isMapped()

    // Ensure a column exists for every field the user chose to SHOW (by its
    // mapped/standard name), plus the app-managed columns. Missing ones are
    // appended. This runs even for mapped files, so showing a new field creates
    // its column. Hidden fields are never created.
    if (state.canWrite) {
      const wanted = FIELD_DEFS.filter((fd) => !hiddenOf(fd.key)).map((fd) => colName(fd.key));
      ["Listen Count", "Last Listened", "Rating"].forEach((c) => wanted.push(c));
      const missing = [...new Set(wanted)].filter((c) => c && !headers.includes(c));
      if (missing.length) {
        headers = headers.concat(missing);
        await api("/values/" + q(`${t}!1:1`) + "?valueInputOption=USER_ENTERED", {
          method: "PUT",
          body: JSON.stringify({ values: [headers] }),
        });
      }
    }
    state.headers = headers;
    state.col = {};
    headers.forEach((h, i) => { state.col[h] = i; });
  }

  // Runs once per device per version, in the background (does not block showing
  // your records). Surfaces the result to the console and a toast.
  async function maybeFixValidation() {
    const flag = "valfix33:" + state.sheetId + ":" + VALIDATION_VERSION;
    if (localStorage.getItem(flag)) {
      console.log("33&Me: dropdown validation already applied on this device");
      return;
    }
    try {
      const applied = await fixValidation();
      if (applied) {
        localStorage.setItem(flag, "1");
        console.log("33&Me: dropdown validation applied ✓");
        toast("Sheet dropdowns updated ✓");
      } else {
        console.warn("33&Me: dropdown validation SKIPPED — no target columns found. Header row:", state.headers);
      }
    } catch (e) {
      console.error("33&Me: dropdown validation FAILED:", e);
      toast("Dropdown fix failed: " + String(e.message || e).slice(0, 120), 6000);
    }
  }

  // ---------- sorting ----------
  // Keep both the sheet rows and the in-app lists in Artist → Album order.
  const byArtistTitle = (a, b) =>
    (a.artist || "").localeCompare(b.artist || "", undefined, { sensitivity: "base" }) ||
    (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" });

  // Display comparator for the sort picker. Blanks always sink to the bottom,
  // and Artist → Album is the tiebreaker so equal keys stay predictable.
  // `dir` flips the value comparison only — blanks always sort last and ties
  // fall back to Artist→Album ascending, regardless of direction.
  function makeCmp(key, dir) {
    const s = dir === "desc" ? -1 : 1;
    const blank = (v) => (v == null || String(v).trim() === "" ? 1 : 0);
    if (key === "listens") {
      return (a, b) => s * ((a.listens || 0) - (b.listens || 0)) || byArtistTitle(a, b);
    }
    if (key === "lastListened") {
      return (a, b) => blank(a.lastListened) - blank(b.lastListened) ||
        s * String(a.lastListened || "").localeCompare(String(b.lastListened || "")) || byArtistTitle(a, b);
    }
    const numeric = key === "yearReleased" || key === "year";
    return (a, b) =>
      blank(a[key]) - blank(b[key]) ||
      s * String(a[key] || "").localeCompare(String(b[key] || ""), undefined, { sensitivity: "base", numeric }) ||
      byArtistTitle(a, b);
  }

  async function sortSheet(sheetProps, specs, nCols) {
    if (!sheetProps || !specs.length) return;
    await api(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        requests: [{
          sortRange: {
            range: { sheetId: sheetProps.sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols },
            sortSpecs: specs,
          },
        }],
      }),
    });
  }

  // Sort the collection tab by Artist, then album title.
  async function sortCollection() {
    const aIdx = state.col["Artist"];
    if (aIdx === undefined) return;
    const tIdx = state.col["Album Name"] !== undefined ? state.col["Album Name"] : state.col["Title"];
    const specs = [{ dimensionIndex: aIdx, sortOrder: "ASCENDING" }];
    if (tIdx !== undefined) specs.push({ dimensionIndex: tIdx, sortOrder: "ASCENDING" });
    await sortSheet(state.collectionSheet, specs, state.headers.length);
  }

  async function sortWishlist() {
    const a = state.wishCol["Artist"], t = state.wishCol["Title"];
    const specs = [];
    if (a !== undefined) specs.push({ dimensionIndex: a, sortOrder: "ASCENDING" });
    if (t !== undefined) specs.push({ dimensionIndex: t, sortOrder: "ASCENDING" });
    await sortSheet(state.wishlistSheet, specs, (state.wishHeaders || []).length || 5);
  }

  // The duplicated sheet had stray "Yes/No" dropdowns across many columns and
  // wrong number formats. Nuke ALL validation on the data rows, then re-apply
  // only the dropdowns we want and set proper number/date formats.
  async function fixValidation() {
    const sid = state.collectionSheet.sheetId;
    const nCols = state.headers.length;
    if (!nCols) return false;
    const dataRows = { sheetId: sid, startRowIndex: 1 }; // row 2 → end
    const requests = [];

    // 1. Clear every data-validation rule across all data columns.
    requests.push({
      setDataValidation: { range: { ...dataRows, startColumnIndex: 0, endColumnIndex: nCols } },
      // no `rule` => clears validation in the range
    });

    // 2. Re-apply the dropdowns, pointing at the hidden lookup tab's ranges.
    // Range-based validation has no length limit, and the dropdown tracks the
    // range's contents — so editing a list in Settings just rewrites that tab.
    const rule = (colName, listCol) => {
      const idx = state.col[colName];
      if (idx === undefined) return;
      requests.push({
        setDataValidation: {
          range: { ...dataRows, startColumnIndex: idx, endColumnIndex: idx + 1 },
          rule: {
            condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: listRange(listCol) }] },
            showCustomUi: true,
            strict: false, // offer the list but don't reject existing odd values
          },
        },
      });
    };
    rule("Condition", "D");
    rule("Rating", "E");
    rule("Format", "C");
    rule("Genre", "A");
    rule("Country", "B");

    // Same Genre dropdown on the Wishlist tab, at whatever column Genre landed.
    const wGenre = state.wishCol && state.wishCol["Genre"];
    if (state.wishlistSheet && wGenre !== undefined) {
      requests.push({
        setDataValidation: {
          range: { sheetId: state.wishlistSheet.sheetId, startRowIndex: 1, startColumnIndex: wGenre, endColumnIndex: wGenre + 1 },
          rule: {
            condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: listRange("A") }] },
            showCustomUi: true,
            strict: false,
          },
        },
      });
    }

    // 3. Fix number/date formats on the columns the app writes.
    const fmt = (colName, numberFormat) => {
      const idx = state.col[colName];
      if (idx === undefined) return;
      requests.push({
        repeatCell: {
          range: { ...dataRows, startColumnIndex: idx, endColumnIndex: idx + 1 },
          cell: { userEnteredFormat: { numberFormat } },
          fields: "userEnteredFormat.numberFormat",
        },
      });
    };
    const datePattern = SETTINGS.dateFormat || "yyyy-mm-dd";
    fmt("Listen Count", { type: "NUMBER", pattern: "0" });
    fmt("Last Listened", { type: "DATE", pattern: datePattern });
    fmt("Date", { type: "DATE", pattern: datePattern });

    await api(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });
    return true;
  }

  function hv(row, name) { // header value
    const i = state.col[name];
    return i === undefined ? "" : (row[i] || "");
  }

  async function loadData() {
    const t = state.collectionSheet.title;
    const ranges = "ranges=" + q(t) + (state.wishlistSheet ? "&ranges=" + q(state.wishlistSheet.title) : "");
    const data = await api("/values:batchGet?" + ranges + "&majorDimension=ROWS");
    const [colRange, wishRange] = data.valueRanges;

    // Read collection columns by field key through the mapping (colName).
    const cv = (r, key) => { const idx = state.col[colName(key)]; return idx === undefined ? "" : (r[idx] || ""); };
    const rows = (colRange.values || []).slice(1);
    state.collection = rows.map((r, i) => {
      const item = { row: i + 2 };
      FIELD_DEFS.forEach((fd) => { item[fd.key] = cv(r, fd.key); });
      if (!item.title && !mapped("title")) item.title = hv(r, "Title"); // legacy fallback
      item.listens = parseInt(hv(r, "Listen Count"), 10) || 0; // app-managed columns
      item.lastListened = hv(r, "Last Listened");
      return item;
    }).filter((x) => x.artist || x.title);

    // Wishlist is header-driven now (columns come from wish-enabled fields).
    const wcol = state.wishCol || {};
    const whv = (r, key) => { const i = wcol[wishColName(key)]; return i === undefined ? "" : (r[i] || ""); };
    const wrows = ((wishRange && wishRange.values) || []).slice(1);
    state.wishlist = wrows.map((r, i) => {
      const item = { row: i + 2 };
      FIELD_DEFS.forEach((fd) => { if (onWish(fd.key)) item[fd.key] = whv(r, fd.key); });
      // render/search always reference these four:
      item.artist = item.artist || whv(r, "artist");
      item.title = item.title || whv(r, "title");
      item.genre = item.genre || whv(r, "genre");
      item.notes = item.notes || whv(r, "notes");
      return item;
    }).filter((x) => x.artist || x.title || x.genre);

    // Display order: Artist → Album. (Each item keeps its own sheet `row`, so
    // sorting the arrays is safe even if the sheet itself hasn't been sorted.)
    state.collection.sort(byArtistTitle);
    state.wishlist.sort(byArtistTitle);

    localStorage.setItem("cache33:" + state.sheetId, JSON.stringify({
      ts: Date.now(), collection: state.collection, wishlist: state.wishlist,
    }));
  }

  function loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem("cache33:" + state.sheetId) || "null");
      if (c) { state.collection = c.collection; state.wishlist = c.wishlist; return true; }
    } catch (_) {}
    return false;
  }

  // ---------- settings persistence ----------
  async function loadSettings() {
    SETTINGS = defaultSettings();
    try {
      const resp = await api("/values/" + q(SETTINGS_SHEET + "!A1"));
      const raw = resp.values && resp.values[0] && resp.values[0][0];
      if (raw) {
        const p = JSON.parse(raw);
        const pl = p.lists || {};
        const lists = { ...SETTINGS.lists }; // defaults for format/condition/genre
        for (const [k, v] of Object.entries(pl)) if (Array.isArray(v)) lists[k] = v; // any field
        SETTINGS = {
          labels: { ...SETTINGS.labels, ...(p.labels || {}) },
          required: { ...SETTINGS.required, ...(p.required || {}) },
          hidden: { ...(p.hidden || {}) },
          defaults: { ...(p.defaults || {}) },
          wish: { ...SETTINGS.wish, ...(p.wish || {}) },
          lists,
          dateFormat: p.dateFormat || SETTINGS.dateFormat,
          preferredCurrency: (p.preferredCurrency || SETTINGS.preferredCurrency).toUpperCase(),
          collectionTab: p.collectionTab || "",
          wishlistTab: p.wishlistTab || "",
          map: { ...(p.map || {}) },
          wishMap: { ...(p.wishMap || {}) },
          v: p.v || 1,
        };
        // Migration: settings saved before Currency/Date/Condition were made
        // optional — flip them off once, then mark migrated.
        if (SETTINGS.v < 2) {
          SETTINGS.required.currency = false;
          SETTINGS.required.date = false;
          SETTINGS.required.condition = false;
        }
        if (SETTINGS.v < 3) {
          SETTINGS.labels.price = "Amount Paid";
          SETTINGS.labels.currency = "Paid In";
        }
        SETTINGS.v = 3;
      }
    } catch (_) { /* tab/cell missing → defaults */ }
    console.log("33&Me: settings loaded — lists:",
      Object.fromEntries(["genre", "format", "condition"].map((k) => [k, listOf(k).length])));
    applySettings();
  }

  // Mirror every admin list into the hidden lookup tab so the sheet's dropdowns
  // (which validate against these ranges) reflect the current settings.
  async function syncLists() {
    const sheets = (await api("?fields=sheets.properties")).sheets.map((s) => s.properties);
    if (!sheets.some((s) => sameName(s.title, LISTS_SHEET))) {
      await api(":batchUpdate", {
        method: "POST",
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: LISTS_SHEET, hidden: true } } }] }),
      }).catch(() => {}); // may already exist
    }
    const cols = LIST_SPECS.map((s) => s.get() || []);
    console.log("33&Me: syncing 33Lists →",
      LIST_SPECS.map((s, i) => `${s.header}:${cols[i].length}`).join(", "));
    const rows = [LIST_SPECS.map((s) => s.header)];
    for (let i = 0; i < LIST_ROWS; i++) {
      rows.push(cols.map((c) => (c[i] == null ? "" : c[i]))); // pad so removed values are cleared
    }
    const last = LIST_SPECS[LIST_SPECS.length - 1].col;
    await api("/values/" + q(`'${LISTS_SHEET}'!A1:${last}${LIST_ROWS + 1}`) + "?valueInputOption=RAW", {
      method: "PUT",
      body: JSON.stringify({ values: rows }),
    });
  }

  async function saveSettings() {
    // Ensure the (hidden) settings tab exists, then write the JSON blob to A1.
    try {
      await api(":batchUpdate", {
        method: "POST",
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SETTINGS_SHEET, hidden: true } } }] }),
      });
    } catch (_) { /* already exists */ }
    await api("/values/" + q(SETTINGS_SHEET + "!A1") + "?valueInputOption=RAW", {
      method: "PUT",
      body: JSON.stringify({ values: [[JSON.stringify(SETTINGS)]] }),
    });
  }

  // Push current settings into the form labels / required markers / dropdowns.
  function setSelectOptions(sel, values, blankFirst) {
    if (!sel) return;
    const cur = sel.value;
    const opts = (blankFirst ? [""] : []).concat(values);
    sel.innerHTML = opts.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    if (opts.includes(cur)) sel.value = cur;
    else if (blankFirst) sel.value = "";
  }
  // Attach (or remove) a suggestion datalist on a text field from its LOV.
  function applyFieldLov(key) {
    const input = document.querySelector(`#add-form [name="${key}"]`);
    if (!input || input.tagName === "SELECT" || input.tagName === "TEXTAREA" || input.readOnly) return;
    if (LOV_SPECIAL.includes(key)) return; // genre/country/etc. keep their own lists
    const vals = listOf(key);
    const id = "lov-" + key;
    let dl = document.getElementById(id);
    if (vals.length) {
      if (!dl) { dl = document.createElement("datalist"); dl.id = id; input.after(dl); }
      dl.innerHTML = vals.map((v) => `<option value="${esc(v)}">`).join("");
      input.setAttribute("list", id);
    } else if (dl) {
      input.removeAttribute("list");
      dl.remove();
    }
  }

  function applySettings() {
    FIELD_DEFS.forEach((fd) => {
      const lbl = document.querySelector(`[data-fl="${fd.key}"]`);
      if (lbl) lbl.textContent = labelOf(fd.key);
      const req = document.querySelector(`[data-req="${fd.key}"]`);
      if (req) req.classList.toggle("hidden", !requiredOf(fd.key));
      applyFieldLov(fd.key);
    });
    const form = $("#add-form");
    if (form) {
      setSelectOptions(form.format, listOf("format"));
      setSelectOptions(form.condition, listOf("condition"), true); // blank-first: no default
    }
    const cl = $("#cost-label");
    if (cl) cl.textContent = costColName();
    updateFormFields(); // field-hidden is driven here (mode + hidden/wish settings)
    renderSortOptions(); // enabling/hiding fields changes what you can sort by
  }

  // First required field (record mode) left empty → its label, else null.
  function missingRequired(data) {
    for (const fd of FIELD_DEFS) {
      if (!requiredOf(fd.key) || hiddenOf(fd.key)) continue; // can't require a hidden field
      if (!String(data[fd.key] == null ? "" : data[fd.key]).trim()) return labelOf(fd.key);
    }
    return null;
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

  // ---------- currency conversion ----------
  // Rates are USD-based (units of a currency per 1 USD), cached for the day.
  let RATES = null;
  async function getRates() {
    const cached = RATES || (() => { try { return JSON.parse(localStorage.getItem("rates33") || "null"); } catch (_) { return null; } })();
    if (cached && cached.rates && (Date.now() - cached.ts < 12 * 3600 * 1000)) { RATES = cached; return RATES; }
    const resp = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await resp.json();
    if (!data || data.result !== "success" || !data.rates) throw new Error("rates unavailable");
    RATES = { rates: data.rates, ts: Date.now() };
    try { localStorage.setItem("rates33", JSON.stringify(RATES)); } catch (_) {}
    return RATES;
  }
  // Historical rate for a specific date (ECB data, ~30 major currencies, back to
  // 1999). Returns the multiplier from→to, or null if unavailable for that date.
  const histCache = new Map();
  async function historicalRate(from, to, dateISO) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO || "")) return null;
    const key = `${from}|${to}|${dateISO}`;
    if (histCache.has(key)) return histCache.get(key);
    let rate = null;
    try {
      const resp = await fetch(`https://api.frankfurter.dev/v1/${dateISO}?from=${from}&to=${to}`);
      const d = await resp.json();
      if (d && d.rates && typeof d.rates[to] === "number") rate = d.rates[to];
    } catch (_) { /* fall back to current */ }
    histCache.set(key, rate);
    return rate;
  }

  // Convert `amount` from one currency to another. Uses the rate as of `dateISO`
  // (the purchase date) when available, otherwise today's rate. Number or null.
  async function convert(amount, fromCur, toCur, dateISO) {
    const amt = parseFloat(String(amount == null ? "" : amount).replace(/[^0-9.\-]/g, ""));
    if (!isFinite(amt)) return null;
    const from = String(fromCur || "").trim().toUpperCase();
    const to = String(toCur || "USD").trim().toUpperCase();
    if (!from) return null;       // no source currency → can't convert
    if (from === to) return amt;
    if (dateISO) {
      const hr = await historicalRate(from, to, dateISO);
      if (hr != null) return amt * hr;
    }
    const r = await getRates();   // rates[X] = units of X per 1 USD
    const rFrom = from === "USD" ? 1 : r.rates[from];
    const rTo = to === "USD" ? 1 : r.rates[to];
    if (!rFrom || !rTo) return null;
    return (amt / rFrom) * rTo;
  }

  // The single cost column, named for the preferred currency, e.g. "Cost (INR)".
  const costColName = () => `Cost (${prefCurrency()})`;

  // Refresh the read-only cost field from Amount Paid / Paid In / Date bought.
  // Rate lookups race (a historical fetch can outlast a cached one), so only the
  // most recent call is allowed to write the field.
  let costSeq = 0;
  async function updateCost() {
    const f = $("#add-form");
    if (!f.cost) return;
    const seq = ++costSeq;
    const c = await convert(f.price.value, f.currency.value, prefCurrency(), f.date.value).catch(() => null);
    if (seq !== costSeq) return; // superseded by a newer edit
    f.cost.value = c == null ? "" : c.toFixed(2);
  }

  async function addRecord(f) {
    const width = state.headers.length;
    const row = new Array(width).fill("");
    const put = (name, val) => { if (state.col[name] !== undefined) row[state.col[name]] = val; };
    const maxSN = state.collection.reduce((m) => m + 1, 1);
    put("SN", String(maxSN));
    const putf = (key, val) => put(colName(key), val);
    FIELD_DEFS.forEach((fd) => putf(fd.key, f[fd.key]));
    if (!mapped("title")) put("Title", f.title);            // legacy column names
    if (!mapped("price")) put("Original Cost", f.price);
    if (!mapped("currency")) put("Original Currency", f.currency);
    const cost = await convert(f.price, f.currency, prefCurrency(), f.date).catch(() => null);
    if (cost != null) put(costColName(), cost.toFixed(2));
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
      await sortCollection().catch(() => {}); // appended at the bottom — re-sort
      await loadData();
      toast(`Added "${f.title}" to your crates ♪`);
      closeSheet(); render();
    } catch (e) {
      toast("Couldn't save — are you online?");
    } finally { setBusy(false); }
  }

  // Coerce whatever the Date cell holds into an <input type="date"> value.
  // Sheets returns real dates as serial numbers under UNFORMATTED_VALUE.
  function toISODate(v) {
    if (v === "" || v == null) return "";
    if (typeof v === "number") {
      const d = new Date(Math.round((v - 25569) * 86400000)); // 25569 = 1899-12-30 → 1970-01-01
      return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
    }
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }

  // Load the full row (unformatted, so numbers/dates come back raw) and open
  // the form pre-filled for editing.
  async function openEdit(item) {
    const t = state.collectionSheet.title;
    setBusy(true);
    try {
      const resp = await api(
        "/values/" + q(`${t}!${item.row}:${item.row}`) + "?valueRenderOption=UNFORMATTED_VALUE"
      );
      const vals = (resp.values && resp.values[0]) || [];
      const g = (name) => { const i = state.col[name]; return i === undefined ? "" : (vals[i] == null ? "" : vals[i]); };
      const gf = (key) => g(colName(key)); // read a field by its mapped column
      openSheet("record", {
        artist: gf("artist"),
        title: gf("title") || g("Title"),
        label: gf("label"),
        yearReleased: gf("yearReleased") === "" ? "" : String(gf("yearReleased")),
        genre: gf("genre"),
        location: gf("location"),
        city: gf("city"),
        country: gf("country"),
        year: gf("year") === "" ? "" : String(gf("year")),
        format: gf("format"),
        condition: gf("condition"),
        price: String(gf("price") || g("Original Cost") || ""),
        currency: gf("currency") || g("Original Currency"),
        cost: String(g(costColName()) || ""),
        date: toISODate(gf("date")),
        notes: gf("notes"),
      }, item.row);
      state.editItem = item; // set after openSheet (which clears it)
    } catch (e) {
      toast("Couldn't load that record to edit — are you online?");
    } finally { setBusy(false); }
  }

  // Friendlier labels for a few columns in the read-only detail view.
  // Map a sheet column header to its configurable display label for the detail view.
  const FIELD_COLS = {
    artist: "Artist", title: "Album Name", label: "Label", yearReleased: "Year Released",
    genre: "Genre", format: "Format",
    condition: "Condition", location: "Location", city: "City", country: "Country",
    price: "Amount Paid", currency: "Paid In", year: "Year", date: "Date", notes: "Notes",
  };
  function columnLabel(header) {
    if (header === "Cost" || header === "Cost (Preferred)") return costColName();
    for (const [key, col] of Object.entries(FIELD_COLS)) {
      if (col === header) return labelOf(key);
    }
    if (header === "Title") return labelOf("title");
    return header;
  }
  // Is this sheet column an excluded field?
  function hiddenColumn(header) {
    for (const [key, col] of Object.entries(FIELD_COLS)) {
      if (col === header && hiddenOf(key)) return true;
    }
    return false;
  }

  async function openDetail(item) {
    const t = state.collectionSheet.title;
    setBusy(true);
    try {
      const resp = await api("/values/" + q(`${t}!${item.row}:${item.row}`)); // formatted values
      const vals = (resp.values && resp.values[0]) || [];
      $("#detail-title").textContent = item.title || "(untitled)";
      $("#detail-artist").textContent = item.artist || "";
      const rows = [];
      state.headers.forEach((h, i) => {
        if (h === "Artist" || h === "Album Name" || h === "Title") return; // shown in the header
        if (hiddenColumn(h)) return; // field excluded in admin
        const v = (vals[i] == null ? "" : String(vals[i])).trim();
        if (!v) return;
        rows.push(`<dt>${esc(columnLabel(h))}</dt><dd>${esc(v)}</dd>`);
      });
      $("#detail-list").innerHTML = rows.join("") || `<dd class="detail-empty">No other details recorded.</dd>`;
      state.detailItem = item;
      $("#detail-modal").classList.remove("hidden");
      $("#sheet-backdrop").classList.remove("hidden");
    } catch (e) {
      toast("Couldn't load details — are you online?");
    } finally { setBusy(false); }
  }

  function closeDetail() {
    $("#detail-modal").classList.add("hidden");
    $("#sheet-backdrop").classList.add("hidden");
    state.detailItem = null;
  }

  // ---------- admin settings UI ----------
  function renderAdmin(s) {
    $("#admin-fields").innerHTML = FIELD_DEFS.map((fd) => {
      const isCore = CORE_FIELDS.includes(fd.key);
      const hasLov = !LOV_SPECIAL.includes(fd.key) && fd.key !== "notes";
      const shown = !(s.hidden && s.hidden[fd.key]);
      const def = esc((s.defaults && s.defaults[fd.key]) || "");
      const lov = esc(((s.lists && s.lists[fd.key]) || []).join(", "));
      return `
      <div class="admin-field-card">
        <div class="admin-field">
          <input class="admin-label" data-akey="${fd.key}" value="${esc(s.labels[fd.key] || fd.label)}" aria-label="Label for ${esc(fd.key)}" />
          <label class="admin-tog" title="Show this field">
            ${isCore ? '<span class="admin-fixed">always</span>' : `<input type="checkbox" data-ashow="${fd.key}" ${shown ? "checked" : ""} />`}
            <span>show</span>
          </label>
          <label class="admin-tog" title="Required">
            <input type="checkbox" data-areq="${fd.key}" ${s.required[fd.key] ? "checked" : ""} /><span>req</span>
          </label>
          <label class="admin-tog" title="Include on the wishlist">
            <input type="checkbox" data-awish="${fd.key}" ${s.wish && s.wish[fd.key] ? "checked" : ""} /><span>wish</span>
          </label>
        </div>
        <div class="admin-field2">
          <input class="admin-default" data-adef="${fd.key}" value="${def}" placeholder="default value" aria-label="Default for ${esc(fd.key)}" />
          ${hasLov
            ? `<input class="admin-values" data-alov="${fd.key}" value="${lov}" placeholder="dropdown values (comma-separated)" aria-label="Values for ${esc(fd.key)}" />`
            : `<span class="admin-note2">${LOV_SPECIAL.includes(fd.key) && fd.key !== "artist" ? "list edited below" : ""}</span>`}
        </div>
      </div>`;
    }).join("");
    $("#admin-dateformat").innerHTML = DATE_FORMATS
      .map((f) => `<option ${f === s.dateFormat ? "selected" : ""}>${f}</option>`).join("");
    $("#admin-prefcur").value = s.preferredCurrency || "USD";
    $("#admin-list-format").value = (s.lists.format || []).join("\n");
    $("#admin-list-condition").value = (s.lists.condition || []).join("\n");
    $("#admin-list-genre").value = (s.lists.genre || []).join("\n");
  }

  function openAdmin() {
    renderAdmin(SETTINGS);
    $("#admin-modal").classList.remove("hidden");
    $("#sheet-backdrop").classList.remove("hidden");
  }

  function closeAdmin() {
    $("#admin-modal").classList.add("hidden");
    $("#sheet-backdrop").classList.add("hidden");
  }

  async function saveAdmin() {
    const prevDateFormat = SETTINGS.dateFormat;
    const prevLists = JSON.stringify(SETTINGS.lists);
    const prevPref = prefCurrency();
    SETTINGS.hidden = SETTINGS.hidden || {};
    SETTINGS.defaults = SETTINGS.defaults || {};
    SETTINGS.wish = SETTINGS.wish || {};
    const prevWish = JSON.stringify(SETTINGS.wish);
    const prevHidden = JSON.stringify(SETTINGS.hidden);
    const prevMap = JSON.stringify(SETTINGS.map) + JSON.stringify(SETTINGS.wishMap);
    const newLists = {};
    FIELD_DEFS.forEach((fd) => {
      const lin = document.querySelector(`.admin-label[data-akey="${fd.key}"]`);
      const cb = document.querySelector(`[data-areq="${fd.key}"]`);
      const sh = document.querySelector(`[data-ashow="${fd.key}"]`);
      const ws = document.querySelector(`[data-awish="${fd.key}"]`);
      const df = document.querySelector(`.admin-default[data-adef="${fd.key}"]`);
      const vi = document.querySelector(`.admin-values[data-alov="${fd.key}"]`);
      if (lin) SETTINGS.labels[fd.key] = lin.value.trim() || fd.label;
      if (cb) SETTINGS.required[fd.key] = cb.checked;
      if (ws) SETTINGS.wish[fd.key] = ws.checked;
      SETTINGS.hidden[fd.key] = sh ? !sh.checked : false; // core fields (no checkbox) always shown
      const dv = df ? df.value.trim() : "";
      if (dv) SETTINGS.defaults[fd.key] = dv; else delete SETTINGS.defaults[fd.key];
      if (vi) {
        const arr = [...new Set(vi.value.split(",").map((x) => x.trim()).filter(Boolean))];
        if (arr.length) newLists[fd.key] = arr;
      }
    });
    const parseList = (sel, fallback) => {
      const arr = [...new Set($(sel).value.split("\n").map((x) => x.trim()).filter(Boolean))];
      return arr.length ? arr : fallback;
    };
    newLists.format = parseList("#admin-list-format", SETTINGS.lists.format);
    newLists.condition = parseList("#admin-list-condition", SETTINGS.lists.condition);
    newLists.genre = parseList("#admin-list-genre", SETTINGS.lists.genre);
    SETTINGS.lists = newLists;
    SETTINGS.dateFormat = $("#admin-dateformat").value || "yyyy-mm-dd";
    SETTINGS.preferredCurrency = ($("#admin-prefcur").value.trim() || "USD").toUpperCase();
    applySettings();
    setBusy(true);
    try {
      await saveSettings();
      // Dropdowns read from the lookup tab, so a list change just re-syncs it.
      if (JSON.stringify(SETTINGS.lists) !== prevLists) {
        await syncLists().catch(() => {});
      }
      if (SETTINGS.dateFormat !== prevDateFormat) {
        await fixValidation().catch(() => {});
      }
      closeAdmin();
      // Any of these can change which columns should exist → re-run setup.
      const structureChanged =
        JSON.stringify(SETTINGS.wish) !== prevWish ||
        JSON.stringify(SETTINGS.hidden) !== prevHidden ||
        (JSON.stringify(SETTINGS.map) + JSON.stringify(SETTINGS.wishMap)) !== prevMap;
      if (prefCurrency() !== prevPref) {
        // Rename the cost column to the new currency, then prompt to recompute.
        await showApp();
        toast(`Cost column is now ${costColName()} — use “Recompute costs” to update existing rows`, 6000);
      } else if (structureChanged) {
        await showApp(); // create any newly-needed columns and reload
        toast("Settings saved ✓ — columns updated");
      } else {
        toast("Settings saved ✓");
      }
    } catch (e) {
      toast("Couldn't save settings — are you online?");
    } finally { setBusy(false); }
  }

  async function updateRecord(row, f) {
    const t = state.collectionSheet.title;
    const data = [];
    const set = (name, val) => {
      const idx = state.col[name];
      if (idx === undefined) return;
      data.push({ range: `${t}!${colLetter(idx)}${row}`, values: [[val]] });
    };
    const setf = (key, val) => set(colName(key), val);
    FIELD_DEFS.forEach((fd) => setf(fd.key, f[fd.key]));
    if (!mapped("title")) set("Title", f.title);            // legacy column names
    if (!mapped("price")) set("Original Cost", f.price);
    if (!mapped("currency")) set("Original Currency", f.currency);
    const cost = await convert(f.price, f.currency, prefCurrency(), f.date).catch(() => null);
    if (cost != null) set(costColName(), cost.toFixed(2));
    // Listen Count / Last Listened / SN are intentionally left untouched.

    setBusy(true);
    try {
      await api("/values:batchUpdate", {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
      });
      await sortCollection().catch(() => {}); // artist/title may have changed
      await loadData();
      toast(`Updated "${f.title}" ✓`);
      closeSheet(); render();
    } catch (e) {
      toast("Couldn't save — are you online?");
    } finally { setBusy(false); }
  }

  async function deleteRecord(item) {
    if (!confirm(`Delete "${item.title || item.artist}"? This removes the row from your sheet.`)) return false;
    setBusy(true);
    try {
      await api(":batchUpdate", {
        method: "POST",
        body: JSON.stringify({
          requests: [{
            deleteDimension: {
              range: {
                sheetId: state.collectionSheet.sheetId, dimension: "ROWS",
                startIndex: item.row - 1, endIndex: item.row,
              },
            },
          }],
        }),
      });
      await loadData();
      toast("Record deleted");
      render();
      return true;
    } catch (e) {
      toast("Couldn't delete — are you online?");
      return false;
    } finally { setBusy(false); }
  }

  async function addWish(f) {
    const wt = state.wishlistSheet.title;
    const row = new Array((state.wishHeaders || []).length || 5).fill("");
    const wput = (colName, val) => { const i = state.wishCol[colName]; if (i !== undefined) row[i] = val; };
    FIELD_DEFS.forEach((fd) => { if (onWish(fd.key)) wput(wishColName(fd.key), f[fd.key] || ""); });
    wput("Added", todayISO());
    setBusy(true);
    try {
      await api("/values/" + q(wt) + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", {
        method: "POST",
        body: JSON.stringify({ values: [row] }),
      });
      await sortWishlist().catch(() => {}); // appended at the bottom — re-sort
      await loadData();
      toast("Added to wishlist ✦");
      closeSheet(); render();
    } catch (e) {
      toast("Couldn't save — are you online?");
    } finally { setBusy(false); }
  }

  // Update the wish-enabled field columns for this row; "Added" is left as-is.
  async function updateWish(row, f) {
    const t = state.wishlistSheet.title;
    const data = [];
    FIELD_DEFS.forEach((fd) => {
      if (!onWish(fd.key)) return;
      const i = state.wishCol[wishColName(fd.key)];
      if (i === undefined) return;
      data.push({ range: `${t}!${colLetter(i)}${row}`, values: [[f[fd.key] || ""]] });
    });
    if (!data.length) { closeSheet(); return; }
    setBusy(true);
    try {
      await api("/values:batchUpdate", {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
      });
      await sortWishlist().catch(() => {}); // artist/title may have changed
      await loadData();
      toast("Wish updated ✓");
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
    if (!confirm(`Remove "${item.title || item.artist || "this wish"}" from your wishlist?`)) return;
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

  // ---------- one-time genre importer ----------
  // Keyed by the collection's own artist/album text (typos preserved) so it
  // matches existing rows. matchKey() strips case/accents/punctuation so small
  // formatting differences still line up. Only BLANK Genre cells are filled.
  const matchKey = (s) => (s || "").toString().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

  const GENRE_FILL = [
    ["Angel Bat Dawid", "The Oracle", "Jazz"],
    ["Arooj Aftab", "Love in Exile", "Jazz"],
    ["Arooj Aftab", "Night Reign", "World"],
    ["Arooj Aftab", "Vulture Prince", "World"],
    ["Asim Saha", "Asim Saha and friends", "World"],
    ["Billie Holiday", "Lady in Satin", "Jazz Vocal"],
    ["Black Jesus Experience", "Good Evening Black Buddha", "Afrobeat"],
    ["Bob Dylan", "Blonde on Blonde", "Rock"],
    ["Bob Dylan", "Bringing it all Back Home", "Folk"],
    ["Bob Dylan", "Freewheelin's Bob Dylan", "Folk"],
    ["Bob Dylan", "Highway 61 Revisited", "Rock"],
    ["Bob Dylan", "Slow Train Coming", "Gospel"],
    ["Carlos Montoya", "Adventures in Flamenco", "Flamenco"],
    ["Carmen McRae", "Bittersweet", "Jazz Vocal"],
    ["Carmen McRae", "Havent we Met?", "Jazz Vocal"],
    ["Carmen McRae", "Ms. Jazz", "Jazz Vocal"],
    ["Carmen McRae", "Two for the Road", "Jazz Vocal"],
    ["Carmen McRae", "You're Lookin' at me", "Jazz Vocal"],
    ["Cesario Evora", "Mar Azul", "Morna"],
    ["Cheikh Lo", "Ne La Thiass", "West African"],
    ["Clark Terry", "Clark Terry", "Jazz"],
    ["Cliff Richard", "Love Songs", "Pop"],
    ["Crosby, Stills and Nash", "Crosby, Stills and Nash (Original)", "Folk"],
    ["Crosby, Stills, Nash & Young", "Deja Vu", "Folk"],
    ["Daave Brubeck", "Time Out", "Jazz"],
    ["Domani", "Wawamba", "World"],
    ["Donovan", "Fairy Tale", "Folk"],
    ["El Titi", "Toros y Coplas", "Flamenco"],
    ["Ella Fitzgerald", "At the Opera House", "Jazz Vocal"],
    ["Eric Clapton", "Backless", "Rock"],
    ["Erykah Badu", "Amerykah", "Soul"],
    ["Erykah Badu", "Baduizm", "Soul"],
    ["Erykah Badu", "But you caint use my phone", "Soul"],
    ["Erykah Badu", "Mama's Gun", "Soul"],
    ["Esparanza Spalding", "Radio Music Society", "Jazz"],
    ["Frank Sinatra", "My One and Only Love", "Jazz Vocal"],
    ["Fred Neil", "Everybody's Talking", "Folk"],
    ["Fred Neil", "Sessions", "Folk"],
    ["Freddie Hubbard", "The Body and the Soul", "Jazz"],
    ["Gil Scott-Heron", "Real Eyes", "Soul"],
    ["Gil Scott-Heron", "The Mind of Gil-Scott Heron", "Spoken Word"],
    ["Gil Scott-Heron & Brian Jackson", "Gil Scott-Heron & Brian Jackson", "Soul"],
    ["Gil Scott-Heron & Brian Jackson", "Winter in America", "Soul"],
    ["Gill Scott-Heron and Brian Jackson", "Midnight Band", "Soul"],
    ["Gordon Lightfoot", "Gord's Gold", "Folk"],
    ["Graciela Susana", "Guitarra, Dimelo Tu", "Latin"],
    ["Graciela Susana", "Love and Parting", "Latin"],
    ["Graham Nash", "Songs for Beginners", "Folk"],
    ["Hans Zimmer", "The Dark Knight", "Western Soundtrack"],
    ["Helen Humes", "Sneakin' Around", "Jazz Vocal"],
    ["Horace Silver", "Songs for my father", "Jazz"],
    ["Irene Reid", "Room for one more", "Jazz Vocal"],
    ["Jalousie", "Yehudi Menuhin Stephanie Grappeli", "Jazz"],
    ["Janis Joplin", "Janis Joplin's Greatest Hits", "Rock"],
    ["Jeff Beck", "Blow by Blow", "Jazz Fusion"],
    ["Jimi Hendrix", "Band of Gypsys", "Rock"],
    ["Jimi Hendrix", "Axis: Bold as Love", "Psychedelic"],
    ["Joachim-Ernst-Berendt", "Was ist jazz?", "Jazz"],
    ["Joan Baez", "Farewell, Angelina", "Folk"],
    ["Joan Baez", "From Every Stage", "Folk"],
    ["Joao Braga", "cantigas de mar e magoa", "Fado"],
    ["Joao Queiroz", "Canta Baladas e Fados de Coimbra", "Fado"],
    ["Johmy \"Hammond\" Smith", "Soul Talk", "Jazz"],
    ["John Coltrane", "My favorite things", "Jazz"],
    ["John Coltrane", "Giant Steps", "Jazz"],
    ["John Denver", "I want to live", "Folk"],
    ["John Lee Hooker", "The Real Folk Songs", "Blues"],
    ["John Lennon", "Gimme some truth", "Rock"],
    ["John Rowles", "If only I had time", "Pop"],
    ["Joni Mitchell", "Shadows and Light", "Folk"],
    ["Jose Afonso", "Cantigas do Maio", "Portuguese"],
    ["Juliette Greco", "Best Applause", "French Jazz"],
    ["L Subramaniam", "Spanish Wave", "Jazz Fusion"],
    ["L Subramaniam Stephane Grappelli", "Conversations", "Jazz Fusion"],
    ["Lena Horne", "The Lena Horne Collection", "Jazz Vocal"],
    ["Leonard Cohen", "Dear Heather", "Folk"],
    ["Leonard Cohen", "Death of a Ladies' Man", "Folk"],
    ["Leonard Cohen", "I'm your man", "Folk"],
    ["Leonard Cohen", "New Skin for the Old Ceremony", "Folk"],
    ["Leonard Cohen", "Recent Songs", "Folk"],
    ["Leonard Cohen", "Songs from a room", "Folk"],
    ["Leonard Cohen", "Songs of Leonard Cohen", "Folk"],
    ["Leonard Cohen", "Songs of Love and Hate", "Folk"],
    ["Leonard Cohen", "Thanks for the Dance", "Folk"],
    ["Leonard Cohen", "Various Positions", "Folk"],
    ["Leonard Cohen", "You Want It Darker", "Folk"],
    ["Lou Rawls", "Lou Rawls Live", "Soul"],
    ["Louis Armstrong and WC Handy", "Louis Armstrong and WC Handy", "Jazz"],
    ["Lovin' Spoonful", "The best of Lovin' Spoonful", "Rock"],
    ["Manitas de Plata", "et ses guitares gitanes", "Flamenco"],
    ["Manuel de Almeida", "Manuel de Almeida", "Fado"],
    ["Maple Glider", "To Enjoy Is the Only Thing", "Indie / Alternative"],
    ["Maria", "Car mi nho", "Fado"],
    ["Mariza", "Mariza Canta Amalia", "Fado"],
    ["Marvin Gaye", "Whats going on", "Soul"],
    ["MCoy Tyner", "Sahara", "Jazz"],
    ["Miles Davis", "Amandla", "Jazz Fusion"],
    ["Miles Davis", "Miles Smiles", "Jazz"],
    ["Morning Phase", "Beck", "Indie / Alternative"],
    ["Nana Vasconcelos", "Bush Dance", "World"],
    ["Narciso Yepes", "Spanish Guitar Music of 5 centuries Vol 2", "Western Classical"],
    ["Neil Young", "Comes a time", "Folk"],
    ["Nick Cave and the Bad Seeds", "The Boatman's Call", "Indie / Alternative"],
    ["Nick Cave and Warren Ellis", "Carnage", "Indie / Alternative"],
    ["Nina Simone", "Ballads and Blues", "Jazz Vocal"],
    ["Nina Simone", "Baltimore", "Soul"],
    ["Nina Simone", "Here comes the sun", "Jazz Vocal"],
    ["Nina Simone", "It is finished", "Soul"],
    ["Nina Simone", "Lady Midnight", "Jazz Vocal"],
    ["Nina Simone", "Let it be me", "Jazz Vocal"],
    ["Nina Simone", "Little Girl Blue", "Jazz Vocal"],
    ["Nina Simone", "Live in Europe", "Jazz Vocal"],
    ["Nina Simone", "Nina Simone at Carnegie Hall", "Jazz Vocal"],
    ["Nina Simone", "Nina Simone in Concert", "Jazz Vocal"],
    ["Nina Simone", "Nina Simone in Concert Emergency Ward", "Jazz Vocal"],
    ["Nina Simone", "Nina Simone sings Ellington", "Jazz Vocal"],
    ["Nina Simone", "Pastel Blues", "Blues"],
    ["Nina Simone", "Simone at Town Hall", "Jazz Vocal"],
    ["Nina Simone", "The Amazing Nina Simone", "Jazz Vocal"],
    ["Nina Simone", "Wild is the Winf", "Jazz Vocal"],
    ["Nina Simone", "Silk and Soul", "Soul"],
    ["Nusrat Fateh Ali Khan and Party Shabaaz", "Nusrat Fateh Ali Khan and Party Shabaaz", "World"],
    ["Olatunji", "Drums! Drums! Drums!", "West African"],
    ["Olatunji", "Flaming Drums", "West African"],
    ["Paco de Lucia", "Siroco", "Flamenco"],
    ["Pandit Jasraj", "Pandit Jasraj", "Indian Classical Vocal"],
    ["Paul Kelly and Charlie Owen", "Death's Dateless Night", "Folk"],
    ["Pedro Iturralde", "Jazz Flamenco 1", "Jazz Fusion"],
    ["Pink Floyd", "Atom Heart Mother", "Progressive Rock"],
    ["Pink Floyd", "Later Years *(1987-2019)", "Progressive Rock"],
    ["Placido Domingo", "Perhaps Love", "Pop"],
    ["Preservation Hall Jazz Band", "New Orleans: Sweet Emma and her Preservation Hall Jazz Band", "Jazz"],
    ["Preservation Hall Jazz Band", "Preservation Hall Jazz Band", "Jazz"],
    ["Quincy Jones", "Smackwater Jack", "Jazz"],
    ["Ravi Shankar", "Live Ravi Shankar at the Monterey Jazz Festival", "Indian Classical"],
    ["Richard Thompson", "A Collection of Unreleased and Rare Material", "Folk"],
    ["Richie Havens", "Something else again", "Folk"],
    ["Rodriguez", "Cold Fact", "Folk"],
    ["Rodriguez", "Coming from Reality", "Folk"],
    ["Rosemary Clooney", "Sings the Lyrics of Ira Gershwin", "Jazz Vocal"],
    ["Sarah Vaughn", "After hours", "Jazz Vocal"],
    ["Sarah Vaughn", "Feelin' Good", "Jazz Vocal"],
    ["Sarah Vaughn", "The George Gershwin Songbook", "Jazz Vocal"],
    ["Sarah Vaughn", "Afterhours", "Jazz Vocal"],
    ["Sarah Vaughn", "Crazy and Mixed Up", "Jazz Vocal"],
    ["Sarah Vaughn", "Sarah Vaughn", "Jazz Vocal"],
    ["Sarah Vaughn", "The Divine One", "Jazz Vocal"],
    ["Sarah Vaughn", "The Fabulous Sarah Vaughn with Count Basie and his orchestra", "Jazz Vocal"],
    ["Sarah Vaughn", "The Man I Love", "Jazz Vocal"],
    ["Sarah Vaughn and Duke Ellington", "Songbook Two", "Jazz Vocal"],
    ["Shirley Bassey", "Somebody loves me", "Pop"],
    ["Shirley Bassey", "You take my heart away", "Pop"],
    ["Shirley Horn", "Embers and Ashes", "Jazz Vocal"],
    ["Shirley Horn", "I thought about you", "Jazz Vocal"],
    ["Shirley Horn", "Softly Transparent", "Jazz Vocal"],
    ["Shirley Horn Trio", "A Lazy Afternoon", "Jazz Vocal"],
    ["Simon and Garfunkel", "Simon and Garfunkel's Greatest Hits", "Folk"],
    ["Sly and the Family Stone", "There's a Riot Goin' on", "Funk"],
    ["Son Palenque", "Ane Jue Ellos Son", "Colombian"],
    ["Stan Getz and Charlie Byrd", "Jazz Samba", "Bossa Nova"],
    ["Stan Getz and Joao Gilberto", "Getz/Gilberto", "Bossa Nova"],
    ["The Doors", "Morrison Hotel", "Rock"],
    ["The Doors", "The Doors", "Rock"],
    ["The Rolling Stones", "Flowers", "Rock"],
    ["The Rolling Stones", "Some girls", "Rock"],
    ["The Techniques", "Queen Majesty", "Reggae"],
    ["Thelonious Monk", "Misterioso", "Jazz"],
    ["Thelonious Monk", "Monk's Dream", "Jazz"],
    ["Tim Hardin", "Tim Hardin 3 Live in Concert", "Folk"],
    ["Tom Waits", "Los Angeles July 23rd 1974, Unplugged Live", "Jazz"],
    ["Tom Waitts", "Blue Valentine", "Jazz"],
    ["Tom Waitts", "Foreign Affairs", "Jazz"],
    ["Tom Waitts", "Nighthawks at the diner", "Jazz"],
    ["Tom Waitts and Crystal Gale", "One from the Heart Soundtrack", "Western Soundtrack"],
    ["Toumani Diabate", "Kaira", "West African"],
    ["Van Morrison", "His Band and the Street Choir", "Rock"],
    ["Van Morrison", "Moondance", "Rock"],
    ["Van Morrison", "Tupelo Honey", "Rock"],
    ["Various", "Anthology of Spanish Folklore Music", "Spanish"],
    ["Various", "Binaca Geet Mala A Silver Jubliee Presentation, Vol 1", "Bollywood"],
    ["Various", "Binaca Geet Mala A Silver Jubliee Presentation, Vol 1I", "Bollywood"],
    ["Various", "El Angel Musical Flamenco", "Flamenco"],
    ["Various", "Folk Music of Ghana", "West African"],
    ["Various", "Global Vilage", "World"],
    ["Various", "Hare Rama Hare Krishna", "Bollywood Soundtrack"],
    ["Various", "Memories of Portugal", "Portuguese"],
    ["Various", "Musik der Nubier NordSudan", "World"],
    ["Various", "The Color Purple Soundtrack", "Western Soundtrack"],
    ["Various", "The Concert for Bangladesh", "Rock"],
    ["Various", "The Endless Colored Ways - The songs of Nick Drake", "Indie / Alternative"],
    ["Various", "The History of Jazz Volumne 1 N'Orleans Origins", "Jazz"],
    ["Various", "The History of Jazz Volumne 2 The Turbulent 'Twenties", "Jazz"],
    ["Various", "The History of Jazz Volumne 3 Everybody Swings", "Jazz"],
    ["Various", "The History of Jazz Volumne 4 Enter the Cool", "Jazz"],
    ["Various", "The Living Tradition Religions of India", "Traditional"],
    ["Various", "The origins of Congo and Zambia guitar music 1957-1958", "World"],
    ["Various", "The Violin Summit", "Jazz"],
    ["Various", "The Voices and Drums of Africa", "World"],
    ["Various", "Woodstock", "Rock"],
    ["Various", "Woodstock two", "Rock"],
    ["Wes Montgomery", "A Day in the Life", "Jazz"],
    ["Wes Montgomery", "The incredible jazz guitar of Wes Montgomery", "Jazz"],
    ["Xylouris White", "The Sisypheans", "World"],
    ["Zakir, Chaurasia, McLaughlin, Jan Garbarek", "Making Music", "Jazz Fusion"],
  ];

  async function fillGenres() {
    const gCol = state.col["Genre"];
    if (gCol === undefined) return toast("No Genre column in this sheet");
    const map = new Map();
    GENRE_FILL.forEach(([a, b, g]) => map.set(matchKey(a) + "|" + matchKey(b), g));

    const t = state.collectionSheet.title;
    const updates = [];
    let unmatched = 0;
    for (const item of state.collection) {
      if ((item.genre || "").trim()) continue; // only fill blanks
      const g = map.get(matchKey(item.artist) + "|" + matchKey(item.title));
      if (g) updates.push({ range: `${t}!${colLetter(gCol)}${item.row}`, values: [[g]] });
      else unmatched++;
    }
    if (!updates.length) return toast("No blank genres matched the built-in list");
    if (!confirm(`Fill in ${updates.length} blank genre${updates.length > 1 ? "s" : ""} from the built-in list?`)) return;

    setBusy(true);
    try {
      await api("/values:batchUpdate", {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: updates }),
      });
      await loadData();
      toast(`Filled ${updates.length} genres ✓` + (unmatched ? ` (${unmatched} still blank)` : ""));
      render();
    } catch (e) {
      toast("Couldn't fill genres — are you online?");
    } finally { setBusy(false); }
  }

  // Recompute every row's cost from Amount Paid + Paid In into the preferred
  // currency, using each record's purchase-date rate where available.
  async function recomputeCosts() {
    const t = state.collectionSheet.title;
    const target = costColName();
    const ci = state.col[target], pIdx = state.col["Amount Paid"], cIdx = state.col["Paid In"];
    const dIdx = state.col["Date"];
    if (ci === undefined || pIdx === undefined || cIdx === undefined) {
      return toast(`Need Amount Paid / Paid In / ${target} columns`);
    }
    if (!confirm(`Recompute every cost into "${target}" from Amount Paid + Paid In, using each purchase-date's rate? This can take a minute.`)) return;
    setBusy(true);
    try {
      const rows = ((await api("/values/" + q(t) + "?valueRenderOption=UNFORMATTED_VALUE")).values || []).slice(1);
      const data = [];
      let skipped = 0;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || [];
        const amt = r[pIdx], cur = r[cIdx];
        if (amt == null || amt === "" || !cur) { skipped++; continue; }
        const v = await convert(amt, cur, prefCurrency(), dIdx === undefined ? "" : toISODate(r[dIdx])).catch(() => null);
        if (v == null) { skipped++; continue; }
        data.push({ range: `${t}!${colLetter(ci)}${i + 2}`, values: [[v.toFixed(2)]] });
      }
      if (!data.length) return toast("Nothing to recompute");
      await api("/values:batchUpdate", {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
      });
      await loadData(); render();
      toast(`Recomputed ${data.length} costs ✓` + (skipped ? ` (${skipped} skipped)` : ""));
    } catch (e) {
      console.error("33&Me: recompute costs failed:", e);
      toast("Couldn't recompute costs — are you online?");
    } finally { setBusy(false); }
  }

  // ---------- sort options (scope-aware) ----------
  // Sortable keys in display order. "listens"/"lastListened" are app-managed and
  // collection-only; the rest are configurable fields.
  const SORT_FIELDS = ["artist", "title", "genre", "label", "yearReleased", "format",
    "condition", "year", "location", "city", "country", "listens", "lastListened"];
  const sortLabel = (k) => k === "listens" ? "Listen count" : k === "lastListened" ? "Last listened" : labelOf(k);
  const inCollectionSort = (k) => (k === "listens" || k === "lastListened") ? true : !hiddenOf(k);
  const inWishlistSort = (k) => (k === "listens" || k === "lastListened") ? false : onWish(k);
  function sortableFields(scope) {
    return SORT_FIELDS.filter((k) => {
      if (scope === "collection") return inCollectionSort(k);
      if (scope === "wishlist") return inWishlistSort(k);
      return inCollectionSort(k) && inWishlistSort(k); // "all" → only fields common to both
    });
  }
  // Counts/dates read best newest-first; text A→Z.
  const defaultDir = (k) => (k === "listens" || k === "lastListened") ? "desc" : "asc";
  function updateSortDirIcon() {
    const b = $("#sort-dir");
    if (b) { b.textContent = state.sortDir === "desc" ? "↓" : "↑"; b.title = state.sortDir === "desc" ? "Descending" : "Ascending"; }
  }
  function setSortField(key, keepDir) {
    state.sortBy = key;
    if (!keepDir) state.sortDir = defaultDir(key);
    try { localStorage.setItem("sort33", state.sortBy); localStorage.setItem("sortdir33", state.sortDir); } catch (_) {}
    updateSortDirIcon();
  }
  function renderSortOptions() {
    const sel = $("#sort-by");
    if (!sel) return;
    const keys = sortableFields(state.scope);
    sel.innerHTML = keys.map((k) => `<option value="${k}">${esc(sortLabel(k))}</option>`).join("");
    if (!keys.includes(state.sortBy)) setSortField(keys[0] || "artist");
    sel.value = state.sortBy;
    updateSortDirIcon();
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

    // Copy before sorting — state.collection/wishlist stay in sheet order.
    const cmp = makeCmp(state.sortBy, state.sortDir);
    const colHits = (terms.length ? state.collection.filter((i) => matches(i, terms)) : state.collection).slice().sort(cmp);
    const wishHits = (terms.length ? state.wishlist.filter((i) => matches(i, terms)) : state.wishlist).slice().sort(cmp);

    if (scope !== "wishlist") {
      out.push(`<div class="group-label">Collection · ${colHits.length}</div>`);
      if (!colHits.length && terms.length) {
        out.push(`<div class="card"><div class="card-main">
          <div class="card-title">Not in your crates</div>
          <div class="card-meta">No copy of this in your collection.</div></div>
          ${state.canWrite ? `<button class="chip-btn" data-wishquick="1">+ Wishlist</button>` : ""}</div>`);
      }
      colHits.slice(0, 80).forEach((i, idx) => {
        out.push(`<div class="card rec">
          <div class="card-main">
            <div class="card-title"><button class="title-link" data-view="${idx}">${esc(i.title)}</button></div>
            <div class="card-artist">${esc(i.artist)}</div>
            <div class="card-meta">${esc([i.genre, i.format, i.year, i.location, i.city, i.country].filter(Boolean).join(" · "))}</div>
            ${i.notes ? `<div class="card-notes">${esc(i.notes)}</div>` : ""}
          </div>
          <div class="rec-actions">
            ${state.canWrite ? `<button class="listen-btn" data-listen="${idx}">♪ Listened</button>` : ""}
            <div class="listen-meta">${i.listens ? `${i.listens}× · ${esc(i.lastListened || "")}` : "never played"}</div>
            ${state.canWrite ? `<button class="chip-btn" data-edit="${idx}">Edit</button>` : ""}
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
          ${state.canWrite ? `<div class="wish-actions">
            <button class="chip-btn got" data-got="${idx}">Got it!</button>
            <button class="chip-btn" data-editwish="${idx}">Edit</button>
            <button class="chip-btn" data-unwish="${idx}">Remove</button>
          </div>` : ""}
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
  function openSheet(mode, prefill, editRow, editWishRow) {
    state.editRow = editRow || null;
    state.editWishRow = editWishRow || null;
    state.editItem = null; // openEdit re-sets this after calling openSheet
    state.addMode = mode || "record";
    $("#add-sheet").classList.remove("hidden");
    $("#sheet-backdrop").classList.remove("hidden");
    // When editing, hide the record/wish toggle (the kind is already fixed).
    $(".sheet-segments").classList.toggle("hidden", !!(state.editRow || state.editWishRow));
    document.querySelectorAll("[data-addmode]").forEach((b) =>
      b.classList.toggle("active", b.dataset.addmode === state.addMode));
    applyAddMode();
    const form = $("#add-form");
    form.reset();
    // Admin-configured per-field defaults (only when adding; prefill overrides).
    FIELD_DEFS.forEach((fd) => {
      const d = defaultOf(fd.key);
      const el = form[fd.key];
      if (!d || !el) return;
      if (el.tagName === "SELECT") { if ([...el.options].some((o) => o.value === d)) el.value = d; }
      else el.value = d;
    });
    if (prefill) {
      form.artist.value = prefill.artist || "";
      form.title.value = prefill.title || "";
      if (prefill.label !== undefined) form.label.value = prefill.label || "";
      if (prefill.yearReleased !== undefined) form.yearReleased.value = prefill.yearReleased || "";
      form.genre.value = prefill.genre || "";
      // extended fields (used when editing an existing record)
      if (prefill.year !== undefined) form.year.value = prefill.year || "";
      if (prefill.format) form.format.value = prefill.format;
      if (prefill.condition) form.condition.value = prefill.condition;
      if (prefill.location !== undefined) form.location.value = prefill.location || "";
      if (prefill.city !== undefined) form.city.value = prefill.city || "";
      if (prefill.country !== undefined) form.country.value = prefill.country || "";
      if (prefill.price !== undefined) form.price.value = prefill.price || "";
      if (prefill.currency) form.currency.value = prefill.currency;
      if (form.cost) form.cost.value = prefill.cost || "";
      if (prefill.date) form.date.value = prefill.date;
      if (prefill.notes !== undefined) form.notes.value = prefill.notes || "";
    }
    if (state.editRow) $("#save-add").textContent = "Update record";
    if (state.editWishRow) $("#save-add").textContent = "Update wish";
    // Delete only makes sense when editing an existing record.
    $("#delete-record").classList.toggle("hidden", !state.editRow);
    // genre suggestions: the configured list plus any genres already in the sheet
    const genres = [...new Set([...listOf("genre"), ...state.collection.map((i) => i.genre)].filter(Boolean))].sort();
    $("#genre-list").innerHTML = genres.map((g) => `<option value="${esc(g)}">`).join("");
    // artist suggestions from what you already own (drives the genre auto-fill)
    const artists = [...new Set(state.collection.map((i) => i.artist).filter(Boolean))].sort();
    $("#artist-list").innerHTML = artists.map((a) => `<option value="${esc(a)}">`).join("");
    // country suggestions: the country list plus any already in the sheet
    const countries = [...new Set([...COUNTRY_VALUES, ...state.collection.map((i) => i.country)].filter(Boolean))].sort();
    $("#country-list").innerHTML = countries.map((c) => `<option value="${esc(c)}">`).join("");
    checkDup();
    setTimeout(() => form.artist.focus(), 60);
  }

  // Show each field per the current mode: record mode → not-excluded fields;
  // wish mode → the fields enabled for the wishlist. Cost is record-only.
  function updateFormFields() {
    const wish = state.addMode === "wish";
    const form = $("#add-form");
    if (!form) return;
    FIELD_DEFS.forEach((fd) => {
      const lbl = document.querySelector(`[data-fl="${fd.key}"]`);
      const wrap = lbl && lbl.closest("label");
      if (!wrap) return;
      const show = wish ? onWish(fd.key) : !hiddenOf(fd.key);
      wrap.classList.toggle("field-hidden", !show);
    });
    const cost = form.cost && form.cost.closest("label");
    if (cost) cost.classList.toggle("field-hidden", wish);
  }

  function applyAddMode() {
    $("#save-add").textContent = state.addMode === "record" ? "Save record" : "Save wish";
    updateFormFields();
  }

  // Toggle all write-oriented chrome for view-only users.
  function applyReadOnlyUI() {
    const ro = !state.canWrite;
    const set = (sel, hide) => { const el = $(sel); if (el) el.classList.toggle("hidden", hide); };
    set("#add-btn", ro);            // the + FAB
    set("#viewonly-badge", !ro);    // "View only" indicator
    set("#admin-btn", ro);          // Settings (writes 33Settings)
    set("#fill-genres-btn", ro);    // Fill album info (writes)
    set("#batch-btn", ro);          // Batch edit (writes)
    set("#detail-edit", ro);
    set("#detail-delete", ro);
  }

  function closeSheet() {
    $("#add-sheet").classList.add("hidden");
    $("#sheet-backdrop").classList.add("hidden");
    state.pendingWishRow = null;
    state.editRow = null;
    state.editWishRow = null;
    state.editItem = null;
  }

  // ---------- genre lookup ----------
  // External services use their own vocabulary, so map it onto the configured
  // list. Anything we can't place confidently is left blank rather than
  // polluting the taxonomy with things like "Worldwide".
  const GENRE_SYNONYMS = {
    "vocal jazz": "Jazz Vocal", "jazz vocal": "Jazz Vocal", "vocal": "Jazz Vocal",
    "jazz fusion": "Jazz Fusion", "fusion": "Jazz Fusion", "jazz funk": "Jazz Fusion",
    "hard bop": "Jazz", "bebop": "Jazz", "bop": "Jazz", "cool jazz": "Jazz",
    "modal jazz": "Jazz", "free jazz": "Jazz", "spiritual jazz": "Jazz", "big band": "Jazz",
    "swing": "Jazz", "dixieland": "Jazz", "soul jazz": "Jazz", "smooth jazz": "Jazz",
    "hindustani classical": "Indian Classical", "carnatic": "Indian Classical",
    "carnatic classical": "Indian Classical", "raga": "Indian Classical",
    "indian classical music": "Indian Classical",
    "thumri": "Indian Classical Vocal", "khayal": "Indian Classical Vocal",
    "hindustani vocal": "Indian Classical Vocal", "ghazal": "Ghazals",
    "qawwali": "World", "sufi": "World", "worldwide": "World", "world music": "World",
    "afro-beat": "Afrobeat", "afro beat": "Afrobeat", "afropop": "West African",
    "desert blues": "West African", "mande": "West African", "griot": "West African",
    "highlife": "West African", "juju": "West African",
    "r&b/soul": "Soul", "rnb": "R&B", "rhythm and blues": "R&B", "neo soul": "Soul",
    "neo-soul": "Soul", "motown": "Soul", "northern soul": "Soul",
    "folk rock": "Folk", "singer-songwriter": "Folk", "contemporary folk": "Folk",
    "traditional folk": "Folk", "americana": "Americana / Bluegrass", "bluegrass": "Americana / Bluegrass",
    "classic rock": "Classic Rock", "blues rock": "Rock", "hard rock": "Rock",
    "psychedelic rock": "Psychedelic", "prog rock": "Progressive Rock",
    "progressive rock": "Progressive Rock", "art rock": "Progressive Rock",
    "alternative": "Indie / Alternative", "alternative rock": "Indie / Alternative",
    "indie": "Indie / Alternative", "indie rock": "Indie / Alternative",
    "new wave": "New Wave / Post-Punk", "post-punk": "New Wave / Post-Punk",
    "hip hop": "Hip-Hop / Rap", "hip-hop": "Hip-Hop / Rap", "rap": "Hip-Hop / Rap",
    "electronic": "Electronic", "electronica": "Electronic", "downtempo": "Electronic",
    "soundtrack": "Soundtrack", "film score": "Soundtrack", "score": "Soundtrack",
    "original score": "Soundtrack", "musicals": "Soundtrack",
    "classical": "Western Classical", "baroque": "Western Classical",
    "romantic": "Western Classical", "chamber music": "Western Classical",
    "opera": "Opera", "bossa nova": "Bossa Nova", "samba": "Latin", "mpb": "Latin",
    "salsa": "Cuban", "son cubano": "Cuban", "cuban": "Cuban", "latin": "Latin",
    "spanish": "Spanish", "portuguese": "Portuguese", "fado": "Fado", "morna": "Morna",
    "flamenco": "Flamenco", "reggae": "Reggae", "rocksteady": "Reggae", "ska": "Reggae",
    "dub": "Reggae", "country": "Country", "gospel": "Gospel", "blues": "Blues",
    "delta blues": "Blues", "chicago blues": "Blues", "spoken word": "Spoken Word",
    "poetry": "Spoken Word", "acoustic": "Acoustic", "ambient": "Ambient",
    "experimental": "Experimental", "avant-garde": "Experimental",
    "bollywood": "Bollywood", "filmi": "Bollywood Soundtrack",
    "middle eastern": "Middle Eastern", "arabic": "Middle Eastern",
    "traditional": "Traditional", "folk": "Folk", "pop": "Pop", "rock": "Rock",
    "soul": "Soul", "funk": "Funk", "disco": "Disco", "house": "House",
    "techno": "Techno", "punk": "Punk", "metal": "Metal", "jazz": "Jazz",
  };

  // Map one external genre string onto the configured list; "" if unsure.
  function mapGenre(raw) {
    const n = norm(raw);
    if (!n) return "";
    const list = listOf("genre");
    const exact = list.find((g) => norm(g) === n); // already one of ours?
    if (exact) return exact;
    const syn = GENRE_SYNONYMS[n];
    return syn && list.includes(syn) ? syn : "";
  }

  // MusicBrainz asks for ~1 request/second — space calls out so bulk runs don't
  // get throttled (they answer 503 and we'd lose the good genres).
  let mbLast = 0;
  async function mbFetch(url) {
    const wait = Math.max(0, 1100 - (Date.now() - mbLast));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    mbLast = Date.now();
    return fetch(url).then((r) => r.json());
  }

  // MusicBrainz first (its tags match this taxonomy far better), iTunes as a
  // fallback (it finds more, but flattens world music into "Worldwide").
  // Fetch what we can about an album: genre (mapped), original release year, and
  // record label. `need` limits the calls to what's actually blank. MusicBrainz
  // has all three; iTunes fills genre/year when MB comes up short (no label).
  async function lookupAlbum(artist, album, need) {
    need = need || { genre: true, yearReleased: true, label: true };
    const out = { genre: "", yearReleased: "", label: "" };
    try {
      const q = encodeURIComponent(`artist:"${artist}" AND releasegroup:"${album}"`);
      const s = await mbFetch(`https://musicbrainz.org/ws/2/release-group?query=${q}&fmt=json&limit=1`);
      const rg = (s["release-groups"] || [])[0];
      if (rg) {
        if (need.yearReleased && rg["first-release-date"]) out.yearReleased = String(rg["first-release-date"]).slice(0, 4);
        const inc = "genres+artist-credits" + (need.label ? "+releases" : "");
        const g = await mbFetch(`https://musicbrainz.org/ws/2/release-group/${rg.id}?fmt=json&inc=${inc}`);
        if (need.genre) {
          const byCount = (arr) => (arr || []).slice().sort((a, b) => (b.count || 0) - (a.count || 0)).map((x) => x.name);
          let names = byCount(g.genres);
          if (!names.length) {
            const aid = g["artist-credit"] && g["artist-credit"][0] && g["artist-credit"][0].artist.id;
            if (aid) names = byCount((await mbFetch(`https://musicbrainz.org/ws/2/artist/${aid}?fmt=json&inc=genres`)).genres);
          }
          for (const raw of names) { const m = mapGenre(raw); if (m) { out.genre = m; break; } }
        }
        if (need.label && (g.releases || []).length) {
          const r = await mbFetch(`https://musicbrainz.org/ws/2/release/${g.releases[0].id}?fmt=json&inc=labels`);
          const li = (r["label-info"] || []).map((x) => x.label && x.label.name).filter(Boolean);
          if (li.length) out.label = li[0];
        }
      }
    } catch (_) { /* fall through to iTunes */ }
    if ((need.genre && !out.genre) || (need.yearReleased && !out.yearReleased)) {
      try {
        const d = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artist + " " + album)}&entity=album&limit=1`).then((r) => r.json());
        if (d.resultCount) {
          const res = d.results[0];
          if (need.genre && !out.genre) out.genre = mapGenre(res.primaryGenreName);
          if (need.yearReleased && !out.yearReleased && res.releaseDate) out.yearReleased = String(res.releaseDate).slice(0, 4);
        }
      } catch (_) {}
    }
    return out;
  }
  const lookupGenre = (artist, album) => lookupAlbum(artist, album, { genre: true }).then((r) => r.genre);

  // Genre for one artist/album: your own collection first (your tags are more
  // granular), then online. Returns "" if nothing confident is found.
  async function genreFor(artist, album) {
    const a = norm(artist), t = norm(album);
    if (!a) return "";
    const hit =
      (t && state.collection.find((i) => i.genre && norm(i.artist) === a && norm(i.title) === t)) ||
      state.collection.find((i) => i.genre && norm(i.artist) === a);
    if (hit) return hit.genre;
    return lookupGenre(artist, album).catch(() => "");
  }

  // Fill blank genres on the wishlist. These are albums you don't own, so most
  // need the online lookup — hence the throttling and the progress toasts.
  async function fillWishlistGenres() {
    if (!state.wishlistSheet) return toast("No wishlist tab found");
    const blanks = state.wishlist.filter((w) => !(w.genre || "").trim() && (w.artist || "").trim());
    if (!blanks.length) return toast("No blank genres on the wishlist");
    if (!confirm(`Look up genres for ${blanks.length} wishlist item${blanks.length > 1 ? "s" : ""}?\n\nThis is rate-limited to about 1/second, so it may take ~${Math.ceil(blanks.length * 2.5 / 60)} min. Existing genres are never touched.`)) return;

    const t = state.wishlistSheet.title;
    const data = [];
    let missed = 0;
    setBusy(true);
    try {
      for (let i = 0; i < blanks.length; i++) {
        const w = blanks[i];
        const g = await genreFor(w.artist, w.title);
        if (g) data.push({ range: `${t}!C${w.row}`, values: [[g]] }); // C = Genre
        else missed++;
        if (i % 5 === 4) toast(`Looking up genres… ${i + 1}/${blanks.length}`, 4000);
      }
      if (!data.length) return toast(`No genres found for those ${blanks.length} wishes`);
      await api("/values:batchUpdate", {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
      });
      await loadData(); render();
      toast(`Filled ${data.length} wishlist genres ✓` + (missed ? ` (${missed} not found)` : ""), 5000);
    } catch (e) {
      console.error("33&Me: wishlist genre fill failed:", e);
      toast("Couldn't fill wishlist genres — are you online?");
    } finally { setBusy(false); }
  }

  // Backfill missing Genre / Year Released / Label across the collection and
  // wishlist from the internet. Only blank cells whose column exists (and, on
  // the wishlist, is enabled) are touched. Rate-limited to ~1 request/second.
  // ---------- batch edit ----------
  // Editable fields for the current tab (exclude Artist/Title — batch-setting
  // those is almost always a mistake).
  function batchFields(scope) {
    return FIELD_DEFS.map((fd) => fd.key).filter((k) => {
      if (CORE_FIELDS.includes(k)) return false;
      if (scope === "collection") return !hiddenOf(k);
      if (scope === "wishlist") return onWish(k);
      return !hiddenOf(k) && onWish(k); // "all" → common to both
    });
  }
  // The records the batch will touch = the full current filter (not the 80 shown).
  function batchRecords() {
    return {
      col: state.scope !== "wishlist" ? (render._colHits || []) : [],
      wish: state.scope !== "collection" ? (render._wishHits || []) : [],
    };
  }
  function batchValueControl() {
    const key = $("#batch-field").value;
    const input = $("#batch-value");
    input.type = key === "date" ? "date" : "text";
    input.value = "";
    const lov = key === "country" ? COUNTRY_VALUES : (listOf(key) || []);
    $("#batch-lov").innerHTML = lov.map((v) => `<option value="${esc(v)}">`).join("");
    if (lov.length) input.setAttribute("list", "batch-lov"); else input.removeAttribute("list");
  }
  function openBatch() {
    const keys = batchFields(state.scope);
    $("#batch-field").innerHTML = keys.map((k) => `<option value="${k}">${esc(labelOf(k))}</option>`).join("");
    const { col, wish } = batchRecords();
    $("#batch-count").textContent = col.length + wish.length;
    $("#batch-scope").textContent = state.scope === "all" ? "collection + wishlist" : state.scope;
    $("#batch-blank-only").checked = false;
    batchValueControl();
    $("#batch-modal").classList.remove("hidden");
    $("#sheet-backdrop").classList.remove("hidden");
  }
  function closeBatch() {
    $("#batch-modal").classList.add("hidden");
    $("#sheet-backdrop").classList.add("hidden");
  }
  async function applyBatch() {
    const key = $("#batch-field").value;
    if (!key) return;
    const val = $("#batch-value").value.trim();
    const blankOnly = $("#batch-blank-only").checked;
    const a1 = (tab, c, r) => "'" + String(tab).replace(/'/g, "''") + "'!" + c + r;
    const { col, wish } = batchRecords();
    const data = [];
    const ci = state.col[colName(key)];
    if (ci !== undefined) col.forEach((rec) => {
      if (blankOnly && String(rec[key] || "").trim()) return;
      data.push({ range: a1(state.collectionSheet.title, colLetter(ci), rec.row), values: [[val]] });
    });
    if (state.wishlistSheet) {
      const wi = state.wishCol[wishColName(key)];
      if (wi !== undefined) wish.forEach((rec) => {
        if (blankOnly && String(rec[key] || "").trim()) return;
        data.push({ range: a1(state.wishlistSheet.title, colLetter(wi), rec.row), values: [[val]] });
      });
    }
    if (!data.length) return toast("Nothing to update");
    if (!confirm(`Set ${labelOf(key)} = "${val || "(blank)"}" on ${data.length} record${data.length > 1 ? "s" : ""}?`)) return;
    setBusy(true);
    try {
      await api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }) });
      await loadData(); render();
      closeBatch();
      toast(`Updated ${data.length} record${data.length > 1 ? "s" : ""} ✓`);
    } catch (e) {
      console.error("33&Me: batch update failed:", e);
      toast("Couldn't update — are you online?");
    } finally { setBusy(false); }
  }

  async function fillAlbumInfo() {
    const a1 = (tab, col, row) => "'" + String(tab).replace(/'/g, "''") + "'!" + col + row;
    const FIELDS = ["genre", "yearReleased", "label"];
    const jobs = [];
    state.collection.forEach((rec) => {
      if (!rec.artist || !rec.title) return;
      const need = {};
      FIELDS.forEach((k) => {
        const idx = state.col[colName(k)];
        if (idx !== undefined && !String(rec[k] || "").trim()) need[k] = true;
      });
      if (Object.keys(need).length) jobs.push({ tab: state.collectionSheet.title, cols: state.col, colFor: colName, rec, need });
    });
    if (state.wishlistSheet) {
      state.wishlist.forEach((rec) => {
        if (!rec.artist || !rec.title) return;
        const need = {};
        FIELDS.forEach((k) => {
          if (!onWish(k)) return;
          const idx = state.wishCol[wishColName(k)];
          if (idx !== undefined && !String(rec[k] || "").trim()) need[k] = true;
        });
        if (Object.keys(need).length) jobs.push({ tab: state.wishlistSheet.title, cols: state.wishCol, colFor: wishColName, rec, need });
      });
    }
    if (!jobs.length) return toast("No missing album info to fill");
    if (!confirm(`Look up missing genre / year released / label for ${jobs.length} record${jobs.length > 1 ? "s" : ""} (collection + wishlist)?\n\nRate-limited to ~1/second, so it may take ~${Math.ceil(jobs.length * 3 / 60)} min. Existing values are never touched.`)) return;

    const data = [];
    let filled = 0, missed = 0;
    setBusy(true);
    try {
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        const r = await lookupAlbum(j.rec.artist, j.rec.title, j.need).catch(() => ({}));
        let any = false;
        FIELDS.forEach((k) => {
          if (!j.need[k] || !r[k]) return;
          const idx = j.cols[j.colFor(k)];
          data.push({ range: a1(j.tab, colLetter(idx), j.rec.row), values: [[r[k]]] });
          filled++; any = true;
        });
        if (!any) missed++;
        if (i % 5 === 4) toast(`Looking up… ${i + 1}/${jobs.length}`, 4000);
      }
      if (!data.length) return toast("Nothing found for those records");
      await api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }) });
      await loadData(); render();
      toast(`Filled ${filled} field${filled > 1 ? "s" : ""} ✓` + (missed ? ` (${missed} not found)` : ""), 5000);
    } catch (e) {
      console.error("33&Me: fill album info failed:", e);
      toast("Couldn't fill — are you online?");
    } finally { setBusy(false); }
  }

  // Debounced online lookup, only once the collection has nothing to offer.
  let genreTimer = null, genreSeq = 0;
  function scheduleGenreLookup() {
    clearTimeout(genreTimer);
    genreTimer = setTimeout(async () => {
      const f = $("#add-form");
      const artist = f.artist.value.trim(), album = f.title.value.trim();
      if (!artist || !album) return;
      // Only look up fields that are blank AND visible in the current mode.
      const wish = state.addMode === "wish";
      const canFill = (k) => wish ? onWish(k) : !hiddenOf(k);
      const need = {};
      ["genre", "yearReleased", "label"].forEach((k) => {
        if (f[k] && !f[k].value.trim() && canFill(k)) need[k] = true;
      });
      if (!Object.keys(need).length) return;
      const seq = ++genreSeq;
      const r = await lookupAlbum(artist, album, need).catch(() => ({}));
      if (seq !== genreSeq) return;            // superseded by newer typing
      const ff = $("#add-form");
      const labels = { genre: "genre", yearReleased: "year released", label: "label" };
      const filled = [];
      Object.keys(need).forEach((k) => {
        if (r[k] && ff[k] && !ff[k].value.trim()) { ff[k].value = r[k]; filled.push(labels[k]); }
      });
      if (filled.length) toast("Looked up: " + filled.join(", "));
    }, 800);
  }

  // If the artist (or artist+album) already exists in the collection, borrow its
  // genre. Never overwrites a genre you've typed. Works for wishes too.
  function autoGenre() {
    const f = $("#add-form");
    if (!f.genre || f.genre.value.trim()) return;
    const a = norm(f.artist.value), t = norm(f.title.value);
    if (!a) return;
    const hit =
      (t && state.collection.find((i) => i.genre && norm(i.artist) === a && norm(i.title) === t)) ||
      state.collection.find((i) => i.genre && norm(i.artist) === a);
    if (hit) f.genre.value = hit.genre;
  }

  function checkDup() {
    const f = $("#add-form");
    const a = norm(f.artist.value), t = norm(f.title.value);
    const warn = $("#dup-warning");
    if (state.editRow || state.editWishRow) { warn.classList.add("hidden"); return; }
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

  // ---------- setup wizard (sheet + tabs) ----------
  // Read a given spreadsheet's tabs directly — this may be a sheet we haven't
  // switched to yet, so it can't go through api() (which uses state.sheetId).
  async function fetchTabs(sheetId) {
    const token = await getToken(false).catch(() => getToken(true));
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,
      { headers: { Authorization: "Bearer " + token } }
    );
    if (!res.ok) throw new Error("Sheets API " + res.status);
    const d = await res.json();
    return (d.sheets || []).map((s) => s.properties).filter((p) => !isAppTab(p.title));
  }

  const NEW_WISHLIST = "␞__new_wishlist__"; // sentinel (record-separator char can't be a tab name)

  async function loadSetupTabs(id) {
    const err = $("#sheet-error");
    try {
      const tabs = await fetchTabs(id);
      const opt = (t, sel) => `<option value="${esc(t)}" ${sel ? "selected" : ""}>${esc(t)}</option>`;
      const curCol = SETTINGS.collectionTab || (state.collectionSheet && state.collectionSheet.title) || "";
      const curWish = SETTINGS.wishlistTab || (state.wishlistSheet && state.wishlistSheet.title) || "";
      $("#setup-collection").innerHTML = tabs.map((t) => opt(t.title, sameName(t.title, curCol))).join("");
      $("#setup-wishlist").innerHTML =
        tabs.map((t) => opt(t.title, sameName(t.title, curWish))).join("") +
        `<option value="${NEW_WISHLIST}" ${curWish ? "" : "selected"}>— create a “Wishlist” tab —</option>`;
      $("#sheet-tabs").classList.remove("hidden");
      err.classList.add("hidden");
      return true;
    } catch (e) {
      $("#sheet-tabs").classList.add("hidden");
      err.textContent = "Couldn't read that sheet's tabs. Check the link and that you can open it.";
      err.classList.remove("hidden");
      return false;
    }
  }

  // Read a tab's header row directly (the sheet may not be the active one).
  async function fetchHeader(sheetId, tab) {
    const token = await getToken(false).catch(() => getToken(true));
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`'${tab}'!1:1`)}`,
      { headers: { Authorization: "Bearer " + token } }
    );
    if (!res.ok) return [];
    const d = await res.json();
    return (d.values && d.values[0]) || [];
  }

  // Render one tab's mapping rows into `container`, pre-selecting the current
  // map or an auto-match against the tab's columns.
  function renderMapFields(container, columns, currentMap, attr) {
    const auto = (key) => {
      const w = [FIELD_COLS[key], WISH_COL[key], labelOf(key)].filter(Boolean).map(norm);
      return columns.find((c) => w.includes(norm(c))) || "";
    };
    $(container).innerHTML = FIELD_DEFS.map((fd) => {
      const cur = (currentMap && currentMap[fd.key]) || auto(fd.key);
      const req = CORE_FIELDS.includes(fd.key);
      const opts = `<option value="">${req ? "— required —" : "(not in my file)"}</option>` +
        columns.map((c) => `<option value="${esc(c)}" ${sameName(c, cur) ? "selected" : ""}>${esc(c)}</option>`).join("");
      return `<label class="setup-map-row"><span>${esc(labelOf(fd.key))}${req ? ' <span class="req-star">*</span>' : ""}</span>
        <select ${attr}="${fd.key}">${opts}</select></label>`;
    }).join("");
  }

  async function loadCollectionMap(id) {
    const tab = $("#setup-collection").value;
    const cols = tab ? await fetchHeader(id, tab).catch(() => []) : [];
    renderMapFields("#setup-map-fields", cols, SETTINGS.map, "data-map");
  }

  async function loadWishlistMap(id) {
    const tab = $("#setup-wishlist").value;
    const wrap = $("#setup-wmap-fields").closest ? $("#setup-wmap-fields") : null;
    if (!tab || tab === NEW_WISHLIST) {
      // No existing wishlist to map (a fresh one uses the app's tidy names).
      $("#setup-wmap-fields").innerHTML = `<p class="sheet-help">A new Wishlist tab will be created with the app's standard columns.</p>`;
      return;
    }
    const cols = await fetchHeader(id, tab).catch(() => []);
    renderMapFields("#setup-wmap-fields", cols, SETTINGS.wishMap, "data-wmap");
  }

  function openSheetModal(firstRun) {
    const form = $("#sheet-form");
    $("#sheet-error").classList.add("hidden");
    $("#sheet-tabs").classList.add("hidden");
    $("#setup-map").classList.add("hidden");
    $("#setup-file-ok").checked = false;
    $("#setup-tabs-ok").checked = false;
    $("#setup-rename").checked = false;
    form.sheeturl.value = state.sheetId ? sheetUrl(state.sheetId) : "";
    // On mandatory first run (no sheet yet) there's nothing to cancel back to.
    $("#sheet-cancel").classList.toggle("hidden", !!firstRun && !state.sheetId);
    $("#sheet-modal").classList.remove("hidden");
    $("#sheet-backdrop").classList.remove("hidden");
    setTimeout(() => form.sheeturl.focus(), 60);
  }

  function closeSheetModal() {
    $("#sheet-modal").classList.add("hidden");
    if ($("#add-sheet").classList.contains("hidden")) $("#sheet-backdrop").classList.add("hidden");
  }

  // Rename the mapped columns' headers to the app's tidy names in the sheet,
  // and return the resulting identity map. Best-effort per column.
  async function tidyHeaders(id, tab, map, canonical) {
    const cols = await fetchHeader(id, tab).catch(() => []);
    const idx = {}; cols.forEach((c, i) => { idx[norm(c)] = i; });
    const out = {};
    for (const [key, userCol] of Object.entries(map)) {
      const nice = canonical(key);
      out[key] = nice;
      if (sameName(userCol, nice)) continue; // already tidy
      const i = idx[norm(userCol)];
      if (i === undefined) continue;
      await api2(id, "/values/" + q(`'${tab}'!${colLetter(i)}1`) + "?valueInputOption=USER_ENTERED",
        { method: "PUT", body: JSON.stringify({ values: [[nice]] }) }).catch(() => {});
    }
    return out;
  }

  // Like api() but against an explicit spreadsheet id (setup may target a sheet
  // we haven't switched to yet).
  async function api2(id, path, opts) {
    const token = await getToken(false).catch(() => getToken(true));
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}${path}`, {
      ...opts, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error("Sheets API " + res.status);
    return res.json();
  }

  // Apply the chosen sheet + tabs + mappings, then reload the app.
  async function applySetup(id) {
    const err = $("#sheet-error");
    const tabsShown = !$("#sheet-tabs").classList.contains("hidden");
    const mapShown = !$("#setup-map").classList.contains("hidden");

    // Collect the two mappings from the form.
    const collect = (attr) => {
      const m = {};
      document.querySelectorAll(`#setup-map .setup-map-row [${attr}]`).forEach((sel) => {
        if (sel.value) m[sel.dataset[attr === "data-map" ? "map" : "wmap"]] = sel.value;
      });
      return m;
    };
    let map = collect("data-map"), wishMap = collect("data-wmap");
    const wishVal = tabsShown ? $("#setup-wishlist").value : "";
    const wishIsNew = wishVal === NEW_WISHLIST || wishVal === "";

    if (mapShown) {
      if (!map.artist || !map.title) {
        err.textContent = "Collection: map both Artist and Album Name."; err.classList.remove("hidden"); return;
      }
      if (!wishIsNew && (!wishMap.artist || !wishMap.title)) {
        err.textContent = "Wishlist: map both Artist and Album Name (or create a new Wishlist tab)."; err.classList.remove("hidden"); return;
      }
    }

    const switching = id !== state.sheetId;
    if (switching) {
      state.sheetId = id;
      localStorage.setItem("sheetId33", id);
      state.collectionSheet = null; state.wishlistSheet = null;
      state.collection = []; state.wishlist = [];
      await loadSettings().catch(() => {});
    }

    setBusy(true);
    try {
      if (mapShown && $("#setup-rename").checked) {
        // Rewrite the users' headers to the tidy app names, then map = identity.
        map = await tidyHeaders(id, $("#setup-collection").value, map, (k) => FIELD_COLS[k] || k);
        if (!wishIsNew) wishMap = await tidyHeaders(id, wishVal, wishMap, (k) => WISH_COL[k] || FIELD_COLS[k] || k);
      }
      if (tabsShown) {
        SETTINGS.collectionTab = $("#setup-collection").value || "";
        SETTINGS.wishlistTab = wishIsNew ? "" : wishVal;
      }
      if (mapShown) { SETTINGS.map = map; SETTINGS.wishMap = wishIsNew ? {} : wishMap; }
      closeSheetModal();
      if (tabsShown || mapShown) await saveSettings();
    } catch (_) {
      toast("Saved locally, but couldn't write everything to the sheet");
    } finally { setBusy(false); }
    showApp();
  }

  async function showApp() {
    $("#signin-view").classList.add("hidden");
    $("#app-view").classList.remove("hidden");
    if (!state.sheetId) { openSheetModal(true); return; } // must pick a sheet first
    const hadCache = loadCache();
    if (hadCache) render();
    setBusy(true);
    try {
      await loadSettings().catch(() => {}); // non-fatal; tab choices drive ensureSetup
      await ensureSetup();
      await loadData();
      $("#offline-badge").classList.add("hidden");
      applyReadOnlyUI();
      render();
      // Background housekeeping writes only make sense for editors.
      if (state.canWrite) {
        syncLists()
          .catch((e) => console.error("33&Me: list sync failed:", e))
          .then(() => maybeFixValidation()); // never blocks showing records
      }
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
    $("#fill-genres-btn").addEventListener("click", fillAlbumInfo);
    $("#batch-btn").addEventListener("click", openBatch);
    $("#batch-cancel").addEventListener("click", closeBatch);
    $("#batch-apply").addEventListener("click", applyBatch);
    $("#batch-field").addEventListener("change", batchValueControl);
    $("#sheet-btn").addEventListener("click", () => openSheetModal(false));
    $("#refresh-btn").addEventListener("click", showApp);

    $("#sheet-cancel").addEventListener("click", closeSheetModal);
    const setupSheetId = () => {
      const id = parseSheetId($("#sheet-form").sheeturl.value);
      const err = $("#sheet-error");
      if (!id) {
        err.textContent = "That doesn't look like a Google Sheets link or ID.";
        err.classList.remove("hidden");
      }
      return id;
    };
    const setupId = () => parseSheetId($("#sheet-form").sheeturl.value);
    // Step 1 → 2: confirm the file, load its tabs.
    $("#setup-file-ok").addEventListener("change", async (ev) => {
      if (!ev.target.checked) { $("#sheet-tabs").classList.add("hidden"); $("#setup-map").classList.add("hidden"); return; }
      const id = setupSheetId();
      if (!id) { ev.target.checked = false; return; }
      await loadSetupTabs(id);
    });
    // Step 2 → 3: confirm the tabs, map each tab's columns.
    $("#setup-tabs-ok").addEventListener("change", async (ev) => {
      if (!ev.target.checked) { $("#setup-map").classList.add("hidden"); return; }
      const id = setupId();
      if (!id) { ev.target.checked = false; return; }
      await loadCollectionMap(id);
      await loadWishlistMap(id);
      $("#setup-map").classList.remove("hidden");
    });
    $("#setup-collection").addEventListener("change", () => { const id = setupId(); if (id && $("#setup-tabs-ok").checked) loadCollectionMap(id); });
    $("#setup-wishlist").addEventListener("change", () => { const id = setupId(); if (id && $("#setup-tabs-ok").checked) loadWishlistMap(id); });
    $("#setup-automatch").addEventListener("click", async () => {
      const id = setupId(); if (!id) return;
      const ccols = await fetchHeader(id, $("#setup-collection").value).catch(() => []);
      renderMapFields("#setup-map-fields", ccols, {}, "data-map"); // {} ⇒ fresh auto-match by name
      const wv = $("#setup-wishlist").value;
      if (wv && wv !== NEW_WISHLIST) {
        const wcols = await fetchHeader(id, wv).catch(() => []);
        renderMapFields("#setup-wmap-fields", wcols, {}, "data-wmap");
      }
    });
    $("#sheet-form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const id = setupSheetId();
      if (id) applySetup(id);
    });
    $("#search-input").addEventListener("input", render);
    $("#sort-by").addEventListener("change", (ev) => {
      setSortField(ev.target.value); // resets to the field's natural direction
      render();
    });
    $("#sort-dir").addEventListener("click", () => {
      state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
      try { localStorage.setItem("sortdir33", state.sortDir); } catch (_) {}
      updateSortDirIcon();
      render();
    });
    document.querySelectorAll(".segments [data-scope]").forEach((b) =>
      b.addEventListener("click", () => {
        state.scope = b.dataset.scope;
        document.querySelectorAll("[data-scope]").forEach((x) => x.classList.toggle("active", x === b));
        renderSortOptions(); // sort choices depend on the active tab
        render();
      }));
    $("#add-btn").addEventListener("click", () => openSheet("record"));
    $("#detail-close").addEventListener("click", closeDetail);
    $("#detail-edit").addEventListener("click", () => {
      const it = state.detailItem;
      closeDetail();
      if (it) openEdit(it);
    });
    $("#detail-delete").addEventListener("click", async () => {
      const it = state.detailItem;
      if (it && await deleteRecord(it)) closeDetail();
    });
    $("#delete-record").addEventListener("click", async () => {
      const it = state.editItem;
      if (it && await deleteRecord(it)) closeSheet();
    });
    $("#admin-btn").addEventListener("click", openAdmin);
    $("#admin-close").addEventListener("click", closeAdmin);
    $("#admin-save").addEventListener("click", saveAdmin);
    $("#admin-reset").addEventListener("click", () => renderAdmin(defaultSettings()));
    $("#admin-recompute").addEventListener("click", () => { closeAdmin(); recomputeCosts(); });
    $("#admin-setup").addEventListener("click", () => { closeAdmin(); openSheetModal(false); });
    $("#sheet-backdrop").addEventListener("click", () => {
      closeSheet();
      closeDetail();
      closeAdmin();
      closeBatch();
      if (state.sheetId) closeSheetModal(); // don't let them dismiss the mandatory first-run picker
    });
    $("#cancel-add").addEventListener("click", closeSheet);
    document.querySelectorAll("[data-addmode]").forEach((b) =>
      b.addEventListener("click", () => {
        state.addMode = b.dataset.addmode;
        document.querySelectorAll("[data-addmode]").forEach((x) => x.classList.toggle("active", x === b));
        applyAddMode();
      }));
    // Genre: try your own collection first (instant), then look it up online.
    const onIdent = () => { checkDup(); autoGenre(); scheduleGenreLookup(); };
    $("#add-form").artist.addEventListener("input", onIdent);
    $("#add-form").title.addEventListener("input", onIdent);
    $("#add-form").price.addEventListener("input", updateCost);
    $("#add-form").currency.addEventListener("input", updateCost);
    $("#add-form").date.addEventListener("change", updateCost); // purchase date drives the rate

    $("#add-form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const data = {
        artist: f.artist.value.trim(), title: f.title.value.trim(),
        label: f.label.value.trim(), yearReleased: f.yearReleased.value.trim(),
        genre: f.genre.value.trim(), year: f.year.value.trim(),
        format: f.format.value, condition: f.condition.value,
        location: f.location.value.trim(), city: f.city.value.trim(),
        country: f.country.value.trim(), price: f.price.value.trim(),
        currency: f.currency.value.trim(), date: f.date.value,
        notes: f.notes.value.trim(),
      };
      if (state.editRow) {
        const miss = missingRequired(data);
        if (miss) return toast(miss + " is required");
        updateRecord(state.editRow, data);
      } else if (state.editWishRow) {
        if (!data.artist && !data.title && !data.genre)
          return toast("Give the wish at least an artist, title, or genre");
        updateWish(state.editWishRow, data);
      } else if (state.addMode === "record") {
        const miss = missingRequired(data);
        if (miss) return toast(miss + " is required");
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
      else if (btn.dataset.view !== undefined) openDetail(render._colHits[+btn.dataset.view]);
      else if (btn.dataset.edit !== undefined) openEdit(render._colHits[+btn.dataset.edit]);
      else if (btn.dataset.got !== undefined) {
        const w = render._wishHits[+btn.dataset.got];
        state.pendingWishRow = w.row;
        openSheet("record", w);
        toast("Fill in the purchase — the wish clears itself when you save");
      }
      else if (btn.dataset.editwish !== undefined) {
        const w = render._wishHits[+btn.dataset.editwish];
        const prefill = {};
        FIELD_DEFS.forEach((fd) => { if (onWish(fd.key)) prefill[fd.key] = w[fd.key] || ""; });
        openSheet("wish", prefill, null, w.row);
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
    console.log("33&Me build loaded — app v" + APP_VERSION + ", validation " + VALIDATION_VERSION);
    const ver = $("#app-version");
    if (ver) ver.textContent = "v" + APP_VERSION;
    state.sheetId = localStorage.getItem("sheetId33") || CONFIG_SHEET || "";
    state.sortBy = localStorage.getItem("sort33") || "artist";
    state.sortDir = localStorage.getItem("sortdir33") || defaultDir(state.sortBy);
    wire();
    renderSortOptions(); // scope-aware sort choices (default scope = "all")
    applySettings(); // populate form labels with defaults until settings load
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
