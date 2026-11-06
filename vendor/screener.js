// Stock Screener Component - Enhanced with Presets, Advanced Filters, Multiple Exchanges

// The rules around the EODHD screener endpoint (US = NYSE + NASDAQ, mover
// floors, the client re-check) live in screenerRules.js -- pure, and tested.
// The longest saved screen name.
window.SCREEN_NAME_MAX = 60;

window.ScreenerView = ({ apiKey, onSelectAsset, onUpgradeClick, onBack, theme, activeTab, onTabChange, onSettingsClick, embedded }) => {
  // Restore last search from sessionStorage so navigating back from asset detail keeps the results
  const SESSION_KEY = 'eodhd_screener_session';
  const restored = (() => {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  })();

  // "Ask AI" turns the words into filters with the model: charged as
  // screener_ai on /api/ai/chat (aiService.js parseScreenerQuery), and
  // the button said nothing of it.
  const useFeatureCost = (() => null);
  const askCost = useFeatureCost('screener_ai');
  const [results, setResults] = React.useState(restored?.results ?? null);
  // Venues that hit the provider's 1,000-row cap on the last search (notice).
  const [capInfo, setCapInfo] = React.useState(restored?.capInfo ?? null);
  const [loading, setLoading] = React.useState(false);
  // A Quick Screen or a saved screen picked from the list: once its results
  // are in, the page goes to them. They render under every screen, and on a
  // phone only the count on Filter changed.
  const goToResultsRef = React.useRef(false);
  const resultsHeadRef = React.useRef(null);
  React.useEffect(() => {
    if (loading || !goToResultsRef.current) return;
    goToResultsRef.current = false;
    const el = resultsHeadRef.current;
    if (!el) return;
    try { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) { el.scrollIntoView(); }
    try { el.focus({ preventScroll: true }); } catch (_) {}
  }, [loading, results]);
  // After "Try again" the button leaves while the view loads, and focus fell
  // to <body>. When loading ends it goes back to a Try again that is there
  // again (still refused), else to the view's heading.
  const retryFocusRef = React.useRef(false);
  const retryHeadingRef = React.useRef(null);
  React.useEffect(() => {
    if (loading || !retryFocusRef.current) return;
    retryFocusRef.current = false;
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a !== document.body && document.contains(a)) return;
      const back = document.querySelector('[data-retry-focus]');
      const target = back || retryHeadingRef.current;
      if (target) target.focus();
    }, 0);
  }, [loading]);
  const [loadProgress, setLoadProgress] = React.useState(null); // {loaded, target}
  const [error, setError] = React.useState(null);
  // What a link named that the screener cannot use.
  const [linkNote, setLinkNote] = React.useState(null);
  const [showFilters, setShowFilters] = React.useState(false);
  const [savedScreens, setSavedScreens] = React.useState([]);
  // "Replace the saved filter?" is asked in the page, not with confirm().
  const [askInPage, askElement] = (window.PTDialog && window.PTDialog.useAsk) ? window.PTDialog.useAsk() : [async () => true, null];
  const [showSaveModal, setShowSaveModal] = React.useState(false);
  const [saveScreenName, setSaveScreenName] = React.useState('');
  const [activePreset, setActivePreset] = React.useState(restored?.activePreset ?? null);
  const [aiQuery, setAiQuery] = React.useState('');
  const [aiLoading, setAiLoading] = React.useState(false);
  const [aiDescription, setAiDescription] = React.useState(restored?.aiDescription ?? null);
  const [aiError, setAiError] = React.useState(null);
  // Client-side sort (independent of filter sort, applied after fetch)
  const [clientSort, setClientSort] = React.useState(restored?.clientSort || { by: 'market_capitalization', order: 'desc' });
  // Client-side pagination
  const PAGE_SIZE = 50;
  const [currentPage, setCurrentPage] = React.useState(restored?.currentPage || 1);
  const [showGuide, setShowGuide] = React.useState(false);
  // Escape closes the guide, like the other windows.
  // The Guide and Save Screen are dialogs (window.PTDialog.Modal): Escape,
  // focus kept inside, focus back to the button that opened them.
  const focusNext = (window.useFocusWhenReady || (() => (f) => setTimeout(() => { const el = f(); if (el) el.focus(); }, 0)))();

  const defaultFilters = {
    exchange: 'us',
    // Previously had '10000000000' (US$10B). That got spread into every preset
    // via `...defaultFilters`, silently filtering 'High Volume', 'Momentum', 'Oversold',
    // etc. down to ~14 mega-caps. No preset actually asked for a 10B floor.
    minMarketCap: '',
    maxMarketCap: '',
    minPE: '',
    maxPE: '',
    sector: '',
    minDividendYield: '',
    maxDividendYield: '',
    minEPS: '',
    minPrice: '',
    maxPrice: '',
    minVolume: '',
    minChangeP: '',
    maxChangeP: '',
    sortBy: 'market_capitalization',
    sortOrder: 'desc'
  };

  const [filters, setFilters] = React.useState(restored?.filters || defaultFilters);

  // Persist screener state between navigations (asset detail and back)
  React.useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        filters, results, activePreset, aiDescription, clientSort, currentPage, capInfo,
      }));
    } catch {}
  }, [filters, results, activePreset, aiDescription, clientSort, capInfo]);

  const C3 = window.C3;
  const isDark = theme === 'dark';
  const isDemo = window.APP_PLATFORM === 'WEB' ? false : window.EODHD_API.isDemo(apiKey);

  // Deep link: #/screener?exchange=NYSE&minMarketCap=…  (see screenerDeepLink.js).
  // Consumed once on mount — the parser strips the query from the URL — so Back,
  // a re-render or a saved session cannot run the search a second time. A preset
  // id applies that preset; otherwise the filters are merged over the defaults and
  // run unless the link says run=0.
  React.useEffect(() => {
    const link = window.ScreenerDeepLink && window.ScreenerDeepLink.consume();
    if (!link) return;
    if (window.MIAnalytics) window.MIAnalytics.track('dl_mi_feature_view', { feature_name: 'screener', source: 'deep_link' });
    // What the link named that cannot be used is said, not dropped in
    // silence.
    const ignored = (link.ignored || []).slice();
    if (link.preset) {
      const preset = presetScreens.find(p => p.id === String(link.preset).toLowerCase());
      if (!preset) ignored.push('preset "' + link.preset + '" (no Quick Screen has that id)');
      setLinkNote(window.ScreenerDeepLink.ignoredNote(ignored));
      if (preset) { applyPreset(preset); return; }
    }
    setLinkNote(window.ScreenerDeepLink.ignoredNote(ignored));
    // Nothing usable left (an unknown preset, values it cannot read): the
    // note says so, and no default screen is run in their place.
    if (!Object.keys(link.filters || {}).length) return;
    // An exchange the screener has nothing for: the rest of the link fills
    // the form, the exchange is left to the reader, nothing is run.
    if (link.notCovered) { setFilters({ ...defaultFilters, ...link.filters }); setShowFilters(true); return; }
    const next = { ...defaultFilters, ...link.filters };
    setFilters(next);
    setActivePreset(null);
    setAiDescription(null); setAiError(null); setAiQuery('');
    setShowFilters(!link.run);
    if (link.run) loadScreenerData(next);
  }, []);

  // Saved screens, through window.SavedStore: blocked or
  // full storage no longer throws, and a save made in another tab arrives
  // here. A save or a delete reads the stored
  // list first and changes only its own entry: two tabs saving TabA and
  // TabB kept TabB alone.
  const SAVED_KEY = 'eodhd_saved_screens';
  const readSavedScreens = () => {
    const v = window.SavedStore ? window.SavedStore.read(SAVED_KEY, null) : null;
    return Array.isArray(v) ? v.filter(sc => sc && typeof sc === 'object') : null;
  };
  // What a save that did not keep says, above the saved chips.
  const [saveNote, setSaveNote] = React.useState(null);
  // A change starts from the stored list unless this tab's last write did
  // not keep: then the stored one is older than what is on screen.
  const storeKeptRef = React.useRef(true);
  const baseScreens = () => (storeKeptRef.current ? readSavedScreens() : null) || savedScreens;
  const keepSavedScreens = (updated) => {
    setSavedScreens(updated);
    const w = window.SavedStore ? window.SavedStore.write(SAVED_KEY, updated) : { ok: true };
    storeKeptRef.current = w.ok;
    setSaveNote(w.ok ? null : 'Kept for this visit only. ' + window.SavedStore.failNote(w.reason));
    window.DataSync?.pushSection('preferences', { saved_screens: updated });
  };
  React.useEffect(() => {
    const saved = readSavedScreens();
    if (saved) setSavedScreens(saved);
    if (!window.SavedStore) return undefined;
    return window.SavedStore.watch(SAVED_KEY, (v) => setSavedScreens(Array.isArray(v) ? v.filter(sc => sc && typeof sc === 'object') : []));
  }, []);

  const Icon = ({ name, size = 24, color = 'currentColor' }) => {
    return React.createElement('svg', { 'aria-hidden': true, focusable: 'false',
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: color,
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }, React.createElement('path', { d: window.IconPaths[name] || "" }));
  };

  // Preset screens (grouped into categories in the UI). Each name says what
  // its filters do: "Small Cap" was cap $1-10B (mid caps), "Growth Leaders"
  // mega caps up today, "Momentum" a day's gain over 3%, "Tax Loss Harvest"
  // a day's fall over 2%, "Value Stocks" had no valuation filter at all.
  // Ids are unchanged: links and saved state keep working.
  // Mega cap is $200B and up -- one line for every preset named for it.
  // "Mega Caps Up Today" had moved to $200B while "Mega Caps, Div > 1%" and
  // "Mega-Cap Dividend Payers" stayed at $100B.
  const MEGA_CAP = '200000000000';
  // The market-cap fields' options with the value in force among them.
  const capOptions = (opts, value, plus) => {
    const v = Number(value);
    if (!value || !Number.isFinite(v) || v <= 0 || opts.some(o => String(o.value) === String(value))) return opts;
    const label = '$' + (v >= 1e9 ? (v / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'B' : (v / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'M') + plus;
    return opts.concat([{ value: String(value), label }]).sort((a, b) => (Number(a.value) || 0) - (Number(b.value) || 0));
  };
  const presetScreens = [
    // ---------- Value ----------
    {
      id: 'value',
      name: 'Dividend Earners',
      icon: 'trendUp',
      category: 'Value',
      description: 'EPS > $5, dividend yield > 2%',
      filters: { ...defaultFilters, minEPS: '5', minDividendYield: '2' }
    },
    {
      id: 'techvalue',
      name: 'Tech Value',
      icon: 'zap',
      category: 'Value',
      // P/E from 1: a price / EPS under 1 is a broken EPS in the source (GMEX
      // "EPS $2799.92, Div 57243.82%" read P/E 0.0), and sorting by EPS put
      // those on top.
      description: 'Technology, P/E 1-15, EPS > $3',
      filters: { ...defaultFilters, sector: 'Technology', minPE: '1', maxPE: '15', minEPS: '3', sortBy: 'earnings_share', sortOrder: 'desc' }
    },
    {
      id: 'midcapvalue',
      name: 'Mid-Cap Value',
      icon: 'target',
      category: 'Value',
      description: 'Cap $2-10B, P/E < 18, Div > 1%',
      filters: { ...defaultFilters, minMarketCap: '2000000000', maxMarketCap: '10000000000', maxPE: '18', minEPS: '2', minDividendYield: '1' }
    },

    // ---------- Growth ----------
    {
      id: 'growth',
      name: 'Mega Caps Up Today',
      icon: 'rocket',
      category: 'Growth',
      // Mega cap is $200B and up (the usual line); $50B let in NDAQ and TRI
      // at $53-58B.
      description: 'Cap > $200B, up today',
      filters: window.ScreenerRules.withMoverFloors({ ...defaultFilters, minMarketCap: MEGA_CAP, minChangeP: '0', sortBy: 'refund_1d_p', sortOrder: 'desc' })
    },
    {
      id: 'smallcap',
      name: 'Mid Caps $1-10B',
      icon: 'star',
      category: 'Growth',
      description: 'Cap $1-10B, EPS > $2',
      filters: { ...defaultFilters, minMarketCap: '1000000000', maxMarketCap: '10000000000', minEPS: '2' }
    },
    {
      id: 'compounders',
      name: 'High EPS, Low Dividend',
      icon: 'refresh',
      category: 'Growth',
      description: 'EPS > $5, P/E < 20, Div < 1.5%, cap > $5B',
      filters: { ...defaultFilters, minEPS: '5', minMarketCap: '5000000000', maxPE: '20', maxDividendYield: '1.5', sortBy: 'earnings_share', sortOrder: 'desc' }
    },

    // ---------- Income ----------
    {
      id: 'dividend',
      name: 'High Yield > 3%',
      icon: 'dollarSign',
      category: 'Income',
      description: 'Dividend yield > 3%',
      filters: { ...defaultFilters, minDividendYield: '3' }
    },
    {
      id: 'intldiv',
      name: 'London High Yield',
      icon: 'globe',
      category: 'Income',
      // Capped at 25%: the top rows were 79%, 68% and 44% (0S2J, 0ICU, a
      // one-off payout over a fallen price), not a yield anyone can earn.
      // The cap is a visible filter, not a hidden cut.
      description: 'LSE, yield 4-25%, cap > $1B',
      filters: { ...defaultFilters, exchange: 'lse', minDividendYield: '4', maxDividendYield: '25', minMarketCap: '1000000000', sortBy: 'dividend_yield', sortOrder: 'desc' }
    },

    // ---------- Momentum ----------
    {
      id: 'momentum',
      name: 'Day Gainers > 3%',
      icon: 'barChart',
      category: 'Momentum',
      description: 'Up > 3% today',
      filters: window.ScreenerRules.withMoverFloors({ ...defaultFilters, minChangeP: '3', sortBy: 'refund_1d_p', sortOrder: 'desc' })
    },
    {
      id: 'highvol',
      name: 'High-Volume Gainers',
      icon: 'zap',
      category: 'Momentum',
      description: 'Volume > 10M, up > 2% today',
      filters: window.ScreenerRules.withMoverFloors({ ...defaultFilters, minVolume: '10000000', minChangeP: '2', sortBy: 'refund_1d_p', sortOrder: 'desc' })
    },
    {
      id: 'midcapmomentum',
      name: 'Mid-Cap Gainers > 3%',
      icon: 'activity',
      category: 'Momentum',
      description: 'Cap $2-10B, up > 3% today, volume > 1M',
      filters: window.ScreenerRules.withMoverFloors({ ...defaultFilters, minMarketCap: '2000000000', maxMarketCap: '10000000000', minChangeP: '3', minVolume: '1000000', sortBy: 'refund_1d_p', sortOrder: 'desc' })
    },

    // ---------- Defensive ----------
    {
      id: 'largecap',
      name: 'Mega Caps, Div > 1%',
      icon: 'shield',
      category: 'Defensive',
      description: 'Cap > $200B, dividend yield > 1%',
      filters: { ...defaultFilters, minMarketCap: MEGA_CAP, minDividendYield: '1' }
    },
    {
      id: 'bluechip',
      name: 'Mega-Cap Dividend Payers',
      icon: 'briefcase',
      category: 'Defensive',
      description: 'Cap > $200B, dividend yield > 0.5%',
      filters: { ...defaultFilters, minMarketCap: MEGA_CAP, minDividendYield: '0.5' }
    },
    {
      id: 'defensiveincome',
      name: 'Utility Income',
      icon: 'shield',
      category: 'Defensive',
      description: 'Utilities, cap > $10B, Div > 2%',
      filters: { ...defaultFilters, sector: 'Utilities', minMarketCap: '10000000000', minDividendYield: '2', sortBy: 'dividend_yield', sortOrder: 'desc' }
    },

    // ---------- Sector ----------
    {
      id: 'healthcare',
      name: 'Profitable Healthcare Mid Caps',
      icon: 'award',
      category: 'Sector',
      description: 'Healthcare, cap $3-15B, EPS > $3, P/E < 25',
      filters: { ...defaultFilters, sector: 'Healthcare', minMarketCap: '3000000000', maxMarketCap: '15000000000', minEPS: '3', maxPE: '25' }
    },
    {
      id: 'energydiv',
      name: 'Energy Yield > 3%',
      icon: 'dollarSign',
      category: 'Sector',
      description: 'Energy, Div > 3%, cap > $5B',
      filters: { ...defaultFilters, sector: 'Energy', minDividendYield: '3', minMarketCap: '5000000000', sortBy: 'dividend_yield', sortOrder: 'desc' }
    },

    // ---------- Tactical ----------
    {
      id: 'oversold',
      name: 'Day Losers > 3%',
      icon: 'trendDown',
      category: 'Tactical',
      description: 'Down > 3% today',
      filters: window.ScreenerRules.withMoverFloors({ ...defaultFilters, maxChangeP: '-3', sortBy: 'refund_1d_p', sortOrder: 'asc' })
    },
    {
      id: 'crashopp',
      name: 'Large Caps Down > 4%',
      icon: 'alertTriangle',
      category: 'Tactical',
      description: 'Cap > $50B, down > 4% today, EPS > $2',
      filters: window.ScreenerRules.withMoverFloors({ ...defaultFilters, minMarketCap: '50000000000', maxChangeP: '-4', minEPS: '2', sortBy: 'refund_1d_p', sortOrder: 'asc' })
    },
    {
      id: 'taxloss',
      name: 'Profitable Day Losers',
      icon: 'trendDown',
      category: 'Tactical',
      description: 'Down > 2% today, EPS > 0, cap > $2B',
      filters: window.ScreenerRules.withMoverFloors({ ...defaultFilters, maxChangeP: '-2', minEPS: '0.1', minMarketCap: '2000000000', sortBy: 'refund_1d_p', sortOrder: 'asc' })
    }
  ];

  const sectors = [
    '', 'Technology', 'Healthcare', 'Financial Services', 'Consumer Cyclical',
    'Communication Services', 'Industrials', 'Consumer Defensive', 'Energy',
    'Utilities', 'Real Estate', 'Basic Materials'
  ];

  const exchanges = [
    { value: 'us', label: '🇺🇸 US (NYSE, NASDAQ)' },
    { value: 'lse', label: '🇬🇧 London (LSE)' },
    { value: 'TO', label: '🇨🇦 Toronto (TSX)' },
    { value: 'xetra', label: '🇩🇪 Germany (XETRA)' },
    { value: 'pa', label: '🇫🇷 Paris (Euronext)' },
    { value: 'as', label: '🇳🇱 Amsterdam (AEX)' },
    { value: 'au', label: '🇦🇺 Australia (ASX)' },
    { value: 'mc', label: '🇪🇸 Madrid (BME)' },
    { value: 'sw', label: '🇨🇭 Switzerland (SIX)' },
    { value: 'nse', label: '🇮🇳 India (NSE)' },
    // Hong Kong, Milan and South Africa are not offered: the EODHD screener
    // answers no stocks for hk, mi or jse, so they read "No stocks match
    // your filters" whatever was asked.
  ];

  const sortOptions = [
    { value: 'market_capitalization', label: 'Market Cap' },
    { value: 'refund_1d_p', label: 'Daily Change %' },
    { value: 'earnings_share', label: 'EPS' },
    { value: 'dividend_yield', label: 'Dividend Yield' },
    { value: 'avgvol_1d', label: 'Volume' },
    { value: 'adjusted_close', label: 'Price' }
  ];

  const fnum = (v) => window.ScreenerRules.readNumber(v);
  // The first typed filter that can't be read, said under the form.
  const TYPED_FILTERS = [['minPrice', 'Min price'], ['maxPrice', 'Max price'], ['minPE', 'Min P/E'], ['maxPE', 'Max P/E'],
    ['minDividendYield', 'Min div yield'], ['maxDividendYield', 'Max div yield'], ['minEPS', 'Min EPS'],
    ['minChangeP', 'Min daily change'], ['maxChangeP', 'Max daily change']];
  const filterProblem = (() => {
    for (const [key, label] of TYPED_FILTERS) {
      const raw = filters[key];
      if (raw === '' || raw == null) continue;
      if (window.NumberInput) {
        const c = window.NumberInput.check(raw);
        if (c.error) return `${label}: ${c.error}`;
      } else if (!Number.isFinite(fnum(raw))) return `${label} must be a number`;
    }
    return null;
  })();
  const numberField = window.NumberInput ? window.NumberInput.fieldProps : { type: 'number' };

  // The newest request owns the screen. Clicking preset A (a six-second
  // answer) and then preset B (a fast one) drew B's rows and then, six seconds
  // later, overwrote them with A's -- the abandoned request won.
  // Each load takes a number; anything that finishes with an older number is
  // dropped on the floor.
  const loadSeq = React.useRef(0);
  // A search the host's own panel has already explained as refused (the open
  // apps' frame; the terminal has no such panel, so this stays false there).
  // The error line is silenced in that case, and the screen fell back to "Or
  // build your own filter" as if nothing had been asked. It says
  // so now, in the heatmap's words, with the same "Try again".
  const [refused, setRefused] = React.useState(false);
  // The last run did not come back (RateLimitWait.failure): its line has a
  // Try again counting the limit's wait down. Null for anything else.
  const [runFail, setRunFail] = React.useState(null);
  const RLW = window.RateLimitWait;
  const rlWait = RLW.useWait();
  const lastRunRef = React.useRef(undefined);
  const loadScreenerData = async (overrideFilters) => {
    if (isDemo) return;
    lastRunRef.current = overrideFilters;
    setRefused(false);
    setRunFail(null);
    // A saved filter, a restored session or an AI answer can still name an
    // exchange the screener has nothing for: said, not asked.
    const askedExchange = (overrideFilters || filters).exchange;
    if (window.ScreenerDeepLink && window.ScreenerDeepLink.notCovered(askedExchange)) {
      loadSeq.current++;
      setResults(null); setLoading(false);
      setError(window.ScreenerDeepLink.notCoveredNote(askedExchange) + ' Pick another exchange.');
      return;
    }
    // Put the search that is about to run back into the URL. The deep link is
    // read-only and strips itself on arrival, so a screen you built by hand was
    // not linkable and did not survive a reload -- only a link somebody else
    // had written for you did. Only keys that differ from the defaults go in,
    // so the address stays readable.
    if (window.ViewState) {
      const active = overrideFilters || filters;
      const state = {};
      Object.keys(defaultFilters).forEach(function (k) {
        const v = active[k];
        // '' for a key that is back at its default: merge treats that as
        // "remove", so clearing a filter clears it from the link too.
        state[k] = (v !== undefined && v !== '' && String(v) !== String(defaultFilters[k])) ? v : '';
      });
      window.ViewState.merge(state);
    }
    const LOOSE_LOCAL_CAP = 0.25;
    const seq = ++loadSeq.current;
    const stale = () => seq !== loadSeq.current;
    setLoading(true);
    setError(null);

    try {
      const activeFilters = overrideFilters || filters;
      const filtersArray = [];
      // Typed values are text: ScreenerRules.readNumber reads "1,5" as 1.5;
      // one that can't be read is not sent.
      const pushNum = (field, op, raw, scale = 1) => {
        if (raw === '' || raw == null) return;
        const n = window.ScreenerRules.readNumber(raw);
        if (Number.isFinite(n)) filtersArray.push([field, op, n * scale]);
      };
      // Market cap bounds are dollars. The upstream compares them with each
      // row's own currency -- on LSE a forint, krona and pound figure alike
      // -- so off the US venues they are applied here, per
      // row, on the cap converted to dollars (attachUsdCaps, passes).
      const usdScreen = window.ScreenerRules.priceBoundsUpstream(activeFilters.exchange);
      if (usdScreen) pushNum('market_capitalization', '>', activeFilters.minMarketCap);
      if (usdScreen) pushNum('market_capitalization', '<', activeFilters.maxMarketCap);
      // Off the dollar venues the lower bound still goes upstream, loose: a
      // quarter of it, in each row's own currency. No listing currency is
      // worth more than about 3.3 dollars (the Kuwaiti dinar), so no row that
      // clears the bound in dollars is cut; the exact dollar check stays per
      // row. Without it "London High Yield, cap > $1B" asked for every LSE
      // line and its two pages filled with the smallest ones.
      if (!usdScreen) pushNum('market_capitalization', '>', activeFilters.minMarketCap, LOOSE_LOCAL_CAP);
      if (activeFilters.sector) filtersArray.push(['sector', '=', activeFilters.sector]);
      pushNum('dividend_yield', '>', activeFilters.minDividendYield, 1 / 100);
      pushNum('dividend_yield', '<', activeFilters.maxDividendYield, 1 / 100);
      pushNum('earnings_share', '>', activeFilters.minEPS);
      // Price bounds: upstream only where every line quotes in dollars; on
      // LSE etc. a pence price would meet a pound bound, so ScreenerRules.passes
      // applies them per row in the major unit instead.
      const priceUp = window.ScreenerRules.priceBoundsUpstream(activeFilters.exchange);
      if (priceUp) pushNum('adjusted_close', '>', activeFilters.minPrice);
      if (priceUp) pushNum('adjusted_close', '<', activeFilters.maxPrice);
      pushNum('avgvol_1d', '>', activeFilters.minVolume);
      pushNum('refund_1d_p', '>', activeFilters.minChangeP);
      pushNum('refund_1d_p', '<', activeFilters.maxChangeP);
      const Rules = window.ScreenerRules;
      const sortParam = `${activeFilters.sortBy}.${activeFilters.sortOrder}`;
      const venues = activeFilters.exchange ? Rules.venuesFor(activeFilters.exchange) : [null];

      // One page, through the same transport as every other data call. This
      // used to decide for itself (`!apiKey || apiKey === 'demo'`), so on the
      // web a visitor signed in with a key went straight to /eodhd-api with the
      // key in the URL -- past the backend, and onto a plan that may not carry
      // the Screener feed (a 403 HTML page, "Invalid response from API") --
      // while SSO visitors got a working screener. EODHD_API.needsProxy is
      // always true on the web and keeps the Telegram rule where it is.
      const API = window.EODHD_API;
      const fetchPage = (venue, offset) => {
        const arr = (venue ? [['exchange', '=', venue]] : []).concat(filtersArray);
        const params = { filters: JSON.stringify(arr.length ? arr : [['market_capitalization', '>', 1000000000]]), limit: PAGE, offset, sort: sortParam };
        return API._proxyFetch('screener', params);
      };

      // Batch-fetch via offset pagination so the user can sort/filter a wider universe
      // client-side. EODHD caps each page at 500 AND caps offset at 999, so the effective
      // max is two pages (offset 0 and 500) per venue — roughly 1000 results each.
      const PAGE = 500;
      const MAX_OFFSET = 999; // EODHD hard limit
      const target = 1000 * venues.length;
      let loaded = 0;
      setLoadProgress({ loaded: 0, target });
      // A venue is cut when it answered every page we may ask for in full.
      const capped = venues.map(() => false);
      const perVenue = await Promise.all(venues.map(async (venue, vi) => {
        const rows = [];
        for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE) {
          const data = await fetchPage(venue, offset);
          if (stale()) return rows;
          if (data && data.errors) {
            // Known soft-limit: EODHD rejects offset > 999. Stop pagination, keep what we got.
            if (data.errors.offset) { capped[vi] = true; break; }
            // Anything else is a real filter problem -- said in words, not
            // as the raw {"errors": ...} body.
            throw new Error('The screener rejected these filters (' + Object.keys(data.errors).slice(0, 3).join(', ') + ').');
          }
          const page = data?.data || data;
          // JSON of another shape is an answer that could not be read, not a
          // dropped connection.
          if (!Array.isArray(page)) throw Object.assign(new Error('Unexpected response format'), { unreadable: true });
          rows.push(...page);
          loaded += page.length;
          setLoadProgress({ loaded, target });
          if (page.length < PAGE) break;
          if (offset + PAGE > MAX_OFFSET) capped[vi] = true;
        }
        return rows;
      }));
      if (stale()) return;
      setLoadProgress(null);
      let resultData = venues.length > 1
        ? Rules.mergeSorted(perVenue, activeFilters.sortBy, activeFilters.sortOrder)
        : perVenue[0];
      // A capped venue ends the complete part of the merged ranking.
      const cut = Rules.cutAtCaps(resultData, perVenue, capped, venues.map(v => v || String(activeFilters.exchange || 'all').toUpperCase()), activeFilters.sortBy, activeFilters.sortOrder);
      resultData = cut.rows;
      setCapInfo(cut.cutVenues.length ? { venues: cut.cutVenues, merged: venues.length > 1 } : null);
      // Off the US venues, each row's market cap also in dollars, for the
      // ranking, the cap bounds and the "(≈ $14.2B)" beside the local figure.
      if (!usdScreen && resultData.length) {
        const isos = [...new Set(resultData.map(r => Rules.isoOf(r)).filter(c => c && c !== 'USD'))];
        const rates = {};
        await Promise.all(isos.map(async (iso) => {
          try {
            const k = 'fx-usd::' + iso;
            const hit = window.CacheManager ? window.CacheManager.get('screener-fx', k) : null;
            const rate = hit != null ? hit : await API.getForexRate(apiKey, iso, 'USD');
            if (Number.isFinite(Number(rate)) && Number(rate) > 0) {
              rates[iso] = Number(rate);
              if (window.CacheManager && hit == null) window.CacheManager.set('screener-fx', window.CacheManager.TTL.LONG, Number(rate), k);
            }
          } catch (_) { /* that currency stays unconverted: no dollar figure, ranked last */ }
        }));
        if (stale()) return;
        resultData = Rules.attachUsdCaps(resultData, rates);
      }
      // Re-check the numeric filters: the upstream lets some rows through
      // that fail them (see ScreenerRules.passes).
      resultData = resultData.filter(row => Rules.passes(row, activeFilters));
      // NYSE/NASDAQ screens: drop OTC foreign lines and preferred series.
      if (venues.length > 1) resultData = resultData.filter(row => !Rules.isNotCommonStock(row));

      // Post-filter: P/E ratio, price in the EPS unit (ScreenerRules.peOf)
      if (activeFilters.minPE || activeFilters.maxPE) {
        resultData = resultData.filter(stock => {
          const pe = Rules.peOf(stock);
          if (pe == null) return false;
          const lo = Rules.readNumber(activeFilters.minPE);
          const hi = Rules.readNumber(activeFilters.maxPE);
          if (Number.isFinite(lo) && pe < lo) return false;
          if (Number.isFinite(hi) && pe > hi) return false;
          return true;
        });
      }

      if (stale()) return;
      // Initialise client sort to match the filter sort (so initial order matches API)
      setClientSort({ by: activeFilters.sortBy || 'market_capitalization', order: activeFilters.sortOrder || 'desc' });
      setCurrentPage(1);
      setResults(resultData);
      if (window.MIAnalytics) window.MIAnalytics.track('dl_mi_screener_filter', { result_count: resultData.length, exchange: (overrideFilters || filters).exchange });
    } catch (err) {
      if (stale()) return;
      // A request that did not come back -- the limit, EODHD's own error, no
      // connection -- is said with its reason and a Try again; at 429 it read
      // "HTTP 429 (screener)" with no wait and no button.
      // A rejected filter keeps its own words below.
      const f = window.RateLimitWait.failure(err);
      // An answer that could not be read (an HTML page with 200, JSON of
      // another shape) is said as that, with Try again; it read "did not
      // answer, or the connection dropped".
      const notServed = f.limited || f.unreadable || f.status === 0 || f.status >= 500;
      setRunFail(notServed ? f : null);
      // A transport that throws the upstream's body hands over raw JSON
      // ({"errors":{"sort.0.field":[...]}}); that is not a sentence.
      if (err && typeof err.message === 'string' && /^\s*[{[]/.test(err.message)) {
        err.message = window.AIText ? window.AIText.error(err.message) : 'The screener rejected these filters.';
      }
      if (notServed) err = { message: window.RateLimitWait.failText('The screen', f) };
      setRefused(Boolean(window.Entitlement && window.Entitlement.explained && window.Entitlement.explained()));
      setError(window.Entitlement && window.Entitlement.explained() ? '' : (err.message || 'Failed to load screener data'));
    }
    if (stale()) return;
    setLoadProgress(null);
    setLoading(false);
  };

  // A number from the API, or null. The feed sends strings where a number is
  // expected -- real-time answers "NA" for BRK.B -- and `x && x.toFixed(2)`
  // let a non-empty string through to a TypeError that unmounted the whole
  // page. Every figure below goes through this.
  const asNum = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  // Green for a rise, red for a fall, and neither for no change: +0.00% in
  // green reads as good news that did not happen.
  // Light theme: the darker inks (#21CE99 on white is 2.03:1).
  const changeColor = (n) => (n > 0 ? (isDark ? C3.success : (C3.successLight || '#047857'))
    : n < 0 ? (isDark ? C3.error : (C3.errorLight || '#c81e2c'))
    : (isDark ? C3.textMutedDark : C3.textMutedLight));

  // Apply client-side sort on top of fetched results
  const sortedResults = React.useMemo(() => {
    if (!results) return null;
    // Missing values last in both directions (ScreenerRules.sortRows).
    return window.ScreenerRules.sortRows(results, clientSort.by, clientSort.order);
  }, [results, clientSort]);

  // After a page change made in the pager: if the button pressed is gone or
  // disabled (Next on the last page, a number that left the short list),
  // focus goes to the current page's button rather than to <body>.
  const pagerRef = React.useRef(null);
  const pagerUsedRef = React.useRef(false);
  React.useEffect(() => {
    if (!pagerUsedRef.current) return;
    pagerUsedRef.current = false;
    const el = pagerRef.current;
    if (!el) return;
    const a = document.activeElement;
    if (a && el.contains(a) && !a.disabled) return;
    const cur = el.querySelector('[aria-current="page"]');
    if (cur) { try { cur.focus({ preventScroll: true }); } catch (_) { cur.focus(); } }
  }, [currentPage]);

  // The preset whose search is running. A tap showed nothing where it was
  // made -- "Searching stocks..." sat below the screen on a phone -- and a
  // second tap sent the same /screener requests again. The button shows it is busy, and a tap on it while its search
  // runs sends nothing: the search on its way answers it. The search has its
  // own deadline; a failure says so, with Try again.
  const [busyPreset, setBusyPreset] = React.useState(null);
  React.useEffect(() => { if (!loading) setBusyPreset(null); }, [loading]);
  const applyPreset = (preset) => {
    if (loading && busyPreset === preset.id) return;
    setBusyPreset(preset.id);
    setFilters(preset.filters);
    setActivePreset(preset.id);
    setAiDescription(null); setAiError(null); setAiQuery('');
    setShowFilters(false);
    window.Haptics?.light();
    goToResultsRef.current = true;
    // Auto-run search
    loadScreenerData(preset.filters);
  };

  const applySavedScreen = (screen) => {
    setFilters(screen.filters);
    setActivePreset(null);
    setAiDescription(null); setAiError(null); setAiQuery('');
    setShowFilters(false);
    window.Haptics?.light();
    goToResultsRef.current = true;
    loadScreenerData(screen.filters);
  };

  const handleAiScreener = async () => {
    if (!aiQuery.trim() || aiLoading) return;
    setAiLoading(true); setAiError(null); setAiDescription(null); setResults(null);
    window.Haptics?.medium();
    try {
      const result = await window.AIService.parseScreenerQuery(aiQuery.trim());
      // Start from a CLEAN filter set (not defaultFilters with its 10B min-cap),
      // so the AI query gets exactly what the model decided on. Without this,
      // 'high volume' was silently intersected with 'market cap > $10B' and
      // returned only a handful of mega-caps.
      const aiFilters = {
        exchange: 'us',
        minMarketCap: '', maxMarketCap: '',
        minPE: '', maxPE: '',
        sector: '',
        minDividendYield: '', maxDividendYield: '',
        minEPS: '',
        minPrice: '', maxPrice: '',
        minVolume: '',
        minChangeP: '', maxChangeP: '',
        sortBy: 'market_capitalization', sortOrder: 'desc',
      };
      // Only what the form itself can express reaches the screener
      // (ScreenerRules.validateAiFilters); the rest is named, not sent.
      const checked = window.ScreenerRules.validateAiFilters(result && result.filters);
      Object.keys(checked.filters).forEach(k => { aiFilters[k] = checked.filters[k]; });
      setFilters(aiFilters);
      setActivePreset(null);
      setAiDescription(checked.dropped.length
        ? `${result.description || ''}${result.description ? ' ' : ''}(Ignored what the screener cannot use: ${checked.dropped.join(', ')}.)`
        : result.description);
      await loadScreenerData(aiFilters);
      window.Haptics?.success();
    } catch (err) {
      if (err.message === 'AI_TOKENS_REQUIRED') { setAiLoading(false); return; }
      setAiError(window.AIText ? window.AIText.error(err) : (err.message || 'Could not understand query'));
      window.Haptics?.error();
    }
    setAiLoading(false);
  };

  const aiExamples = [
    'Tech stocks P/E under 20',
    'High dividend UK stocks',
    'Cheap energy stocks',
    'Mega cap gainers today',
  ];

  const saveCurrentScreen = async () => {
    // Pasted text is not held by maxLength in every browser: the stored name
    // is cut to the same length.
    const name = saveScreenName.trim().slice(0, window.SCREEN_NAME_MAX);
    if (!name) return;
    // One name, one filter. Saving twice under the same name left two chips
    // nothing on screen could tell apart.
    const clash = baseScreens().some(sc => (sc.name || '').toLowerCase() === name.toLowerCase());
    if (clash && !(await askInPage({ title: `Replace "${name}"?`, text: 'A saved filter with this name already exists. Replacing it keeps one filter under the name.', confirmLabel: 'Replace', isDark }))) return;
    const newScreen = {
      id: `custom_${Date.now()}`,
      name,
      filters: { ...filters },
      createdAt: new Date().toISOString()
    };
    // The stored list, not this tab's copy of it: another tab's saves stay.
    const base = baseScreens();
    const updated = [...base.filter(sc => (sc.name || '').toLowerCase() !== name.toLowerCase()), newScreen];
    keepSavedScreens(updated);
    setShowSaveModal(false);
    setSaveScreenName('');
  };

  const deleteSavedScreen = (screenId) => {
    // The x leaves with its chip and the focus fell to <body>: the next chip's x takes it, else the previous one, else the
    // Filter button when no saved screen is left.
    const at = savedScreens.findIndex(s => s.id === screenId);
    const neighbour = savedScreens[at + 1] || savedScreens[at - 1];
    focusNext(() => (neighbour && Array.from(document.querySelectorAll('[data-saved-screen-delete]'))
        .find(el => el.getAttribute('data-saved-screen-delete') === String(neighbour.id)))
      || document.querySelector('[data-screener-filter-toggle]'));
    const updated = baseScreens().filter(s => s.id !== screenId);
    keepSavedScreens(updated);
  };


  const formatVolume = (vol) => {
    if (!vol) return '';
    if (vol >= 1e9) return `${(vol / 1e9).toFixed(1)}B`;
    if (vol >= 1e6) return `${(vol / 1e6).toFixed(1)}M`;
    if (vol >= 1e3) return `${(vol / 1e3).toFixed(0)}K`;
    return vol.toLocaleString('en-US');
  };

  // Count active filters (excluding defaults)
  const activeFilterCount = () => {
    let count = 0;
    const d = defaultFilters;
    if (filters.exchange !== d.exchange) count++;
    if (filters.minMarketCap !== d.minMarketCap) count++;
    if (filters.maxMarketCap) count++;
    if (filters.minPE) count++;
    if (filters.maxPE) count++;
    if (filters.sector) count++;
    if (filters.minDividendYield) count++;
    if (filters.maxDividendYield) count++;
    if (filters.minEPS) count++;
    if (filters.minPrice) count++;
    if (filters.maxPrice) count++;
    if (filters.minVolume) count++;
    if (filters.minChangeP) count++;
    if (filters.maxChangeP) count++;
    return count;
  };

  const selectStyle = {
    width: '100%',
    padding: '12px',
    borderRadius: '12px',
    background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    // A field's edge is what shows it is a field: 3:1 or more against the
    // panel (it was 1.34:1 in the dark theme).
    border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.45)'),
    color: isDark ? C3.textDark : C3.textLightTheme,
    fontSize: '14px',
    outline: 'none',
  };
  // <option> inherits color from <select> but opens on the OS-native popup with system bg —
  // force an explicit bg so we never get white-on-white (or black-on-black) when the OS theme
  // doesn't match the app theme.
  const optionStyle = {
    background: isDark ? '#1E222D' : '#ffffff',
    color: isDark ? C3.textDark : C3.textLightTheme,
  };

  const inputStyle = {
    ...selectStyle,
    boxSizing: 'border-box',
  };

  const presetButtonStyle = (isActive) => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '10px 6px',
    borderRadius: '12px',
    background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    border: 'none',
    cursor: 'pointer',
    color: isDark ? C3.textDark : C3.textLightTheme,
    ...window.ToggleStyle.value(isActive, isDark),
    minWidth: '76px',
    textAlign: 'center',
  });

  // Filter group label, optionally with a ? tooltip
  const FilterLabel = ({ children, help }) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px', color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: '6px', fontWeight: 500 }}>
      <span>{children}</span>
      {help && window.HelpTooltip && React.createElement(window.HelpTooltip, { title: children, text: help, isDark })}
    </label>
  );

  const Wrapper = embedded ? React.Fragment : window.AppLayout;
  const wrapperProps = embedded ? {} : { activeTab, onTabChange, onSettingsClick, theme };

  return (
    <Wrapper {...wrapperProps}>
      {/* The spinners' keyframes travel with the view, as the calendar's do:
          a host page without the terminal's CSS showed a frozen ring. */}
      <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
      {/* Header */}
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <h1 ref={retryHeadingRef} tabIndex={-1} style={{ fontSize: '20px', fontWeight: '700', margin: 0 }}>Stock Screener</h1>
            {window.HelpTooltip && <HelpTooltip title="Stock Screener" text="Filter and rank stocks by criteria like market cap, P/E ratio, dividend yield, and sector. Supports multiple exchanges worldwide." isDark={isDark} />}
            <button data-hit="" onClick={() => setShowGuide(true)} title="How to use the Screener" style={{
              padding: '3px 8px', marginLeft: 4, borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: isDark ? C3.fillDark : C3.fillLight,
              color: isDark ? C3.textMutedDark : C3.textMutedLight,
              border: '1px solid ' + (isDark ? C3.lineDark : C3.lineLight),
              cursor: 'pointer',
            }}>Guide</button>
          </div>
          <p style={{ fontSize: '12px', color: isDark ? C3.textMutedDark : C3.textMutedLight, margin: 0 }}>
            {/* The count sits above the table, once. */}
            Filter stocks by criteria
          </p>
        </div>
        {/* The panel opens under AI Screener and Quick Screens -- on a phone,
            two screens below this button, so the tap seemed to do nothing and
            the badge counted filters nobody could see. Opening it
            brings it into view. */}
        <button onClick={() => {
          const opening = !showFilters;
          setShowFilters(opening); window.Haptics?.light();
          // Phones and tablets only: on a desktop the panel is a short scroll away
          // and moving the page would carry this button off the screen.
          if (opening && window.innerWidth <= 1024) setTimeout(() => {
            const panel = document.querySelector('[data-screener-filters-panel]');
            if (!panel) return;
            const r = panel.getBoundingClientRect();
            if (r.top < 0 || r.top > window.innerHeight * 0.6) panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
          }, 50);
        }} aria-expanded={showFilters} data-screener-filter-toggle="true" style={{
          padding: '10px 16px', height: '40px', borderRadius: '12px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          background: showFilters ? C3.logoGradient : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'),
          border: 'none', cursor: 'pointer', color: showFilters ? 'white' : (isDark ? C3.textDark : C3.textLightTheme),
          fontSize: '14px', fontWeight: '600',
          position: 'relative',
        }}>
          <Icon name="filter" size={16} />
          Filter
          {activeFilterCount() > 0 && !showFilters && (
            <span style={{
              position: 'absolute', top: -4, right: -4,
              width: 18, height: 18, borderRadius: '50%',
              background: C3.glowOrange, color: 'white',
              fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{activeFilterCount()}</span>
          )}
        </button>
        {/* Top-level Search button removed — duplicated the "Run Filter" CTA
            inside the filters panel. Users were tapping it expecting a free-
            text symbol search, which it doesn't do. */}
      </div>

      <div style={{ padding: '0 20px' }}>
        {/* Demo Mode — blur preview with sample results */}
        {isDemo ? (
          <div>
            {/* No identity at all (the Telegram build opened in a browser):
                the screener was refused with 401, so "Premium Feature" was
                the wrong reason. */}
            {window.PaywallGate ? (
              <window.PaywallGate
                allowed={false}
                type="subscription"
                message="The screener runs on an EODHD account. Connect yours in Settings, or pick a plan."
                actionLabel="See plans"
                onAction={onUpgradeClick}
                isDark={isDark}
              >
                {/* Fake preview results */}
                {[
                  { name: 'Apple Inc.', code: 'AAPL', cap: '3.2T', pe: '28.4', change: '+1.2%' },
                  { name: 'Microsoft Corp.', code: 'MSFT', cap: '2.9T', pe: '35.1', change: '+0.8%' },
                  { name: 'Nvidia Corp.', code: 'NVDA', cap: '2.1T', pe: '52.3', change: '-0.5%' },
                ].map((item, i) => (
                  <div key={i} style={{
                    ...(isDark ? C3.glassDark : C3.glassLight),
                    borderRadius: 14, padding: 14, marginBottom: 10,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{item.code}</div>
                      <div style={{ fontSize: 11, opacity: 0.5 }}>{item.name}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 12, opacity: 0.6 }}>Cap: {item.cap}</div>
                      <div style={{ fontSize: 12, opacity: 0.6 }}>P/E: {item.pe}</div>
                    </div>
                  </div>
                ))}
              </window.PaywallGate>
            ) : (
              <div style={{ textAlign: 'center', padding: '48px 20px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: '700', marginTop: '1em', marginBottom: '8px' }}>Stock Screener</h2>
                <p style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: '24px' }}>
                  Upgrade for full screener access
                </p>
                <button onClick={onUpgradeClick} style={{
                  padding: '14px 28px', background: C3.logoGradient, border: 'none',
                  borderRadius: '14px', color: 'white', fontSize: '15px', fontWeight: '600', cursor: 'pointer',
                }}>
                  Upgrade Now
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* AI Screener — present only when a model key is configured. */}
            {window.AIService.getSettings().enabled && (
            <div style={{
              ...(isDark ? C3.glassDark : C3.glassLight),
              borderRadius: '16px', padding: '16px', marginBottom: '16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontSize: '14px', fontWeight: '700', color: isDark ? C3.textDark : C3.textLightTheme }}>AI Screener</span>
              </div>
              <div data-field-row="" style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                <input data-field-floor="" aria-label="Describe the stocks you are looking for"
                  type="text"
                  value={aiQuery}
                  onChange={(e) => setAiQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAiScreener(); }}
                  placeholder='e.g. "profitable tech"'
                  disabled={aiLoading}
                  style={{
                    // minWidth 0: an input's intrinsic width (~20 chars) is
                    // its flex minimum, so on a 320 px phone it would not
                    // shrink and pushed "Ask AI" 19 px off the screen.
                    flex: 1, minWidth: 0, padding: '10px 14px', borderRadius: '12px',
                    background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                    border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),
                    color: isDark ? C3.textDark : C3.textLightTheme,
                    fontSize: '13px', outline: 'none', boxSizing: 'border-box',
                    opacity: aiLoading ? 0.6 : 1,
                  }}
                />
                <button
                  onClick={handleAiScreener}
                  disabled={aiLoading || !aiQuery.trim()}
                  style={{
                    padding: '10px 16px', borderRadius: '12px',
                    background: C3.logoGradient,
                    border: 'none', cursor: 'pointer', color: 'white',
                    fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap',
                    opacity: (aiLoading || !aiQuery.trim()) ? 0.5 : 1,
                    display: 'flex', alignItems: 'center', gap: '6px',
                  }}
                >
                  {aiLoading ? (
                    <span style={{
                      width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)',
                      borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                      display: 'inline-block',
                    }} />
                  ) : null}
                  {aiLoading ? 'Thinking...' : (askCost ? `Ask AI · ${askCost}` : 'Ask AI')}
                </button>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {aiExamples.map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => { setAiQuery(ex); window.Haptics?.light(); }}
                    style={{
                      padding: '4px 10px', borderRadius: '8px', fontSize: '11px',
                      background: isDark ? C3.fillDark : C3.fillLight,
                      border: '1px solid ' + (isDark ? C3.lineDark : C3.lineLight),
                      color: isDark ? C3.textMutedDark : C3.textMutedLight,
                      cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    {ex}
                  </button>
                ))}
              </div>
              {aiError && (
                <div style={{
                  marginTop: '10px', padding: '10px 12px', borderRadius: '10px',
                  background: isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.05)',
                  border: `1px solid ${C3.error}30`,
                }}>
                  <p style={{ color: C3.error, fontSize: '12px', margin: 0 }}>{aiError}</p>
                </div>
              )}
            </div>
            )}

            {/* Quick Screens (Presets), ordered by category. The groups WRAP:
                as one scrollable row the last chip was cut to "Mid-Cap Mome…"
                at 1440 px with nothing saying the row scrolled. The category label above each group does the job
                the vertical separators did. */}
            <div style={{ marginBottom: '16px' }}>
              <h2 style={{ fontSize: '14px', fontWeight: '600', marginTop: '1em', marginBottom: '10px', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                Quick Screens
              </h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 20px', paddingBottom: '8px', alignItems: 'flex-start' }}>
                {(() => {
                  const order = ['Value', 'Growth', 'Income', 'Momentum', 'Defensive', 'Sector', 'Tactical'];
                  const groups = {};
                  presetScreens.forEach(p => {
                    const c = p.category || 'Other';
                    (groups[c] ||= []).push(p);
                  });
                  const cats = order.filter(c => groups[c]).concat(Object.keys(groups).filter(c => !order.includes(c)));
                  const out = [];
                  cats.forEach((cat) => {
                    out.push(React.createElement('div', {
                      key: 'group-' + cat,
                      style: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, maxWidth: '100%' },
                    },
                      React.createElement('div', {
                        style: {
                          // Full muted ink, no fade: 2.75:1 light / 3.21:1 dark at 9 px.
                          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                          color: isDark ? 'rgba(255,255,255,0.7)' : C3.textMutedLight,
                          padding: '0 2px 2px',
                        },
                      }, cat),
                      React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
                        // The description was only a title: nothing on a
                        // touch screen or to a screen reader.
                        // It is each button's accessible description, and
                        // the picked preset's is printed under the list.
                        groups[cat].map(preset => React.createElement(React.Fragment, { key: preset.id }, React.createElement('button', {
                          'aria-pressed': activePreset === preset.id,
                          'aria-describedby': 'screener-preset-desc-' + preset.id,
                          // Busy while its search runs: a ring in place of
                          // the icon, where the tap was made.
                          'aria-busy': loading && busyPreset === preset.id ? 'true' : undefined,
                          'data-preset-busy': loading && busyPreset === preset.id ? 'true' : undefined,
                          onClick: () => applyPreset(preset),
                          style: { ...presetButtonStyle(activePreset === preset.id), flexShrink: 0, cursor: loading && busyPreset === preset.id ? 'progress' : 'pointer' },
                          title: preset.description,
                        },
                          loading && busyPreset === preset.id
                            ? React.createElement('span', { 'aria-hidden': 'true', style: { width: 18, height: 18, marginBottom: '2px', boxSizing: 'border-box', borderRadius: '50%', border: '2px solid rgba(128,128,128,0.35)', borderTopColor: 'currentColor', animation: 'spin 0.8s linear infinite' } })
                            : React.createElement('span', { style: { marginBottom: '2px' } }, React.createElement(Icon, { name: preset.icon, size: 18 })),
                          React.createElement('span', { style: { fontSize: '10px', fontWeight: '600', whiteSpace: 'nowrap' } }, preset.name),
                        ),
                        // Outside the button, so it describes it without
                        // joining its name.
                        React.createElement('span', { id: 'screener-preset-desc-' + preset.id, style: { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 } }, preset.description),
                        )),
                      ),
                    ));
                  });
                  return out;
                })()}
              </div>
              {(() => {
                const picked = activePreset && presetScreens.find(p => p.id === activePreset);
                return picked ? (
                  <div data-screener-preset-note="true" style={{ fontSize: '12px', marginTop: '4px', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                    {picked.name}: {picked.description}
                  </div>
                ) : null;
              })()}
            </div>

            {saveNote && (
              <div role="alert" data-screener-save-note="true" style={{ fontSize: '12px', marginBottom: '10px', color: isDark ? C3.textDark : C3.textLightTheme }}>{saveNote}</div>
            )}
            {/* Saved Screens */}
            {savedScreens.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <h2 style={{ fontSize: '14px', fontWeight: '600', marginTop: '1em', marginBottom: '10px', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                  My Screens
                </h2>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {savedScreens.map(screen => (
                    // A long name is cut with an ellipsis inside the chip, the
                    // whole name in its tooltip: a 60-letter name with no
                    // spaces made a 764 px chip at 320 px, its x off screen,
                    // and Tab to it scrolled the page sideways.
                    <div key={screen.id} style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '8px 12px', borderRadius: '10px', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box',
                      background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                    }}>
                      <button
                        onClick={() => applySavedScreen(screen)}
                        title={screen.name}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: isDark ? C3.textDark : C3.textLightTheme,
                          fontSize: '13px', fontWeight: '500',
                          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                      >
                        {screen.name}
                      </button>
                      <button aria-label={'Delete saved screen ' + screen.name}
                        data-saved-screen-delete={String(screen.id)}
                        onClick={() => deleteSavedScreen(screen.id)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: C3.error, fontSize: '14px', padding: '2px', flexShrink: 0,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Filters Panel */}
            {/* The fields set outline: none inline and had no other sign of
                focus where the host draws no ring of its own (the open app):
                sixteen fields, none visible from the keyboard. Their own
                ring, the search field's colours (5.2:1 / 6.8:1). */}
            {showFilters && (
              <style>{`[data-screener-filters-panel] :is(input, button[aria-haspopup="listbox"]):focus-visible { outline: 2px solid ${isDark ? '#f97316' : '#c2410c'} !important; outline-offset: 2px !important; }`}</style>
            )}
            {showFilters && (
              <div data-screener-filters-panel="true" style={{
                ...(isDark ? C3.glassDark : C3.glassLight),
                borderRadius: '16px', padding: '16px', marginBottom: '16px', scrollMarginTop: '72px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  {/* h3: it follows the Quick Screens h2, so no level is skipped. */}
                  <h3 tabIndex={-1} style={{ fontWeight: '600', margin: 0 }}>Filters</h3>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setShowSaveModal(true)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '6px 12px', borderRadius: '8px',
                        background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                        border: 'none', cursor: 'pointer',
                        color: isDark ? C3.textDark : C3.textLightTheme,
                        fontSize: '12px',
                      }}
                    >
                      <Icon name="bookmark" size={14} />
                      Save
                    </button>
                    <button onClick={() => { setFilters(defaultFilters); setActivePreset(null); setAiDescription(null); setAiError(null); setAiQuery(''); }} style={{
                      padding: '6px 12px', borderRadius: '8px', fontSize: '12px',
                      color: C3.error,
                      background: isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.05)',
                      border: 'none', cursor: 'pointer',
                    }}>
                      Reset
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
                  {/* Exchange */}
                  <div>
                    <FilterLabel help={"Stock exchange. US covers NYSE+NASDAQ. Each exchange has its own ticker space and currency."}>Exchange</FilterLabel>
                    {React.createElement(window.PortalDropdown, {
                      value: filters.exchange,
                      // A value the list does not offer (a saved filter, "nyse"
                      // from a link) is shown as itself, not as an empty box.
                      options: [...exchanges, ...(filters.exchange && !exchanges.some(ex => ex.value === filters.exchange) ? [{ value: filters.exchange, label: String(filters.exchange).toUpperCase() }] : [])].map(ex => ({ value: ex.value, label: ex.label })),
                      onChange: (v) => setFilters({...filters, exchange: v}),
                      isDark, style: { ...selectStyle, padding: '8px 30px 8px 12px' }, minWidth: 0, ariaLabel: 'Exchange',
                    })}
                  </div>

                  {/* Sector */}
                  <div>
                    <FilterLabel help={"Broad industry classification (GICS-style). Pick one to focus on a single area like Technology or Energy."}>Sector</FilterLabel>
                    {React.createElement(window.PortalDropdown, {
                      value: filters.sector,
                      options: [{ value: '', label: 'All Sectors' }, ...sectors.filter(s => s).map(s => ({ value: s, label: s }))],
                      onChange: (v) => setFilters({...filters, sector: v}),
                      isDark, style: { ...selectStyle, padding: '8px 30px 8px 12px' }, minWidth: 0, ariaLabel: 'Sector',
                    })}
                  </div>

                  {/* Market Cap */}
                  <div>
                    <FilterLabel help={"Minimum company size in dollars. Mega >$200B, Large >$10B, Mid $2–10B, Small $300M–$2B, Micro <$300M."}>Min Market Cap</FilterLabel>
                    {React.createElement(window.PortalDropdown, {
                      value: filters.minMarketCap,
                      // A preset's own floor ($200B, $2B, $3B...) is listed
                      // too: the field read blank under a preset it did not
                      // carry.
                      options: capOptions([
                        { value: '', label: 'Any' },
                        { value: '300000000', label: '$300M+' },
                        { value: '1000000000', label: '$1B+' },
                        { value: '10000000000', label: '$10B+' },
                        { value: '50000000000', label: '$50B+' },
                        { value: '100000000000', label: '$100B+' },
                        { value: '200000000000', label: '$200B+' },
                        { value: '500000000000', label: '$500B+' },
                      ], filters.minMarketCap, '+'),
                      onChange: (v) => setFilters({...filters, minMarketCap: v}),
                      isDark, style: { ...selectStyle, padding: '8px 30px 8px 12px' }, minWidth: 0, ariaLabel: 'Min Market Cap',
                    })}
                  </div>
                  <div>
                    <FilterLabel help={"Upper bound on company size. Combine with Min to target a size band (e.g. mid-caps only)."}>Max Market Cap</FilterLabel>
                    {React.createElement(window.PortalDropdown, {
                      value: filters.maxMarketCap,
                      options: capOptions([
                        { value: '', label: 'Any' },
                        { value: '1000000000', label: '$1B' },
                        { value: '10000000000', label: '$10B' },
                        { value: '50000000000', label: '$50B' },
                        { value: '100000000000', label: '$100B' },
                      ], filters.maxMarketCap, ''),
                      onChange: (v) => setFilters({...filters, maxMarketCap: v}),
                      isDark, style: { ...selectStyle, padding: '8px 30px 8px 12px' }, minWidth: 0, ariaLabel: 'Max Market Cap',
                    })}
                  </div>

                  {/* Price Range */}
                  <div>
                    <FilterLabel help={"Minimum share price, in the listing's main currency unit (pounds, not pence, on LSE). Useful to exclude penny stocks or cheap shares with wide spreads."}>Min Price {window.ScreenerRules.priceUnitLabel(filters.exchange) === '$' ? '$' : '(listing ccy)'}</FilterLabel>
                    <input aria-label="Min price" {...numberField} value={filters.minPrice} onChange={(e) => setFilters({...filters, minPrice: e.target.value})} placeholder="e.g. 10" style={inputStyle} />
                  </div>
                  <div>
                    <FilterLabel help={"Upper share-price limit, in the listing's main currency unit (pounds, not pence, on LSE) — e.g. set 50 to find stocks under 50."}>Max Price {window.ScreenerRules.priceUnitLabel(filters.exchange) === '$' ? '$' : '(listing ccy)'}</FilterLabel>
                    <input aria-label="Max price" {...numberField} value={filters.maxPrice} onChange={(e) => setFilters({...filters, maxPrice: e.target.value})} placeholder="e.g. 500" style={inputStyle} />
                  </div>

                  {/* P/E Range */}
                  <div>
                    <FilterLabel help={"Lowest P/E ratio. Use 0 to exclude negative earnings; 10 to find deep-value names."}>Min P/E</FilterLabel>
                    <input aria-label="Min P/E" {...numberField} value={filters.minPE} onChange={(e) => setFilters({...filters, minPE: e.target.value})} placeholder="e.g. 5" style={inputStyle} />
                  </div>
                  <div>
                    <FilterLabel help={"Upper P/E. Typical: 15 = cheap, 25 = reasonable, 40+ = growth premium."}>Max P/E</FilterLabel>
                    <input aria-label="Max P/E" {...numberField} value={filters.maxPE} onChange={(e) => setFilters({...filters, maxPE: e.target.value})} placeholder="e.g. 30" style={inputStyle} />
                  </div>

                  {/* Dividend Yield */}
                  <div>
                    <FilterLabel help={"Minimum dividend yield in percent (e.g. 3 = 3%). 0 includes non-dividend payers."}>Min Div Yield %</FilterLabel>
                    <input aria-label="Min dividend yield %" {...numberField} value={filters.minDividendYield} onChange={(e) => setFilters({...filters, minDividendYield: e.target.value})} placeholder="e.g. 2" style={inputStyle} />
                  </div>
                  <div>
                    <FilterLabel help={"Cap on yield. Extremely high yields (>10%) often mean a stressed or cutting company."}>Max Div Yield %</FilterLabel>
                    <input aria-label="Max dividend yield %" {...numberField} value={filters.maxDividendYield} onChange={(e) => setFilters({...filters, maxDividendYield: e.target.value})} placeholder="e.g. 10" style={inputStyle} />
                  </div>

                  {/* Min EPS */}
                  <div>
                    <FilterLabel help={"Minimum earnings per share. Use 0.01 to filter out money-losing companies."}>Min EPS</FilterLabel>
                    <input aria-label="Min EPS" {...numberField} value={filters.minEPS} onChange={(e) => setFilters({...filters, minEPS: e.target.value})} placeholder="e.g. 1" style={inputStyle} />
                  </div>

                  {/* Volume */}
                  <div>
                    <FilterLabel help={"Minimum average daily traded shares. Higher = more liquid / tighter spreads."}>Min Volume</FilterLabel>
                    {React.createElement(window.PortalDropdown, {
                      value: filters.minVolume,
                      options: [
                        { value: '', label: 'Any' },
                        { value: '100000', label: '100K+' },
                        { value: '500000', label: '500K+' },
                        { value: '1000000', label: '1M+' },
                        { value: '5000000', label: '5M+' },
                        { value: '10000000', label: '10M+' },
                        { value: '50000000', label: '50M+' },
                      ],
                      onChange: (v) => setFilters({...filters, minVolume: v}),
                      isDark, style: { ...selectStyle, padding: '8px 30px 8px 12px' }, minWidth: 0, ariaLabel: 'Min Volume',
                    })}
                  </div>

                  {/* Daily Change % */}
                  <div>
                    <FilterLabel help={"Minimum intraday % change. +3 finds today’s gainers; negative values find recovering names."}>Min Daily Change %</FilterLabel>
                    <input aria-label="Min daily change %" {...numberField} value={filters.minChangeP} onChange={(e) => setFilters({...filters, minChangeP: e.target.value})} placeholder="e.g. 2" style={inputStyle} />
                  </div>
                  <div>
                    <FilterLabel help={"Upper bound on intraday change. -3 finds today’s biggest losers."}>Max Daily Change %</FilterLabel>
                    <input aria-label="Max daily change %" {...numberField} value={filters.maxChangeP} onChange={(e) => setFilters({...filters, maxChangeP: e.target.value})} placeholder="e.g. -5" style={inputStyle} />
                  </div>

                  {/* Sort */}
                  <div>
                    <FilterLabel help={"Field used to order server-side results. Use the Sort dropdown above the results list to re-order client-side without a new fetch."}>Sort By</FilterLabel>
                    {React.createElement(window.PortalDropdown, {
                      value: filters.sortBy,
                      options: sortOptions.map(opt => ({ value: opt.value, label: opt.label })),
                      onChange: (v) => setFilters({...filters, sortBy: v}),
                      isDark, style: { ...selectStyle, padding: '8px 30px 8px 12px' }, minWidth: 0, ariaLabel: 'Sort By',
                    })}
                  </div>
                  <div>
                    <FilterLabel help={"Ascending (smallest first) or Descending (largest first). Applies to Sort By."}>Order</FilterLabel>
                    {React.createElement(window.PortalDropdown, {
                      value: filters.sortOrder,
                      options: [
                        { value: 'desc', label: 'Descending' },
                        { value: 'asc', label: 'Ascending' },
                      ],
                      onChange: (v) => setFilters({...filters, sortOrder: v}),
                      isDark, style: { ...selectStyle, padding: '8px 30px 8px 12px' }, minWidth: 0, ariaLabel: 'Order',
                    })}
                  </div>
                </div>

                {filterProblem && (
                  <div role="alert" style={{ marginTop: 12, fontSize: 12, lineHeight: 1.5, color: isDark ? C3.error : (C3.errorLight || '#c81e2c') }}>{filterProblem}</div>
                )}

                {/* Run + Save actions */}
                <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center' }}>
                  <button
                    onClick={() => { if (filterProblem || loading) return; setAiDescription(null); setAiError(null); loadScreenerData(); window.Haptics?.light?.(); }}
                    // While it runs it is aria-disabled, not disabled: a disabled
                    // button gives its focus up to <body>, and a keyboard user who
                    // pressed it was sent to the top of the page.
                    disabled={isDemo || !!filterProblem}
                    aria-disabled={loading || undefined}
                    style={{
                      flex: 1, padding: '12px 16px', borderRadius: 12,
                      background: C3.logoGradient, border: 'none', cursor: (loading || isDemo) ? 'wait' : 'pointer',
                      color: 'white', fontSize: 14, fontWeight: 700,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      opacity: (loading || isDemo) ? 0.6 : 1,
                    }}
                  >
                    <Icon name="search" size={16} color="white" />
                    {loading ? 'Running…' : 'Run Filter'}
                  </button>
                  <button
                    onClick={() => setShowSaveModal(true)}
                    disabled={loading}
                    style={{
                      flex: 1, padding: '12px 18px', borderRadius: 12,
                      background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                      border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'),
                      cursor: 'pointer', color: isDark ? C3.textDark : C3.textLightTheme,
                      fontSize: 14, fontWeight: 600,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                  >
                    <Icon name="bookmark" size={16} />
                    Save Filter
                  </button>
                </div>
              </div>
            )}

            {linkNote && (
              <div role="status" data-screener-link-note="true" style={{ fontSize: '12px', marginBottom: '12px', overflowWrap: 'anywhere', color: isDark ? C3.textDark : C3.textLightTheme }}>{linkNote}</div>
            )}
            {/* Error */}
            {error && (
              <div data-screener-fail={runFail ? (runFail.limited ? 'limit' : 'other') : undefined} style={{
                ...(isDark ? C3.glassDark : C3.glassLight),
                borderRadius: '12px', padding: '16px', marginBottom: '16px',
                border: `1px solid ${C3.error}30`,
              }}>
                {/* The reason is read when it appears, a rejected filter's
                    too; the held press's note counts every second and is
                    outside the live region. */}
                <p style={{ color: C3.error, fontSize: '14px', margin: 0 }}><span role="status">{error}</span>{rlWait.note ? <span data-wait-note="true">{' ' + rlWait.note}</span> : null}</p>
                {/* Not served: Try again, counting the limit's wait down and
                    sending nothing inside it. */}
                {runFail && !loading && (
                  <RLW.RetryButton wait={rlWait} isDark={isDark} data-retry-focus="true" onClick={() => { retryFocusRef.current = true; loadScreenerData(lastRunRef.current); }} style={{
                    marginTop: '12px', padding: '8px 18px', background: C3.logoGradient, border: 'none',
                    borderRadius: '10px', color: 'white', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
                  }} />
                )}
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div style={{ textAlign: 'center', padding: '48px 0' }}>
                <div style={{
                  width: '32px', height: '32px',
                  border: '3px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'), borderTopColor: C3.glowOrange,
                  borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px',
                }} />
                <p style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight, margin: 0 }}>Searching stocks...</p>
              </div>
            )}

            {/* Results */}
            {!loading && results && results.length > 0 && (
              <>
                {aiDescription && (() => {
                  const fmtCap = (v) => { const n = parseFloat(v); if (!isFinite(n)) return v; if (n >= 1e12) return `$${(n/1e12).toFixed(1)}T`; if (n >= 1e9) return `$${(n/1e9).toFixed(1)}B`; if (n >= 1e6) return `$${(n/1e6).toFixed(0)}M`; return `$${n}`; };
                  const fmtVol = (v) => { const n = parseFloat(v); if (!isFinite(n)) return v; if (n >= 1e9) return `${(n/1e9).toFixed(1)}B`; if (n >= 1e6) return `${(n/1e6).toFixed(0)}M`; if (n >= 1e3) return `${(n/1e3).toFixed(0)}K`; return String(n); };
                  const chips = [];
                  if (filters.exchange && filters.exchange !== 'us') chips.push(`exch:${filters.exchange.toUpperCase()}`);
                  if (filters.sector) chips.push(filters.sector);
                  if (filters.minMarketCap) chips.push(`cap ≥ ${fmtCap(filters.minMarketCap)}`);
                  if (filters.maxMarketCap) chips.push(`cap ≤ ${fmtCap(filters.maxMarketCap)}`);
                  const pUnit = window.ScreenerRules.priceUnitLabel(filters.exchange) === '$' ? '$' : '';
                  const pSuffix = pUnit ? '' : ' (listing ccy)';
                  if (filters.minPrice) chips.push(`price ≥ ${pUnit}${filters.minPrice}${pSuffix}`);
                  if (filters.maxPrice) chips.push(`price ≤ ${pUnit}${filters.maxPrice}${pSuffix}`);
                  if (filters.minPE) chips.push(`P/E ≥ ${filters.minPE}`);
                  if (filters.maxPE) chips.push(`P/E ≤ ${filters.maxPE}`);
                  if (filters.minEPS) chips.push(`EPS ≥ ${filters.minEPS}`);
                  if (filters.minDividendYield) chips.push(`div ≥ ${filters.minDividendYield}%`);
                  if (filters.maxDividendYield) chips.push(`div ≤ ${filters.maxDividendYield}%`);
                  if (filters.minVolume) chips.push(`vol ≥ ${fmtVol(filters.minVolume)}`);
                  if (filters.minChangeP) chips.push(`chg ≥ ${filters.minChangeP}%`);
                  if (filters.maxChangeP) chips.push(`chg ≤ ${filters.maxChangeP}%`);
                  return (
                    <div style={{
                      padding: '8px 12px', borderRadius: '10px', marginBottom: '12px',
                      background: isDark ? C3.fillDark : C3.fillLight,
                      border: '1px solid ' + (isDark ? C3.lineDark : C3.lineLight),
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ flex: 1, fontSize: '12px', color: isDark ? C3.textMutedDark : C3.textMutedLight, fontWeight: 500 }}>
                          AI: {aiDescription}
                        </span>
                        <button aria-label="Dismiss AI description" onClick={() => setAiDescription(null)} style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: isDark ? C3.textMutedDark : C3.textMutedLight, fontSize: '16px', padding: '0 2px', lineHeight: 1,
                        }}>{'\u00d7'}</button>
                      </div>
                      {chips.length > 0 && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                          {chips.map((c, i) => (
                            <span key={i} style={{
                              fontSize: 10, padding: '2px 8px', borderRadius: 10,
                              background: isDark ? C3.fillDark : C3.fillLight,
                              color: isDark ? C3.textMutedDark : C3.textMutedLight, fontWeight: 600,
                            }}>{c}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                  <p ref={resultsHeadRef} tabIndex={-1} style={{ fontSize: '14px', color: isDark ? C3.textMutedDark : C3.textMutedLight, margin: 0, scrollMarginTop: 72 }}>
                    {results.length} stocks found
                  </p>
                  {/* Wraps: at 320 px the preset badge, the sort list, the
                      arrow and Reset are wider than the column, and Reset ran
                      to the screen edge (the page grew to 334 px in the Mini
                      App, which has no phone stylesheet to wrap it). */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', maxWidth: '100%' }}>
                    {activePreset && (
                      <span style={{
                        fontSize: 11, padding: '4px 10px', borderRadius: 8,
                        background: `${C3.glowOrange}20`, color: C3.glowOrange, fontWeight: 600,
                      }}>
                        <Icon name={presetScreens.find(p => p.id === activePreset)?.icon} size={11} /> {presetScreens.find(p => p.id === activePreset)?.name}
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Sort:</span>
                    {React.createElement(window.PortalDropdown, {
                      value: clientSort.by,
                      options: [
                        { value: 'market_capitalization', label: 'Market Cap' },
                        { value: 'refund_1d_p', label: 'Daily Change %' },
                        { value: 'adjusted_close', label: 'Price' },
                        { value: 'pe', label: 'P/E' },
                        { value: 'earnings_share', label: 'EPS' },
                        { value: 'dividend_yield', label: 'Div Yield' },
                        { value: 'avgvol_1d', label: 'Volume' },
                        { value: 'code', label: 'Ticker' },
                        { value: 'name', label: 'Name' },
                        { value: 'sector', label: 'Sector' },
                      ],
                      onChange: (by) => {
                        const isText = by === 'code' || by === 'name' || by === 'sector';
                        setClientSort({ by, order: isText ? 'asc' : 'desc' });
                        setCurrentPage(1);
                      },
                      isDark,
                      style: { padding: '4px 24px 4px 8px', fontSize: 12, borderRadius: 6 },
                      minWidth: 120,
                      ariaLabel: 'Sort results by',
                    })}
                    <button
                      onClick={() => { setClientSort({ ...clientSort, order: clientSort.order === 'desc' ? 'asc' : 'desc' }); setCurrentPage(1); }}
                      title={clientSort.order === 'desc' ? 'Descending — click for ascending' : 'Ascending — click for descending'}
                      style={{
                        padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                        border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),
                        color: isDark ? C3.textDark : C3.textLightTheme, cursor: 'pointer',
                      }}>
                      {clientSort.order === 'desc' ? '\u2193' : '\u2191'}
                    </button>
                    <button
                      onClick={() => {
                        setResults(null); setError(null);
                        setFilters(defaultFilters);
                        setActivePreset(null);
                        setAiDescription(null); setAiError(null); setAiQuery('');
                        setClientSort({ by: 'market_capitalization', order: 'desc' });
                        setCurrentPage(1);
                        try { sessionStorage.removeItem(SESSION_KEY); } catch {}
                        // The results and this button leave the page; the focus
                        // fell to <body>. "Custom Filter"
                        // stands where they were. With the filter panel open
                        // that button is not drawn and the focus fell to
                        // <body> again: the panel's
                        // "Filters" heading takes it then.
                        // The page is shorter without the results: at 320 the
                        // heading sat above the top, its ring unseen
                        // -- brought into view.
                        focusNext(() => document.querySelector('[data-screener-custom-filter]')
                          || document.querySelector('[data-screener-filters-panel] h3'), { reveal: true });
                        window.Haptics?.light();
                      }}
                      title="Clear results and reset all filters"
                      style={{
                        padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                        background: isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.08)',
                        border: '1px solid ' + (isDark ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.25)'),
                        color: C3.error, cursor: 'pointer',
                      }}>
                      Reset
                    </button>
                  </div>
                </div>
                {/* Hard-cap warning: EODHD returns at most 1,000 rows per venue
                    and filter set. Which venue was cut, and that the merged list
                    stops where the cut venue's ranking stops. */}
                {capInfo && (
                  <div style={{
                    padding: '10px 14px', borderRadius: '10px', marginBottom: '12px',
                    background: isDark ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.12)',
                    border: '1px solid ' + (isDark ? 'rgba(251,191,36,0.3)' : 'rgba(251,191,36,0.35)'),
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <Icon name="alertCircle" size={16} color="#f59e0b" />
                    <span style={{ flex: 1, fontSize: 12, color: isDark ? '#fcd34d' : '#92400e', lineHeight: 1.5 }}>
                      {capInfo.merged
                        ? `${capInfo.venues.join(' and ')} returned the data provider's maximum of 1,000 rows, so the list stops where ${capInfo.venues.length > 1 ? 'those rankings stop' : 'that ranking stops'} (${results.length} shown). `
                        : `The data provider returns at most 1,000 rows per search; there are more matches. `}
                      Add more filters (market cap, sector, P/E, etc.) to narrow down to a workable universe.
                    </span>
                    <button onClick={() => {
                      setShowFilters(true);
                      // Panel is rendered above — scroll it into view after it mounts
                      setTimeout(() => {
                        const panel = document.querySelector('[data-screener-filters-panel]');
                        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        else window.scrollTo({ top: 0, behavior: 'smooth' });
                      }, 50);
                    }} style={{
                      padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                      background: '#f59e0b', border: 'none', color: 'white', cursor: 'pointer',
                    }}>Open filters</button>
                  </div>
                )}
                {(() => {
                  const list = sortedResults || results;
                  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
                  const page = Math.min(currentPage, totalPages);
                  const start = (page - 1) * PAGE_SIZE;
                  const end = Math.min(start + PAGE_SIZE, list.length);
                  return (
                    <>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 8,
                      }}>
                        <span>Showing {start + 1}–{end} of {list.length}</span>
                        <span>Page {page} / {totalPages}</span>
                      </div>
                    </>
                  );
                })()}
                <div>
                  {(() => {
                    const list = sortedResults || results;
                    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
                    const page = Math.min(currentPage, totalPages);
                    const start = (page - 1) * PAGE_SIZE;
                    const end = Math.min(start + PAGE_SIZE, list.length);
                    return list.slice(start, end);
                  })().map((stock, i) => {
                    const exchSuffix = filters.exchange ? `.${filters.exchange.toUpperCase()}` : '.US';
                    const symbol = stock.code ? `${stock.code}${exchSuffix}` : '';
                    return (
                      <button key={stock.code || i} onClick={() => { if (window.MIAnalytics) window.MIAnalytics.track('dl_mi_screener_result_click', { symbol: symbol, result_rank: i }); onSelectAsset({ symbol, name: stock.name }); window.Haptics?.medium(); }} style={{
                        width: '100%', textAlign: 'left',
                        ...(isDark ? C3.glassDark : C3.glassLight),
                        borderRadius: '14px', padding: '14px', marginBottom: '10px',
                        cursor: 'pointer', display: 'block',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {/* A long sector beside a long ticker ran under the
                                price at 320 px ("Communication Services", 11 px
                                over "$167.65"): the badge takes
                                the next line when the row has no room, and
                                never more than the row. The terminal's phone
                                stylesheet already wraps every flex row with a
                                gap, so this is what it draws there today; a
                                host without that stylesheet did not. */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: '700', fontSize: 15, color: isDark ? C3.textDark : C3.textLightTheme }}>{stock.code}</span>
                              {stock.sector && (
                                <span title={stock.sector} style={{
                                  fontSize: '10px', padding: '2px 6px', borderRadius: '6px',
                                  background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                                  color: isDark ? C3.textMutedDark : C3.textMutedLight,
                                  // Web: the badge is drawn at the 12 px small step (design
                                  // stage 2), and "Communication Services" no longer fits
                                  // one line beside the price at 320 px: it wraps rather
                                  // than lose its end. The Mini App keeps one line.
                                  whiteSpace: window.APP_PLATFORM === 'WEB' ? 'normal' : 'nowrap',
                                  maxWidth: '100%', boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis',
                                }}>{stock.sector}</span>
                              )}
                              {stock._score && window.ScoreBadge && React.createElement(window.ScoreBadge, { score: stock._score, grade: stock._grade, size: 'small', theme })}
                            </div>
                            <div style={{
                              fontSize: '12px', color: isDark ? C3.textMutedDark : C3.textMutedLight,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }} title={stock.name || undefined}>{stock.name}</div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                            {(() => {
                              const close = asNum(stock.adjusted_close);
                              const chg = asNum(stock.refund_1d_p);
                              return (
                                <>
                                  {close != null && (
                                    <div style={{ fontWeight: '700', fontSize: 15, color: isDark ? C3.textDark : C3.textLightTheme }}>
                                      {window.ScreenerRules.formatPrice(stock, close)}
                                    </div>
                                  )}
                                  {chg != null && (
                                    <div style={{ fontSize: '13px', fontWeight: 600, color: changeColor(chg) }}>
                                      {chg > 0 ? '+' : ''}{chg.toFixed(2)}%
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </div>

                        {/* Metrics row */}
                        {(() => {
                          const pe = window.ScreenerRules.peOf(stock);
                          const eps = asNum(stock.earnings_share);
                          const dy = asNum(stock.dividend_yield);
                          const vol = asNum(stock.avgvol_1d);
                          return (
                            <div style={{ display: 'flex', gap: '10px', fontSize: '11px', color: isDark ? C3.textMutedDark : C3.textMutedLight, flexWrap: 'wrap' }}>
                              {/* Listing currency, price brought to the EPS unit
                                  for P/E (pence vs pounds on LSE): ScreenerRules. */}
                              <span>Cap: {window.ScreenerRules.formatCapWithUsd(stock)}</span>
                              {pe != null && <span>P/E: {pe.toFixed(1)}</span>}
                              {dy > 0 && <span>Div: {(dy * 100).toFixed(2)}%</span>}
                              {eps != null && <span>EPS: {window.ScreenerRules.formatMajor(stock, eps)}</span>}
                              {vol > 0 && <span>Vol: {formatVolume(vol)}</span>}
                            </div>
                          );
                        })()}
                      </button>
                    );
                  })}
                </div>
                {/* Pagination controls */}
                {(() => {
                  const list = sortedResults || results;
                  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
                  if (totalPages <= 1) return null;
                  const page = Math.min(currentPage, totalPages);
                  // Prev and Next keep one key each: keyed by their target they
                  // were a new button on every page, and the one just pressed
                  // lost focus to <body>.
                  const btn = (label, target, disabled, highlight, stableKey) => React.createElement('button', {
                    key: stableKey || (label + target),
                    'aria-current': highlight ? 'page' : undefined,
                    onClick: () => { if (!disabled) { pagerUsedRef.current = true; setCurrentPage(target); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
                    disabled,
                    style: {
                      minWidth: 32, padding: '6px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                      background: highlight ? C3.logoGradient : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'),
                      color: highlight ? 'white' : (isDark ? C3.textDark : C3.textLightTheme),
                      border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.4 : 1,
                    },
                  }, label);
                  // Build condensed page list: always show first, last, current±2, and ellipses
                  const pages = [];
                  const push = (p) => { if (!pages.includes(p) && p >= 1 && p <= totalPages) pages.push(p); };
                  push(1);
                  for (let p = page - 2; p <= page + 2; p++) push(p);
                  push(totalPages);
                  pages.sort((a, b) => a - b);
                  const out = [];
                  for (let i = 0; i < pages.length; i++) {
                    if (i > 0 && pages[i] - pages[i-1] > 1) out.push(React.createElement('span', { key: 'gap' + i, style: { color: isDark ? C3.textMutedDark : C3.textMutedLight, fontSize: 12, padding: '0 4px' } }, '…'));
                    out.push(btn(String(pages[i]), pages[i], false, pages[i] === page));
                  }
                  return React.createElement('div', {
                    ref: pagerRef,
                    style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 16, flexWrap: 'wrap' },
                  },
                    btn('‹ Prev', Math.max(1, page - 1), page === 1, false, 'prev'),
                    ...out,
                    btn('Next ›', Math.min(totalPages, page + 1), page === totalPages, false, 'next'),
                  );
                })()}
              </>
            )}

            {!loading && refused && !results && (
              <div style={{ textAlign: 'center', padding: '32px 20px' }}>
                {/* The words are the live region; the button and the note
                    count every second and stay outside it. */}
                <p role="status" style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: '16px' }}>
                  Nothing below is missing data — the request was not served. See the panel above.
                </p>
                <RLW.RetryButton wait={rlWait} isDark={isDark} data-retry-focus="true" onClick={() => { retryFocusRef.current = true; loadScreenerData(lastRunRef.current); }} style={{
                  padding: '12px 24px', background: C3.logoGradient, border: 'none',
                  borderRadius: '12px', color: 'white', fontSize: '14px', fontWeight: '600', cursor: 'pointer',
                }} />
                {rlWait.note && <p data-wait-note="true" style={{ margin: '12px 0 0', fontSize: 13, color: isDark ? C3.textDark : C3.textLightTheme }}>{rlWait.note}</p>}
              </div>
            )}

            {/* Empty State — hide when the custom filter panel is already open */}
            {!loading && !error && !refused && !results && !showFilters && (
              <div style={{ textAlign: 'center', padding: '32px 20px' }}>
                <div style={{
                  width: '80px', height: '80px', borderRadius: '20px',
                  background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 16px',
                }}>
                  <Icon name="filter" size={40} color={isDark ? C3.textMutedDark : C3.textMutedLight} />
                </div>
                <p style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: '4px', fontSize: '15px' }}>
                  Or build your own filter
                </p>
                <p style={{ fontSize: '13px', color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: '20px' }}>
                  Market cap, P/E, dividends, EPS, price, volume across 13 exchanges
                </p>
                <button data-screener-custom-filter="true" onClick={() => {
                  setShowFilters(true); window.Haptics?.light();
                  // This button leaves the page with the empty state, and
                  // focus fell to <body>. It goes to the heading of the panel
                  // that opened.
                  setTimeout(() => {
                    const h = document.querySelector('[data-screener-filters-panel] h3');
                    if (h) h.focus();
                  }, 0);
                }} style={{
                  padding: '14px 32px', borderRadius: '14px',
                  background: C3.logoGradient, border: 'none', cursor: 'pointer',
                  color: 'white', fontSize: '15px', fontWeight: '600',
                  display: 'inline-flex', alignItems: 'center', gap: '8px',
                }}>
                  <Icon name="filter" size={18} color="white" />
                  Custom Filter
                </button>
              </div>
            )}

            {!loading && results && results.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 20px' }}>
                {aiDescription && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '8px 12px', borderRadius: '10px', marginBottom: '16px', textAlign: 'left',
                    background: isDark ? C3.fillDark : C3.fillLight,
                    border: '1px solid ' + (isDark ? C3.lineDark : C3.lineLight),
                  }}>
                    <span style={{ flex: 1, fontSize: '12px', color: isDark ? C3.textMutedDark : C3.textMutedLight, fontWeight: 500 }}>
                      AI: {aiDescription}
                    </span>
                    <button aria-label="Dismiss AI description" onClick={() => setAiDescription(null)} style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: isDark ? C3.textMutedDark : C3.textMutedLight, fontSize: '16px', padding: '0 2px', lineHeight: 1,
                    }}>{'\u00d7'}</button>
                  </div>
                )}
                <div style={{
                  width: '80px', height: '80px', borderRadius: '20px',
                  background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 16px',
                }}>
                  <Icon name="search" size={40} color={isDark ? C3.textMutedDark : C3.textMutedLight} />
                </div>
                <p ref={resultsHeadRef} tabIndex={-1} style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight, scrollMarginTop: 72 }}>No stocks match your filters</p>
                <p style={{ fontSize: '14px', color: isDark ? C3.textMutedDark : C3.textMutedLight, marginTop: '8px' }}>
                  Try adjusting your criteria
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {askElement}
      {/* Save Screen: a dialog like the others -- Escape closes it, Tab stays
          in it, the focus goes back to Save Filter (it
          was a plain overlay, Escape did nothing and Tab walked out). */}
      {showSaveModal && window.PTDialog && React.createElement(window.PTDialog.Modal, {
        onClose: () => setShowSaveModal(false),
        label: 'Save Screen',
        overlayStyle: { zIndex: 100, background: 'rgba(0,0,0,0.8)', alignItems: 'center', padding: '20px' },
        style: {
          background: isDark ? '#1E222D' : '#ffffff',
          border: '1px solid ' + (isDark ? '#303640' : '#e2e4e9'),
          borderRadius: '20px', padding: '24px', width: '100%', maxWidth: '320px', boxSizing: 'border-box',
          color: isDark ? C3.textDark : C3.textLightTheme,
        },
      },
        <form noValidate onSubmit={(e) => { e.preventDefault(); saveCurrentScreen(); }}>
          <h2 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 16px' }}>Save Screen</h2>
          <input aria-label="Screen name"
            type="text"
            value={saveScreenName}
            onChange={(e) => setSaveScreenName(e.target.value)}
            placeholder="Screen name..."
            maxLength={window.SCREEN_NAME_MAX}
            style={{ ...inputStyle, marginBottom: '16px' }}
            autoFocus
          />
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="button"
              onClick={() => setShowSaveModal(false)}
              style={{
                flex: 1, padding: '12px', borderRadius: '12px',
                background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                border: 'none', cursor: 'pointer',
                color: isDark ? C3.textDark : C3.textLightTheme,
                fontSize: '14px', fontWeight: '600',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!saveScreenName.trim()}
              style={{
                flex: 1, padding: '12px', borderRadius: '12px',
                background: C3.logoGradient, border: 'none', cursor: 'pointer',
                color: 'white', fontSize: '14px', fontWeight: '600',
                opacity: saveScreenName.trim() ? 1 : 0.5,
              }}
            >
              Save
            </button>
          </div>
        </form>
      )}

      {/* Screener Guide modal */}
      {/* On <body>, as a dialog: drawn inside the page it was only as fixed as
          its parents allowed, and in the open screener it landed at the end of
          the page with the focus left on Guide and Tab walking the page behind. */}
      {showGuide && window.PTDialog && React.createElement(window.PTDialog.Modal, {
        onClose: () => setShowGuide(false),
        label: 'Screener Guide',
        overlayStyle: { background: 'rgba(0,0,0,0.5)', padding: 16, paddingTop: '5vh' },
        style: {
            background: isDark ? '#1E222D' : '#ffffff',
            border: '1px solid ' + (isDark ? '#303640' : '#e2e4e9'),
            borderRadius: 14, padding: 20, maxWidth: 560, width: '100%', boxSizing: 'border-box',
            maxHeight: '85vh', overflowY: 'auto',
            color: isDark ? C3.textDark : C3.textLightTheme,
        },
      }, <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Screener Guide</h2>
              <button data-hit="44" aria-label="Close guide" onClick={() => setShowGuide(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: isDark ? C3.textMutedDark : C3.textMutedLight, fontSize: 22, padding: 4, lineHeight: 1,
              }}>×</button>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: isDark ? C3.textDark : C3.textLightTheme }}>
              <p style={{ marginTop: 0 }}>Three ways to build a result set — use whichever fits the question you're asking.</p>

              <h3 style={{ fontSize: 14, fontWeight: 700, margin: '16px 0 6px' }}>1. Quick Screens</h3>
              <p style={{ margin: '0 0 10px', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                Preset filter combinations. Click <b>Value Stocks</b>, <b>Momentum</b>, <b>Dividend Champions</b>, etc. and results load immediately. Good as a starting point — you can open <b>Filter</b> after to tweak.
              </p>

              <h3 style={{ fontSize: 14, fontWeight: 700, margin: '16px 0 6px' }}>2. Ask AI</h3>
              <p style={{ margin: '0 0 10px', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                Type a plain English query like <i>"tech stocks P/E under 20"</i>, <i>"dividend aristocrats above 3%"</i>, or <i>"momentum stocks up more than 3% today"</i>. AI translates it to filters. The purple banner shows what was applied — if it got a filter wrong, open Filter and adjust.
              </p>

              <h3 style={{ fontSize: 14, fontWeight: 700, margin: '16px 0 6px' }}>3. Custom Filter</h3>
              <p style={{ margin: '0 0 10px', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                Click <b>Filter</b> to build the query manually: exchange, market cap, P/E, dividend, volume, daily change, and sector. Hover the <span style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight }}>?</span> next to each field for what it means.
              </p>

              <h3 style={{ fontSize: 14, fontWeight: 700, margin: '16px 0 6px' }}>Results & sorting</h3>
              <ul style={{ margin: '0 0 10px', paddingLeft: 20, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                <li><b>Max 1,000 rows</b> per exchange per search (data provider limit; "US" asks NYSE and NASDAQ separately). If you hit the cap, narrow the filter.</li>
                <li><b>Sort dropdown</b> above the list re-orders client-side instantly (no new fetch). Text fields default to A→Z, numeric to descending; arrow button flips it.</li>
                <li><b>Pagination</b>: 50 per page. Use <i>Prev / Next</i> or jump to a page number.</li>
                <li><b>Click any result</b> to open its full asset page. <i>Back</i> returns to your exact filtered+sorted list.</li>
              </ul>

              <h3 style={{ fontSize: 14, fontWeight: 700, margin: '16px 0 6px' }}>Saving searches</h3>
              <p style={{ margin: 0, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                When the filter panel is open, the <b>Save</b> button stores your current filter set under a name. Your saved screens appear at the top of the filter panel and persist across sessions.
              </p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button onClick={() => setShowGuide(false)} style={{
                padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                background: C3.logoGradient, color: 'white', border: 'none', cursor: 'pointer',
              }}>Got it</button>
            </div>
      </>)}
    </Wrapper>
  );
};
