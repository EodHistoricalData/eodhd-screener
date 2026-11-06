// Screener deep link — the contract the EODHD Academy links into.
//
//   https://terminal.eodhd.com/#/screener?exchange=NYSE&minMarketCap=2000000000&minDividendYield=3
//
// The hash carries the tab and, after '?', the screener's own filter keys exactly as
// ScreenerView holds them (minDividendYield in percent, minMarketCap in dollars, sort
// keys as the API spells them). Two extras: `preset=<id>` applies one of the built-in
// presets instead, and `run=0` fills the form without searching. Unknown keys are
// dropped, values are kept as strings because that is what the filter inputs hold,
// and the query is stripped from the URL once consumed so a re-render or a Back does
// not re-run it.
//
// Pure functions only — no React, no DOM beyond window.location in consume() — so the
// parser is unit-tested.
(function () {
  const FILTER_KEYS = [
    'exchange', 'minMarketCap', 'maxMarketCap', 'minPE', 'maxPE', 'sector',
    'minDividendYield', 'maxDividendYield', 'minEPS', 'minPrice', 'maxPrice',
    'minVolume', 'minChangeP', 'maxChangeP', 'sortBy', 'sortOrder',
  ];
  const SORT_BY = new Set(['market_capitalization', 'earnings_share', 'dividend_yield', 'adjusted_close', 'avgvol_1d', 'refund_1d_p', 'refund_5d_p']);
  // Link values are read in any case and handed over in the form's own
  // spelling: "sortOrder=ASC", "sortBy=Dividend_Yield", "sector=technology",
  // "preset=Growth" were dropped in silence, and "exchange=TO" (the link the
  // screener writes itself after Toronto) opened the Exchange list empty
  // because it was lower-cased to "to".
  // The form's exchange values, keyed by their lower case.
  const EXCHANGES = { us: 'us', nyse: 'nyse', nasdaq: 'nasdaq', lse: 'lse', to: 'TO', xetra: 'xetra', pa: 'pa', as: 'as', au: 'au', mc: 'mc', sw: 'sw', nse: 'nse' };
  // Exchanges the EODHD screener answers with no rows at all: Hong Kong,
  // Milan and Johannesburg read "No stocks match your filters" whatever the
  // filters. Said, not searched.
  const NOT_COVERED = { hk: 'Hong Kong', mi: 'Milan', jse: 'South Africa (JSE)' };
  // Own keys only: a link's "__proto__" or "constructor" read the object's
  // prototype and printed "[object Object]".
  const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null);
  const notCovered = (exchange) => own(NOT_COVERED, String(exchange || '').trim().toLowerCase());
  const notCoveredNote = (exchange) => notCovered(exchange) + ' is not covered by the EODHD screener: it answers no stocks for it.';
  const SECTORS = ['Technology', 'Healthcare', 'Financial Services', 'Consumer Cyclical', 'Communication Services',
    'Industrials', 'Consumer Defensive', 'Energy', 'Utilities', 'Real Estate', 'Basic Materials'];
  // "financial-services", "Financial_Services", "financial  services".
  const looseKey = (v) => String(v || '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  const sectorOf = (v) => SECTORS.find((s) => looseKey(s) === looseKey(v)) || null;
  const NUMERIC = new Set(['minMarketCap', 'maxMarketCap', 'minPE', 'maxPE', 'minDividendYield', 'maxDividendYield', 'minEPS', 'minPrice', 'maxPrice', 'minVolume', 'minChangeP', 'maxChangeP']);

  // '#/screener?a=1&b=2' -> { tab: 'screener', query: 'a=1&b=2' }; '#/screener' -> query ''.
  function splitHash(hash) {
    const raw = String(hash || '').replace(/^#\/?/, '');
    const q = raw.indexOf('?');
    return q === -1 ? { tab: raw, query: '' } : { tab: raw.slice(0, q), query: raw.slice(q + 1) };
  }

  // Parse the query into { filters, preset, run }, and `ignored` -- what the link
  // named that cannot be used, each as a phrase to show -- when there is any.
  // Returns null when there is nothing for the screener in it, so callers can
  // `if (!link) return`.
  function parse(hash) {
    const { tab, query } = splitHash(hash);
    if ((tab && tab !== 'screener') || !query) return null;
    let params;
    try { params = new URLSearchParams(query); } catch (_) { return null; }
    const filters = {};
    let preset = null;
    let run = true;
    const ignored = [];
    let notCoveredExchange = null;
    const shown = (v) => '"' + String(v).slice(0, 30) + '"';
    const skip = (key, v, why) => { ignored.push(key + ' ' + shown(v) + (why ? ' (' + why + ')' : '')); };
    params.forEach((value, key) => {
      const v = String(value).trim();
      // Kept as typed, for the note; the screener matches it to a Quick
      // Screen's id in any case, and says when none has it.
      if (key === 'preset') { if (/^[a-z0-9_-]{1,40}$/i.test(v)) preset = v; else if (v) skip(key, v); return; }
      if (key === 'run') { run = !(v === '0' || v.toLowerCase() === 'false'); return; }
      if (!FILTER_KEYS.includes(key) || v === '') return;
      if (NUMERIC.has(key)) {
        if (!/^-?\d+(\.\d+)?$/.test(v)) { skip(key, v, 'not a number'); return; }   // a non-number would break the request
        filters[key] = v;
        return;
      }
      if (key === 'sortBy') { if (SORT_BY.has(v.toLowerCase())) filters.sortBy = v.toLowerCase(); else skip(key, v); return; }
      if (key === 'sortOrder') { const o = v.toLowerCase(); if (o === 'asc' || o === 'desc') filters.sortOrder = o; else skip(key, v); return; }
      if (key === 'exchange') {
        const low = v.toLowerCase();
        // Not swapped for the default exchange either: with other filters
        // beside it, the link ran a US screen under a Hong Kong link.
        // `notCovered` tells the screener not to run.
        if (notCovered(low)) { skip(key, v, notCovered(low) + ' is not covered by the EODHD screener'); notCoveredExchange = low; return; }
        if (own(EXCHANGES, low)) filters.exchange = own(EXCHANGES, low); else skip(key, v);
        return;
      }
      if (key === 'sector') { const sec = sectorOf(v); if (sec) filters.sector = sec; else skip(key, v); return; }
    });
    if (!preset && Object.keys(filters).length === 0 && !ignored.length) return null;
    const out = { filters, preset, run };
    if (ignored.length) out.ignored = ignored;
    if (notCoveredExchange) out.notCovered = notCoveredExchange;
    return out;
  }

  // Read the current location once, hand back the parsed link, and strip the query so
  // nothing downstream sees it again. Safe to call on every mount: null when idle.
  function consume() {
    if (typeof window === 'undefined') return null;
    const link = parse(window.location.hash);
    if (!link) return null;
    try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (_) {}
    return link;
  }

  // What a link that was left out of says, or null.
  const ignoredNote = (ignored) => (ignored && ignored.length ? 'Left out of the link: ' + ignored.join(', ') + '.' : null);

  window.ScreenerDeepLink = { splitHash, parse, consume, FILTER_KEYS, EXCHANGES, NOT_COVERED, notCovered, notCoveredNote, SECTORS, ignoredNote, own };
})();
