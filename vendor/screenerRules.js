// Screener rules -- pure, no React, loaded before screener.js and heatmap.js.
//
// Two things that sit around the EODHD screener endpoint and were wrong there:
// what the "US" universe is, and which rows an index heatmap is drawn from.
// Kept out of the JSX views so the tests can load them.

// Rules the screener applies around the EODHD screener endpoint. Pure, so they
// are tested on their own.
window.ScreenerRules = (function () {
  // "US (NYSE, NASDAQ)" has to mean NYSE and NASDAQ. The endpoint's
  // exchange=us is the whole US bucket, OTC included, and every row comes back
  // labelled exchange "US", so nothing downstream can tell the lines apart:
  // measured 2026-09-30 with mcap > $5B, 216 of the top 500 "us" rows were
  // 5-letter OTC foreign lines (TKOMY, ASMLF, RHHBF/RHHVF/RHHBY for Roche three
  // times). Asked per venue, NYSE and NASDAQ are separate screens, and the same
  // query returns 11 such tickers in ~1,500 instead.
  // Own keys only: "__proto__" or "constructor" read the prototype.
  const ownValue = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null);
  const venuesFor = (exchange) => (String(exchange || '').toLowerCase() === 'us' ? ['NYSE', 'NASDAQ'] : [exchange]);

  // A filter value as typed (or as a model wrote it), as a number; NaN when
  // it can't be read. "1,5" is 1.5, not 15.
  // window.NumberInput does the reading where the page has it; without it
  // the same rules in short, so a page that vendors only this file reads a
  // comma the same way.
  const readNumber = (v, { thousandsWhenAmbiguous = false } = {}) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    const raw = String(v == null ? '' : v);
    if (typeof window !== 'undefined' && window.NumberInput) {
      const c = window.NumberInput.check(raw);
      if (c.error === window.NumberInput.AMBIGUOUS && thousandsWhenAmbiguous) return Number(raw.replace(/[\s,_]/g, ''));
      return c.value;
    }
    const s = raw.trim().replace(/[\s_]/g, '');
    if (!s) return NaN;
    if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
      // 1,234 / 1,234,567.5: grouping, unless a single group is ambiguous.
      if ((s.match(/,/g) || []).length === 1 && !s.includes('.') && !thousandsWhenAmbiguous) return NaN;
      return Number(s.replace(/,/g, ''));
    }
    if (/^[-+]?\d*,\d+$/.test(s)) return Number(s.replace(',', '.'));
    return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
  };

  // Mover screens (daily-change filters) get liquidity floors. Without them
  // "Top Losers" / "Oversold" led with dead shells: of 500 rows 446 were under
  // $50M market cap and 59 were exactly -100% (GRNH, RGIN, MDMN...). A preset
  // that already asks for more keeps its own number.
  const MOVER_FLOORS = { minMarketCap: 300000000, minVolume: 100000 };
  const withMoverFloors = (f) => {
    const out = { ...f };
    if (!(parseFloat(out.minMarketCap) >= MOVER_FLOORS.minMarketCap)) out.minMarketCap = String(MOVER_FLOORS.minMarketCap);
    if (!(parseFloat(out.minVolume) >= MOVER_FLOORS.minVolume)) out.minVolume = String(MOVER_FLOORS.minVolume);
    return out;
  };

  // The numeric filters, re-checked on every row before it is drawn. The
  // upstream does not always honour them: the top row of a `refund_1d_p < -3`
  // screen was TTDKF at +2.11%. Same comparisons as the request (strict), same
  // units (dividend yield is a fraction upstream, a percent in the form).
  const NUMERIC = [
    ['minMarketCap', 'market_capitalization', '>', 1],
    ['maxMarketCap', 'market_capitalization', '<', 1],
    ['minDividendYield', 'dividend_yield', '>', 0.01],
    ['maxDividendYield', 'dividend_yield', '<', 0.01],
    ['minEPS', 'earnings_share', '>', 1],
    ['minPrice', 'adjusted_close', '>', 1],
    ['maxPrice', 'adjusted_close', '<', 1],
    ['minVolume', 'avgvol_1d', '>', 1],
    ['minChangeP', 'refund_1d_p', '>', 1],
    ['maxChangeP', 'refund_1d_p', '<', 1],
  ];
  const passes = (row, f) => {
    if (!row || !f) return false;
    for (const [key, field, op, scale] of NUMERIC) {
      if (f[key] === '' || f[key] == null) continue;
      const limit = readNumber(f[key]) * scale;
      if (!Number.isFinite(limit)) continue;
      // Market cap bounds are dollars; a converted row is compared in dollars.
      let v = field === 'market_capitalization' ? capUsd(row)
        : (typeof row[field] === 'number' ? row[field] : parseFloat(row[field]));
      if (!Number.isFinite(v)) return false;
      // Price bounds are in the major unit: a pence line's 550.7 is 5.507.
      if (field === 'adjusted_close') v = v / currencyOf(row).divisor;
      if (op === '>' ? !(v > limit) : !(v < limit)) return false;
    }
    if (f.sector && row.sector && row.sector !== f.sector) return false;
    return true;
  };

  // Rows from two venue screens, merged: one row per code, re-sorted by the
  // requested field (each venue was sorted on its own).
  const mergeSorted = (pages, sortBy, sortOrder) => {
    const seen = new Set();
    const rows = [];
    pages.forEach(p => (p || []).forEach(r => {
      const k = r && (r.code + '|' + (r.exchange || ''));
      if (!r || seen.has(k)) return;
      seen.add(k);
      rows.push(r);
    }));
    const dir = sortOrder === 'asc' ? 1 : -1;
    const val = (r) => { const v = parseFloat(r[sortBy]); return Number.isFinite(v) ? v : null; };
    return rows.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * dir;
    });
  };

  const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

  // Listing currency of a row. The screener quotes the price in the listing's
  // unit -- pence for most LSE lines (currency_symbol 'p') -- while EPS and
  // market cap are in the major unit: BP read "$550.70" and "P/E 2118"
  // (550.7p over a GBP 0.26 EPS), HSBA 1424, SHEL 1051, and any Max P/E filter on LSE dropped them. Market cap is
  // in the listing currency too (MOL.LSE: 2.18 trillion forint), so "$" was
  // wrong for every non-US row.
  const MINOR_UNITS = {
    p: { major: '£', suffix: 'p' }, GBp: { major: '£', suffix: 'p' }, GBX: { major: '£', suffix: 'p' },
    ZAc: { major: 'R', suffix: 'c' }, ZAC: { major: 'R', suffix: 'c' },
    ILA: { major: '₪', suffix: ' ag.' },
  };
  const currencyOf = (row) => {
    const sym = row && typeof row.currency_symbol === 'string' ? row.currency_symbol.trim() : '';
    const minor = MINOR_UNITS[sym];
    if (minor) return { major: minor.major, minorSuffix: minor.suffix, divisor: 100 };
    return { major: sym || '$', minorSuffix: null, divisor: 1 };
  };
  // The ISO code behind a row's currency symbol, for converting its market
  // cap. The feed sends only the symbol. "kr" is SEK, NOK, DKK or ISK, and
  // only the row's own exchange can say which (ST -> SEK, OL -> NOK,
  // CO -> DKK, IC -> ISK). On any other venue -- Equinor's 0M2Z on the LSE
  // screen quotes "kr" -- it stays unknown: no dollar figure, ranked after
  // the converted rows and left out of dollar cap bounds, never guessed
  // (it was read as SEK, which puts a Danish line out by half).
  const KRONA_BY_EXCHANGE = { ST: 'SEK', STO: 'SEK', XSTO: 'SEK', OL: 'NOK', OSL: 'NOK', XOSL: 'NOK', CO: 'DKK', CPH: 'DKK', XCSE: 'DKK', IC: 'ISK', XICE: 'ISK' };
  const ISO_BY_SYMBOL = {
    '$': 'USD', 'US$': 'USD', USD: 'USD', '£': 'GBP', p: 'GBP', GBp: 'GBP', GBX: 'GBP', GBP: 'GBP',
    '€': 'EUR', EUR: 'EUR', 'C$': 'CAD', 'CA$': 'CAD', CAD: 'CAD', 'A$': 'AUD', 'AU$': 'AUD', AUD: 'AUD',
    'HK$': 'HKD', HKD: 'HKD', '¥': 'JPY', JPY: 'JPY', CHF: 'CHF', Fr: 'CHF', 'Fr.': 'CHF',
    SEK: 'SEK', ISK: 'ISK', NOK: 'NOK', DKK: 'DKK', Ft: 'HUF', HUF: 'HUF', INR: 'INR', '₹': 'INR', Rs: 'INR',
    R: 'ZAR', ZAc: 'ZAR', ZAC: 'ZAR', ZAR: 'ZAR', '₩': 'KRW', KRW: 'KRW', 'zł': 'PLN', PLN: 'PLN',
    'Kč': 'CZK', CZK: 'CZK', '₪': 'ILS', ILA: 'ILS', ILS: 'ILS', 'NZ$': 'NZD', NZD: 'NZD', 'S$': 'SGD', SGD: 'SGD',
    'R$': 'BRL', BRL: 'BRL', 'MX$': 'MXN', MXN: 'MXN', '₺': 'TRY', TRY: 'TRY', CNY: 'CNY', '元': 'CNY',
  };
  const isoOf = (row) => {
    const sym = row && typeof row.currency_symbol === 'string' ? row.currency_symbol.trim() : '';
    if (!sym) return null;
    if (sym.toLowerCase() === 'kr' || sym.toLowerCase() === 'kr.') {
      return ownValue(KRONA_BY_EXCHANGE, String((row && row.exchange) || '').trim().toUpperCase());
    }
    if (ISO_BY_SYMBOL[sym]) return ISO_BY_SYMBOL[sym];
    return /^[A-Z]{3}$/.test(sym) ? sym : null;
  };
  // Market cap in dollars: `_capUsd` once the screen has its FX rates (see
  // screener.js, attachUsdCaps); the raw figure on a dollar screen. A row of
  // a foreign screen whose currency could not be converted has none, and is
  // neither ranked nor filtered as if its forint were dollars: "Market Cap ↓"
  // on LSE opened with OTP Bank at "Ft 5.0T" (about $14B) above Samsung, and
  // Volvo's kr 422.6B above HSBC's £246.5B.
  const capUsd = (row) => {
    if (row && Object.prototype.hasOwnProperty.call(row, '_capUsd')) return num(row._capUsd);
    return num(row && row.market_capitalization);
  };
  // rates: ISO -> USD per unit. Rows get `_capUsd` (null where unknown).
  const attachUsdCaps = (rows, rates) => (rows || []).map((r) => {
    const cap = num(r && r.market_capitalization);
    const iso = isoOf(r);
    const rate = iso === 'USD' ? 1 : (iso && rates ? num(rates[iso]) : null);
    return { ...r, _capUsd: cap != null && rate != null && rate > 0 ? cap * rate : null };
  });
  // "Ft 5.0T (≈ $14.2B)": the listing's own figure, and dollars beside it
  // when they differ.
  const formatCapWithUsd = (row) => {
    const local = formatMajor(row, row && row.market_capitalization, true);
    const usd = row && row._capUsd != null ? num(row._capUsd) : null;
    if (usd == null || isoOf(row) === 'USD' || local === 'N/A') return local;
    return `${local} (≈ ${formatMajor({ currency_symbol: '$' }, usd, true)})`;
  };

  // The minus goes before the symbol: "-$1.28", not "$-1.28".
  const withSymbol = (sym, text) => {
    const t = String(text);
    const neg = t.charAt(0) === '-';
    const body = neg ? t.slice(1) : t;
    return (neg ? '-' : '') + (sym.length > 1 && /^[A-Za-z]/.test(sym) ? `${sym} ${body}` : `${sym}${body}`);
  };
  // "550.70p", "€78.25", "$331.65".
  const formatPrice = (row, value) => {
    const n = num(value);
    if (n == null) return null;
    const c = currencyOf(row);
    return c.minorSuffix ? `${n.toFixed(2)}${c.minorSuffix}` : withSymbol(c.major, n.toFixed(2));
  };
  // Market cap / EPS: major unit of the listing currency.
  const formatMajor = (row, value, compact) => {
    const n = num(value);
    // A market cap of 0 is a missing one.
    if (n == null || (compact && n === 0)) return 'N/A';
    const sym = currencyOf(row).major;
    if (!compact) return withSymbol(sym, n.toFixed(2));
    const a = Math.abs(n);
    const body = a >= 1e12 ? `${(n / 1e12).toFixed(1)}T` : a >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toLocaleString();
    return withSymbol(sym, body);
  };
  // Min/Max Price go to the upstream only where every line quotes in dollars
  // (the US venues). On LSE the upstream compares the bound with a pence
  // price -- Max 50 meant "under 50p" and Min 10 let every 11p penny stock in
  // -- so there the bound is applied here, per row, in the
  // major unit (passes), and the form says "listing currency", not "$".
  const US_EXCHANGES = ['us', 'nyse', 'nasdaq'];
  const priceBoundsUpstream = (exchange) => US_EXCHANGES.indexOf(String(exchange || '').toLowerCase()) !== -1;
  const priceUnitLabel = (exchange) => (priceBoundsUpstream(exchange) ? '$' : 'listing currency');

  // P/E with the price brought to the EPS unit. null when not meaningful.
  const peOf = (row) => {
    const p = num(row && row.adjusted_close), e = num(row && row.earnings_share);
    if (!(p > 0) || !(e > 0)) return null;
    return (p / currencyOf(row).divisor) / e;
  };

  // Lines the NYSE/NASDAQ screens still let through that are not common
  // stock on those venues: OTC foreign lines (5 letters ending F/Y -- GRTUF,
  // CSANY, HMKIY in Mid-Cap Value / Oversold) and preferred series (JPM-PC,
  // with the parent's market cap and a 26% "yield"). The feed has no type
  // field; the ticker shape is what identifies them.
  const isNotCommonStock = (row) => {
    const code = String((row && row.code) || '');
    return /^[A-Z]{4}[FY]$/.test(code) || /-P[A-Z]?$/.test(code);
  };

  // Client-side sort with missing values always last, whichever direction:
  // "Market Cap ↑" opened with "Cap: N/A" rows (?? -Infinity).
  const SORT_KEYS = {
    code: r => r.code || null,
    name: r => r.name || null,
    sector: r => r.sector || null,
    adjusted_close: r => { const p = num(r.adjusted_close); return p == null ? null : p / currencyOf(r).divisor; },
    refund_1d_p: r => num(r.refund_1d_p),
    avgvol_1d: r => num(r.avgvol_1d),
    dividend_yield: r => num(r.dividend_yield),
    earnings_share: r => num(r.earnings_share),
    pe: r => peOf(r),
    market_capitalization: r => capUsd(r),
  };
  const sortRows = (rows, by, order) => {
    const key = SORT_KEYS[by] || SORT_KEYS.market_capitalization;
    const dir = order === 'asc' ? 1 : -1;
    return [...(rows || [])].sort((a, b) => {
      const ka = key(a), kb = key(b);
      if (ka == null && kb == null) return 0;
      if (ka == null) return 1;
      if (kb == null) return -1;
      if (typeof ka === 'string' || typeof kb === 'string') return String(ka).localeCompare(String(kb)) * dir;
      return (ka - kb) * dir;
    });
  };

  // Two venue screens where one or both hit the provider's 1,000-row cap.
  // Past the capped venue's last row the merged list holds only the other
  // venue's names, so the tail and the count are not the ranking ("1307
  // stocks found" under "capped at 1,000"). Keep rows up to the tightest
  // capped venue's last value; report which venues were cut.
  const cutAtCaps = (merged, pages, capped, venues, sortBy, sortOrder) => {
    const cutVenues = (venues || []).filter((v, i) => capped[i]);
    if (!cutVenues.length) return { rows: merged, cutVenues: [] };
    const val = (r) => num(r && r[sortBy]);
    const desc = sortOrder !== 'asc';
    let bound = null;
    (pages || []).forEach((p, i) => {
      if (!capped[i] || !p || !p.length) return;
      // The last row with a value on that venue's page.
      let last = null;
      for (let j = p.length - 1; j >= 0 && last == null; j--) last = val(p[j]);
      if (last == null) return;
      if (bound == null) bound = last;
      else bound = desc ? Math.max(bound, last) : Math.min(bound, last);
    });
    if (bound == null || (venues || []).length < 2) return { rows: merged, cutVenues };
    const rows = merged.filter(r => { const v = val(r); return v != null && (desc ? v >= bound : v <= bound); });
    return { rows, cutVenues };
  };

  // The filters a model proposed, checked against what the form can express
  // before anything is sent. They went to the screener as given:
  // sortBy "evil_field", sortOrder "sideways", minMarketCap "abc" came back as
  // a raw 422 on screen. Numbers must be numbers, the
  // sector, exchange and sort one of the form's own; anything else is
  // dropped and named, so the screen runs on what was understood.
  const AI_NUMERIC = ['minMarketCap', 'maxMarketCap', 'minPE', 'maxPE', 'minDividendYield', 'maxDividendYield',
    'minEPS', 'minPrice', 'maxPrice', 'minVolume', 'minChangeP', 'maxChangeP'];
  const AI_SECTORS = ['Technology', 'Healthcare', 'Financial Services', 'Consumer Cyclical', 'Communication Services',
    'Industrials', 'Consumer Defensive', 'Energy', 'Utilities', 'Real Estate', 'Basic Materials'];
  // What models call those sectors (GICS names, short forms). "tech" was
  // dropped outright.
  const AI_SECTOR_ALIASES = {
    tech: 'Technology', 'information technology': 'Technology', it: 'Technology', software: 'Technology', semiconductors: 'Technology',
    health: 'Healthcare', 'health care': 'Healthcare', pharma: 'Healthcare', biotech: 'Healthcare',
    financials: 'Financial Services', financial: 'Financial Services', finance: 'Financial Services', banks: 'Financial Services', banking: 'Financial Services',
    'consumer discretionary': 'Consumer Cyclical', discretionary: 'Consumer Cyclical', retail: 'Consumer Cyclical',
    communication: 'Communication Services', communications: 'Communication Services', telecom: 'Communication Services', media: 'Communication Services',
    industrial: 'Industrials', 'consumer staples': 'Consumer Defensive', staples: 'Consumer Defensive',
    oil: 'Energy', 'oil & gas': 'Energy', utility: 'Utilities', reit: 'Real Estate', reits: 'Real Estate', realestate: 'Real Estate',
    materials: 'Basic Materials', mining: 'Basic Materials', chemicals: 'Basic Materials',
  };
  // The form's exchange values, and the names a model tends to use for them.
  // NYSE and NASDAQ are the form's "US (NYSE, NASDAQ)"; "NYSE" was dropped
  // outright.
  const AI_EXCHANGES = { us: 'us', usa: 'us', nyse: 'us', nasdaq: 'us', 'nyse arca': 'us', amex: 'us', 'united states': 'us',
    lse: 'lse', london: 'lse', to: 'TO', tsx: 'TO', toronto: 'TO', xetra: 'xetra', pa: 'pa', paris: 'pa',
    euronext: 'pa', as: 'as', amsterdam: 'as', au: 'au', asx: 'au', mc: 'mc', sw: 'sw', six: 'sw', nse: 'nse' };
  // Hong Kong, Milan and Johannesburg are left out: the screener answers no
  // stocks for them, so a model's "hk" is dropped and
  // named like any exchange the form does not have.
  const AI_SORTS = ['market_capitalization', 'refund_1d_p', 'earnings_share', 'dividend_yield', 'avgvol_1d', 'adjusted_close'];
  const validateAiFilters = (raw) => {
    const filters = {};
    const dropped = [];
    const src = raw && typeof raw === 'object' ? raw : {};
    Object.keys(src).forEach((k) => {
      const v = src[k];
      if (v === '' || v == null) return;
      if (AI_NUMERIC.indexOf(k) !== -1) {
        // A model writes "1,000,000" for a million and sometimes "1,5" for
        // one and a half; stripping every comma made that 15.
        const n = readNumber(v, { thousandsWhenAmbiguous: true });
        if (Number.isFinite(n)) filters[k] = String(n); else dropped.push(k);
      } else if (k === 'sector') {
        const key = String(v).trim().toLowerCase();
        const hit = AI_SECTORS.find(s => s.toLowerCase() === key) || ownValue(AI_SECTOR_ALIASES, key);
        if (hit) filters.sector = hit; else dropped.push(k);
      } else if (k === 'exchange') {
        const hit = ownValue(AI_EXCHANGES, String(v).trim().toLowerCase());
        if (hit) filters.exchange = hit; else dropped.push(k);
      } else if (k === 'sortBy') {
        if (AI_SORTS.indexOf(String(v)) !== -1) filters.sortBy = String(v); else dropped.push(k);
      } else if (k === 'sortOrder') {
        const o = String(v).toLowerCase();
        if (o === 'asc' || o === 'desc') filters.sortOrder = o; else dropped.push(k);
      } else {
        dropped.push(k);
      }
    });
    return { filters, dropped };
  };

  return {
    venuesFor, withMoverFloors, passes, mergeSorted, MOVER_FLOORS,
    currencyOf, formatPrice, formatMajor, peOf, isNotCommonStock, sortRows, cutAtCaps,
    priceBoundsUpstream, priceUnitLabel,
    isoOf, capUsd, attachUsdCaps, formatCapWithUsd, validateAiFilters, readNumber,
  };
})();

