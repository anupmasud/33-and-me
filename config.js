/* ================= 33&Me configuration =================
   1) CLIENT_ID: create a Google OAuth "Web application" client
      (see README.md, step 2) and paste its ID here.
   2) SPREADSHEET_ID: an OPTIONAL default sheet. Each user can also
      connect their own sheet at runtime via the footer "Sheet" button
      (stored in their browser, overrides this default). Leave it ""
      to make every user pick their own sheet on first run.
   3) COLLECTION_SHEET: leave "" to use the first tab automatically,
      or set the exact tab name.                              */
window.CONFIG = {
  CLIENT_ID: "439826223009-h37rll8c851ic75hm6kqh0dsbcvome56.apps.googleusercontent.com",
  // Test/duplicate sheet — the original stays untouched until the app is final.
  SPREADSHEET_ID: "1Wi9CkkJCQWZmTVzscd3w5l2Hateo4O_kIpVWn0s59EE",
  COLLECTION_SHEET: "",
  WISHLIST_SHEET: "Wishlist",
};
