// View state in the URL — the screen someone is looking at is worth a link.
//
//   #/heatmap?index=sp500&view=treemap
//   #/calendar?month=2026-10&scope=earnings
//
// Nothing reflected its state in the URL except the options chain, so a reload
// dropped whatever you had open and there was no way to send anybody a
// particular screen. Reported against all seven open-source apps.
//
// The shape is the one the screener deep link already uses: the tab lives
// before the '?', each view's own keys after it. That matters here — the
// terminal routes on '#/<tab>', so a module writing a bare
// '#AAPL.US' silently destroys the navigation state. This module never touches
// the tab segment: it rewrites the query and puts the tab back exactly as it
// found it.
//
// Pure functions are exported alongside the DOM wrapper so the parsing is unit
// tested without a browser.
(function () {
  // '#/heatmap?a=1' -> { tab: 'heatmap', query: 'a=1' }
  // '#heatmap'      -> { tab: 'heatmap', query: '' }
  // ''              -> { tab: '', query: '' }
  function splitHash(hash) {
    const raw = String(hash || '').replace(/^#\/?/, '');
    const q = raw.indexOf('?');
    return q === -1 ? { tab: raw, query: '' } : { tab: raw.slice(0, q), query: raw.slice(q + 1) };
  }

  // Parse a query string into a plain object. Values stay strings: they came
  // from a URL and they are going into form state, which holds strings too.
  // No prototype: a link's "constructor" or "toString" is not read as one
  // of the view's keys.
  function parseQuery(query) {
    const out = Object.create(null);
    String(query || '').split('&').forEach(function (pair) {
      if (!pair) return;
      const eq = pair.indexOf('=');
      const rawKey = eq === -1 ? pair : pair.slice(0, eq);
      const rawVal = eq === -1 ? '' : pair.slice(eq + 1);
      let key, val;
      try { key = decodeURIComponent(rawKey); } catch (e) { return; }
      try { val = decodeURIComponent(rawVal.replace(/\+/g, ' ')); } catch (e) { return; }
      if (key) out[key] = val;
    });
    return out;
  }

  function buildQuery(params) {
    return Object.keys(params || {})
      // A key with no value is noise in a link someone is meant to read, and
      // reading it back would set the view to empty rather than to default.
      .filter(function (k) {
        const v = params[k];
        return v !== undefined && v !== null && v !== '';
      })
      .map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k]));
      })
      .join('&');
  }

  // The hash this state belongs in, with the tab preserved verbatim.
  function buildHash(tab, params) {
    const query = buildQuery(params);
    const head = tab ? '#/' + tab : '#';
    return query ? head + '?' + query : head;
  }

  function currentHash() {
    try {
      return (typeof window !== 'undefined' && window.location && window.location.hash) || '';
    } catch (e) {
      return '';
    }
  }

  // Read this view's parameters. `tab` is optional: pass it to get nothing back
  // when the URL is pointing at a different view, which is what a module wants
  // on mount inside the terminal, where every view shares one address bar.
  function read(tab) {
    const parts = splitHash(currentHash());
    if (tab && parts.tab && parts.tab !== tab) return {};
    return parseQuery(parts.query);
  }

  // Merge keys into the current view's query. A key set to '' or null is
  // removed, so a view can clear what it no longer holds. The tab segment is
  // never invented: whatever is in the address bar stays there.
  function merge(params) {
    try {
      if (typeof window === 'undefined' || !window.history || !window.location) return;
      const parts = splitHash(currentHash());
      const next = parseQuery(parts.query);
      Object.keys(params || {}).forEach(function (k) {
        const v = params[k];
        if (v === undefined || v === null || v === '') delete next[k];
        else next[k] = String(v);
      });
      // The entry's own state is kept: a view may have marked it (the index
      // page marks the entry a card pushed).
      window.history.replaceState(window.history.state, '', buildHash(parts.tab, next));
    } catch (e) {
      // A link is a convenience. Nothing here is worth breaking a view over.
    }
  }

  // Saved lists a view keeps in localStorage (the screener's filters, the
  // Sentiment tickers), read and written without throwing. Storage that is
  // blocked (Firefox with dom.storage.enabled off, a SecurityError in
  // Chromium) or full threw out of a render, and the view said it had
  // stopped drawing; a full one made Save Filter stay open saying nothing.
  //   read(key, fallback)  -> the parsed value, or fallback
  //   write(key, value)    -> { ok: true } | { ok: false, reason: 'quota' | 'blocked' }
  //   watch(key, fn)       -> fn(parsed) when another tab writes the key; returns the unwatch
  //   failNote(reason)     -> the sentence for a write that did not keep
  const store = {
    read: function (key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    write: function (key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return { ok: true };
      } catch (e) {
        const quota = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
        return { ok: false, reason: quota ? 'quota' : 'blocked' };
      }
    },
    // Two tabs wrote last-wins: tab A's saved filter went when tab B saved
    // its own. The other tab's write arrives here.
    watch: function (key, fn) {
      const on = function (e) {
        if (!e || e.key !== key) return;
        let v = null;
        try { v = e.newValue == null ? null : JSON.parse(e.newValue); } catch (_) { return; }
        fn(v);
      };
      try { window.addEventListener('storage', on); } catch (e) { return function () {}; }
      return function () { window.removeEventListener('storage', on); };
    },
    // A stored list of layout ids (Overview widgets, dashboard tabs): ids
    // this build does not know are dropped, repeats too; a list with none it
    // knows -- garbage, or ids from another version -- is the default; an
    // empty list stays empty (the user chose none). An unknown id left the
    // portfolio Overview blank, positions table included.
    knownList: function (value, known, fallback) {
      const def = Array.isArray(fallback) ? fallback.slice() : [];
      if (!Array.isArray(value)) return def;
      if (!value.length) return [];
      const out = [];
      value.forEach(function (v) { if (typeof v === 'string' && known.indexOf(v) !== -1 && out.indexOf(v) === -1) out.push(v); });
      return out.length ? out : def;
    },
    failNote: function (reason) {
      return reason === 'quota'
        ? "Not saved: this browser's storage for the site is full. Free some space (for example clear saved data of other pages) and try again."
        : 'Not saved: this browser does not let the page keep data (site storage is blocked). It works until the tab is closed.';
    },
  };
  window.SavedStore = store;

  window.ViewState = {
    splitHash: splitHash,
    parseQuery: parseQuery,
    buildQuery: buildQuery,
    buildHash: buildHash,
    read: read,
    merge: merge,
  };
})();