// The rows an index map is drawn from: its MEMBERS, not the screener.
//
// The S&P 500 tab used to intersect the index's 503 members with the top-500
// "US" screener rows (mcap > $5B) -- and 216 of those 500 were OTC foreign
// lines (TKOMY, ASMLF, three Roche tickers), so the 500th row was already a
// $66.6B name and only 187 of 503 members got a tile. AIZ, AFL, GWW, FAST,
// CBOE... were simply missing, and breadth and sector colours described the
// mega-cap third of the index.
//
// Now every member gets a row. Name and sector come from the index's own
// constituent list (fundamentals/<INDEX>.INDX -> Components); the screener row,
// when there is one, adds the real market cap and the day's change; otherwise
// the size is the member's index weight times the index market cap, and the
// price comes from the batch quotes that already feed the live overlay (50
// symbols a call), which now ask for the members rather than for the screener.
window.HeatmapMembers = {
  rowsFor(codes, info, screenerRows) {
    if (!Array.isArray(codes) || !codes.length) return null;
    const byCode = {};
    (screenerRows || []).forEach(r => { if (r && r.code) byCode[r.code] = r; });
    const meta = (info && info.byCode) || {};
    const indexMcap = Number(info && info.indexMcap) || 0;
    return codes.map(code => {
      const m = meta[code] || {};
      const row = byCode[code];
      if (row) return { ...row, name: row.name || m.name, sector: row.sector || m.sector };
      const w = Number(m.weight);
      return {
        code,
        name: m.name || code,
        sector: m.sector || 'Other',
        market_capitalization: indexMcap > 0 && w > 0 ? w * indexMcap : 0,
        // No screener row: the change arrives with the quote overlay. Until then
        // the tile is neutral and counted as "without a quote".
        refund_1d_p: null,
        _fromIndex: true,
      };
    });
  },
};
