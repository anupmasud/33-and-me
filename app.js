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
  const APP_VERSION = "17";

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
  const VALIDATION_VERSION = "v6";

  // ---------- admin settings (Phase 1) ----------
  // Editable per-field settings. Defaults here; overrides load from a hidden
  // "33Settings" tab in the sheet so they travel with the data. Field keys match
  // the form input names.
  const SETTINGS_SHEET = "33Settings";
  const FIELD_DEFS = [
    { key: "artist", label: "Artist", req: true, mode: "both" },
    { key: "title", label: "Title", req: true, mode: "both" },
    { key: "genre", label: "Genre", req: false, mode: "both" },
    { key: "format", label: "Format", req: true, mode: "record" },
    { key: "condition", label: "Condition", req: true, mode: "record" },
    { key: "location", label: "Where bought", req: true, mode: "record" },
    { key: "city", label: "City", req: false, mode: "record" },
    { key: "country", label: "Country", req: false, mode: "record" },
    { key: "price", label: "Price", req: true, mode: "record" },
    { key: "currency", label: "Currency", req: true, mode: "record" },
    { key: "year", label: "Year Bought", req: false, mode: "record" },
    { key: "date", label: "Date bought", req: true, mode: "record" },
    { key: "notes", label: "Notes", req: false, mode: "both" },
  ];
  const DATE_FORMATS = ["yyyy-mm-dd", "dd/mm/yyyy", "mm/dd/yyyy", "d mmm yyyy"];
  const defaultSettings = () => ({
    labels: Object.fromEntries(FIELD_DEFS.map((f) => [f.key, f.label])),
    required: Object.fromEntries(FIELD_DEFS.map((f) => [f.key, f.req])),
    lists: { format: FORMAT_VALUES.slice(), condition: CONDITION_VALUES.slice(), genre: GENRE_VALUES.slice() },
    dateFormat: "yyyy-mm-dd",
    currency: "EUR",
  });
  let SETTINGS = defaultSettings();
  const labelOf = (key) => (SETTINGS.labels && SETTINGS.labels[key]) || key;
  const requiredOf = (key) => !!(SETTINGS.required && SETTINGS.required[key]);
  const listOf = (key) => (SETTINGS.lists && SETTINGS.lists[key]) || [];

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
    sheetId: "",            // active spreadsheet id (chosen at runtime)
    scope: "all",
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

    // 2. Re-apply the dropdowns that should exist.
    const rule = (colName, values) => {
      const idx = state.col[colName];
      if (idx === undefined) return;
      requests.push({
        setDataValidation: {
          range: { ...dataRows, startColumnIndex: idx, endColumnIndex: idx + 1 },
          rule: {
            condition: { type: "ONE_OF_LIST", values: values.map((v) => ({ userEnteredValue: v })) },
            showCustomUi: true,
            strict: false, // offer the list but don't reject existing odd values
          },
        },
      });
    };
    rule("Condition", listOf("condition"));
    rule("Rating", RATING_VALUES);
    rule("Format", listOf("format"));
    rule("Genre", listOf("genre"));
    rule("Country", COUNTRY_VALUES);

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
      city: hv(r, "City"),
      country: hv(r, "Country"),
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
        SETTINGS = {
          labels: { ...SETTINGS.labels, ...(p.labels || {}) },
          required: { ...SETTINGS.required, ...(p.required || {}) },
          lists: {
            format: Array.isArray(pl.format) && pl.format.length ? pl.format : SETTINGS.lists.format,
            condition: Array.isArray(pl.condition) && pl.condition.length ? pl.condition : SETTINGS.lists.condition,
            genre: Array.isArray(pl.genre) && pl.genre.length ? pl.genre : SETTINGS.lists.genre,
          },
          dateFormat: p.dateFormat || SETTINGS.dateFormat,
          currency: p.currency || SETTINGS.currency,
        };
      }
    } catch (_) { /* tab/cell missing → defaults */ }
    applySettings();
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
  function setSelectOptions(sel, values) {
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = values.map((v) => `<option>${esc(v)}</option>`).join("");
    if (values.includes(cur)) sel.value = cur;
  }
  function applySettings() {
    FIELD_DEFS.forEach((fd) => {
      const lbl = document.querySelector(`[data-fl="${fd.key}"]`);
      if (lbl) lbl.textContent = labelOf(fd.key);
      const req = document.querySelector(`[data-req="${fd.key}"]`);
      if (req) req.classList.toggle("hidden", !requiredOf(fd.key));
    });
    const form = $("#add-form");
    if (form) {
      setSelectOptions(form.format, listOf("format"));
      setSelectOptions(form.condition, listOf("condition"));
    }
  }

  // First required field (record mode) left empty → its label, else null.
  function missingRequired(data) {
    for (const fd of FIELD_DEFS) {
      if (!requiredOf(fd.key)) continue;
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
  // Convert an amount in `currency` to USD; returns a number or null if it can't.
  async function toUSD(amount, currency) {
    const amt = parseFloat(String(amount == null ? "" : amount).replace(/[^0-9.\-]/g, ""));
    if (!isFinite(amt)) return null;
    const cur = String(currency || "").trim().toUpperCase();
    if (!cur || cur === "USD") return amt;
    const r = await getRates();
    const rate = r.rates[cur];
    if (!rate) return null;
    return amt / rate;
  }
  // Refresh the read-only "Cost (USD)" field from the current price/currency inputs.
  async function updateCostUsd() {
    const f = $("#add-form");
    if (!f.costusd) return;
    const usd = await toUSD(f.price.value, f.currency.value).catch(() => null);
    f.costusd.value = usd == null ? "" : usd.toFixed(2);
  }

  async function addRecord(f) {
    const width = state.headers.length;
    const row = new Array(width).fill("");
    const put = (name, val) => { if (state.col[name] !== undefined) row[state.col[name]] = val; };
    const maxSN = state.collection.reduce((m) => m + 1, 1);
    put("SN", String(maxSN));
    put("Artist", f.artist); put("Album Name", f.title); put("Genre", f.genre);
    put("Location", f.location); put("City", f.city); put("Country", f.country); put("Year", f.year);
    put("Date", f.date); put("Original Cost", f.price); put("Original Currency", f.currency);
    const usd = await toUSD(f.price, f.currency).catch(() => null);
    if (usd != null) put("Cost (USD)", usd.toFixed(2));
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
      openSheet("record", {
        artist: g("Artist"),
        title: g("Album Name") || g("Title"),
        genre: g("Genre"),
        location: g("Location"),
        city: g("City"),
        country: g("Country"),
        year: g("Year") === "" ? "" : String(g("Year")),
        format: g("Format"),
        condition: g("Condition"),
        price: g("Original Cost") === "" ? "" : String(g("Original Cost")),
        currency: g("Original Currency"),
        costusd: g("Cost (USD)") === "" ? "" : String(g("Cost (USD)")),
        date: toISODate(g("Date")),
        notes: g("Notes"),
      }, item.row);
      state.editItem = item; // set after openSheet (which clears it)
    } catch (e) {
      toast("Couldn't load that record to edit — are you online?");
    } finally { setBusy(false); }
  }

  // Friendlier labels for a few columns in the read-only detail view.
  // Map a sheet column header to its configurable display label for the detail view.
  const FIELD_COLS = {
    artist: "Artist", title: "Album Name", genre: "Genre", format: "Format",
    condition: "Condition", location: "Location", city: "City", country: "Country",
    price: "Original Cost", currency: "Original Currency", year: "Year", date: "Date", notes: "Notes",
  };
  function columnLabel(header) {
    for (const [key, col] of Object.entries(FIELD_COLS)) {
      if (col === header) return labelOf(key);
    }
    if (header === "Title") return labelOf("title");
    return header;
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
    $("#admin-fields").innerHTML = FIELD_DEFS.map((fd) => `
      <div class="admin-field">
        <input class="admin-label" data-akey="${fd.key}" value="${esc(s.labels[fd.key] || fd.label)}" aria-label="Label for ${esc(fd.key)}" />
        <label class="admin-req"><input type="checkbox" data-areq="${fd.key}" ${s.required[fd.key] ? "checked" : ""} /></label>
      </div>`).join("");
    $("#admin-dateformat").innerHTML = DATE_FORMATS
      .map((f) => `<option ${f === s.dateFormat ? "selected" : ""}>${f}</option>`).join("");
    $("#admin-currency").value = s.currency;
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
    FIELD_DEFS.forEach((fd) => {
      const lin = document.querySelector(`.admin-label[data-akey="${fd.key}"]`);
      const cb = document.querySelector(`[data-areq="${fd.key}"]`);
      if (lin) SETTINGS.labels[fd.key] = lin.value.trim() || fd.label;
      if (cb) SETTINGS.required[fd.key] = cb.checked;
    });
    const parseList = (sel, fallback) => {
      const arr = [...new Set($(sel).value.split("\n").map((x) => x.trim()).filter(Boolean))];
      return arr.length ? arr : fallback;
    };
    SETTINGS.lists = {
      format: parseList("#admin-list-format", SETTINGS.lists.format),
      condition: parseList("#admin-list-condition", SETTINGS.lists.condition),
      genre: parseList("#admin-list-genre", SETTINGS.lists.genre),
    };
    SETTINGS.dateFormat = $("#admin-dateformat").value || "yyyy-mm-dd";
    SETTINGS.currency = $("#admin-currency").value.trim() || "EUR";
    applySettings();
    setBusy(true);
    try {
      await saveSettings();
      // Re-apply the sheet's dropdowns/date format if lists or format changed.
      if (SETTINGS.dateFormat !== prevDateFormat || JSON.stringify(SETTINGS.lists) !== prevLists) {
        await fixValidation().catch(() => {});
      }
      toast("Settings saved ✓");
      closeAdmin();
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
    set("Artist", f.artist);
    set("Album Name", f.title); set("Title", f.title); // whichever column the sheet uses
    set("Genre", f.genre); set("Location", f.location); set("City", f.city); set("Country", f.country); set("Year", f.year);
    set("Date", f.date); set("Original Cost", f.price); set("Original Currency", f.currency);
    const usd = await toUSD(f.price, f.currency).catch(() => null);
    if (usd != null) set("Cost (USD)", usd.toFixed(2));
    set("Format", f.format); set("Condition", f.condition); set("Notes", f.notes);
    // Listen Count / Last Listened / SN are intentionally left untouched.

    setBusy(true);
    try {
      await api("/values:batchUpdate", {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
      });
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

  // Wishlist columns are fixed: A=Artist B=Title C=Genre D=Notes E=Added.
  // Write A–D and leave the "Added" date untouched.
  async function updateWish(row, f) {
    const t = state.wishlistSheet.title;
    setBusy(true);
    try {
      await api("/values/" + q(`${t}!A${row}:D${row}`) + "?valueInputOption=USER_ENTERED", {
        method: "PUT",
        body: JSON.stringify({ values: [[f.artist, f.title, f.genre, f.notes]] }),
      });
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
            <div class="card-title"><button class="title-link" data-view="${idx}">${esc(i.title)}</button></div>
            <div class="card-artist">${esc(i.artist)}</div>
            <div class="card-meta">${esc([i.genre, i.format, i.year, i.location, i.city, i.country].filter(Boolean).join(" · "))}</div>
            ${i.notes ? `<div class="card-notes">${esc(i.notes)}</div>` : ""}
          </div>
          <div class="rec-actions">
            <button class="listen-btn" data-listen="${idx}">♪ Listened</button>
            <div class="listen-meta">${i.listens ? `${i.listens}× · ${esc(i.lastListened || "")}` : "never played"}</div>
            <button class="chip-btn" data-edit="${idx}">Edit</button>
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
            <button class="chip-btn" data-editwish="${idx}">Edit</button>
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
    form.date.value = todayISO();
    form.currency.value = SETTINGS.currency; // configurable default (prefill overrides)
    if (prefill) {
      form.artist.value = prefill.artist || "";
      form.title.value = prefill.title || "";
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
      if (form.costusd) form.costusd.value = prefill.costusd || "";
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
    // country suggestions: the country list plus any already in the sheet
    const countries = [...new Set([...COUNTRY_VALUES, ...state.collection.map((i) => i.country)].filter(Boolean))].sort();
    $("#country-list").innerHTML = countries.map((c) => `<option value="${esc(c)}">`).join("");
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
    state.editRow = null;
    state.editWishRow = null;
    state.editItem = null;
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

  // ---------- sheet picker ----------
  function openSheetModal(firstRun) {
    const form = $("#sheet-form");
    $("#sheet-error").classList.add("hidden");
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

  function applySheet(id) {
    if (id === state.sheetId) { closeSheetModal(); return; }
    state.sheetId = id;
    localStorage.setItem("sheetId33", id);
    // reset per-sheet state so the new sheet is set up from scratch
    state.collectionSheet = null; state.wishlistSheet = null;
    state.collection = []; state.wishlist = [];
    closeSheetModal();
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
      await ensureSetup();
      await loadSettings().catch(() => {}); // non-fatal
      await loadData();
      $("#offline-badge").classList.add("hidden");
      render();
      maybeFixValidation(); // background; never blocks showing records
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
    $("#fill-genres-btn").addEventListener("click", fillGenres);
    $("#sheet-btn").addEventListener("click", () => openSheetModal(false));
    $("#refresh-btn").addEventListener("click", showApp);

    $("#sheet-cancel").addEventListener("click", closeSheetModal);
    $("#sheet-form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const id = parseSheetId(ev.target.sheeturl.value);
      const err = $("#sheet-error");
      if (!id) {
        err.textContent = "That doesn't look like a Google Sheets link or ID.";
        err.classList.remove("hidden");
        return;
      }
      applySheet(id);
    });
    $("#search-input").addEventListener("input", render);
    document.querySelectorAll(".segments [data-scope]").forEach((b) =>
      b.addEventListener("click", () => {
        state.scope = b.dataset.scope;
        document.querySelectorAll("[data-scope]").forEach((x) => x.classList.toggle("active", x === b));
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
    $("#sheet-backdrop").addEventListener("click", () => {
      closeSheet();
      closeDetail();
      closeAdmin();
      if (state.sheetId) closeSheetModal(); // don't let them dismiss the mandatory first-run picker
    });
    $("#cancel-add").addEventListener("click", closeSheet);
    document.querySelectorAll("[data-addmode]").forEach((b) =>
      b.addEventListener("click", () => {
        state.addMode = b.dataset.addmode;
        document.querySelectorAll("[data-addmode]").forEach((x) => x.classList.toggle("active", x === b));
        applyAddMode();
      }));
    $("#add-form").artist.addEventListener("input", checkDup);
    $("#add-form").title.addEventListener("input", checkDup);
    $("#add-form").price.addEventListener("input", updateCostUsd);
    $("#add-form").currency.addEventListener("input", updateCostUsd);

    $("#add-form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const data = {
        artist: f.artist.value.trim(), title: f.title.value.trim(),
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
        openSheet("wish", { artist: w.artist, title: w.title, genre: w.genre, notes: w.notes }, null, w.row);
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
    wire();
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
