/**
 * Generated. The app's identity -- used for link tags, the key screen and the
 * footer -- and the check that React loaded before anything reads it.
 */
window.APP_META = {
  "app": "screener",
  "repo": "eodhd-screener",
  "title": "EODHD Screener",
  "description": "Filter and rank stocks across exchanges by market cap, P/E, dividend yield, sector and more — on your own EODHD key.",
  "keyNote": "The Screener API is not on the free tier: it comes with All-In-One and EOD+Intraday All World Extended. On a free key the app opens and tells you exactly that.",
  "storage": [
    "eodhd_saved_screens",
    "eodhd_screener_session"
  ],
  "ownFailures": [],
  "ownLines": {}
};

if (!window.React || !window.ReactDOM) {
  var bootError = document.getElementById('boot-error');
  if (bootError) bootError.style.display = 'block';
  throw new Error('React did not load from unpkg.com, so the app cannot start. See the message on the page.');
}
