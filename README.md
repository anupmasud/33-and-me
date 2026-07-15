# 🎵 33&Me

A personal record-collection PWA. Your Google Sheet **is** the database — the app
reads and writes it directly. No server, no separate database, free hosting on
GitHub Pages.

**What it does**

- Instant search across your collection *and* wishlist — built for standing in a
  record store asking "do I have this already?"
- Add records with the mandatory fields (artist, title, format, condition, purchase info)
- Duplicate warning while you type
- "♪ Listened" button: increments the listen count and stamps today's date
- Wishlist with "Got it!" flow: prefills the add-record form and clears the wish on save
- Works offline: the app shell and your last-synced data are cached, so search
  still works in a basement record shop with no signal (writes need a connection)
- On first run it adds these columns to your sheet (existing data untouched):
  `Format, Condition, Listen Count, Last Listened, Rating, Notes` — and creates
  a `Wishlist` tab if one doesn't exist

## One-time setup (~10 minutes)

### 1. Put this code on GitHub and enable Pages

1. Create a repo (e.g. `33-and-me`) and push these files to the `main` branch.
2. In the repo: **Settings → Pages → Source: Deploy from a branch → main / root**.
3. After a minute your app is live at `https://YOUR-USERNAME.github.io/33-and-me/`.

### 2. Create a Google OAuth Client ID (this is the "Sign in with Google" part)

> The app never sees your Google password. Google's own login screen handles
> sign-in and hands the app a temporary token scoped to Sheets only.

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a
   project (name it anything, e.g. `33-and-me`).
2. **APIs & Services → Library** → search **Google Sheets API** → **Enable**.
3. **APIs & Services → OAuth consent screen** → External → fill in the app name
   and your email → add yourself as a **Test user**. (As a test user you can use
   the app indefinitely without publishing/verification.)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://YOUR-USERNAME.github.io`
     (and `http://localhost:8000` if you want to develop locally)
   - No redirect URIs needed.
5. Copy the **Client ID** (ends in `.apps.googleusercontent.com`).

### 3. Configure the app

Open `config.js` and paste your Client ID:

```js
CLIENT_ID: "1234567890-xxxx.apps.googleusercontent.com",
```

`SPREADSHEET_ID` is already set to your collection sheet. Commit and push —
GitHub Pages redeploys automatically.

### 4. Install it on your phone

Open the app URL in your phone browser, sign in with Google, then:

- **Android/Chrome:** menu → *Add to Home screen* (or *Install app*)
- **iPhone/Safari:** Share → *Add to Home Screen*

It now opens full-screen like a native app.

## Local development

```bash
python3 -m http.server 8000
# open http://localhost:8000  (add this origin to the OAuth client first)
```

## How your sheet is used

- The **first tab** is treated as the collection (set `COLLECTION_SHEET` in
  `config.js` to pin a specific tab name).
- Existing columns are matched **by header name** (`Artist`, `Album Name`,
  `Genre`, `Location`, `Year`, `Date`, `Original Cost`, `Original Currency`, …),
  so the app adapts if you reorder columns.
- New records are appended as rows; listens update two cells; wishlist rows are
  deleted on "Got it!"/Remove. Nothing else is modified.

## Roadmap (from the requirements doc)

- v-next: auto-fill year/label/pressing details from the Discogs or MusicBrainz API
