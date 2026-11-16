// Token Radar's dashboard, model radar-3. It reads window.RADAR (written
// beside dashboard/ by main.ts) and renders the ranked board, the movers
// strip, a filterable table, a per-protocol detail drawer with the model's
// own inputs and the protocol's farm plan, a live-token tab, a model
// sandbox and the methodology. No network: every byte it shows is in
// data.js. No protocol name is special-cased anywhere on this page.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var sandbox = null; // null means the shipped radar-3 constants; an object overrides them

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // radar-3, recomputed in the page so the sandbox can re-rank live: the
  // same arithmetic main.ts runs, from the same snapshot figures.
  function impliedOf(row, m) {
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = growth >= 0 ? 1 + m.growth_up * (growth / 100) : 1 + m.growth_down * (growth / 100);
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + m.maturity_range * (1 - Math.exp(-Math.max(age, 0) / m.maturity_days));
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), m.reach_max_extra_chains);
    var reach = 1 + m.reach_step * extra;
    return Math.max(1, Math.round(row.tvl_usd * m.base_multiple * growthMult * maturity * reach));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab') === 'live' ? 'live' : 'pre-token';
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'rank') { av = a.rank; bv = b.rank; }
      else if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // The movers strip ranks by seven-day DOLLAR inflow, not by raw per cent:
  // a +4,448% week on a $48M protocol is one deposit, while $89M into a
  // $1.6B protocol is a real flow. Only positive inflows, top five.
  function movers() {
    var inflow = DATA.rows
      .filter(function (r) { return r.change_7d !== null && r.change_7d > 0; })
      .map(function (r) { return { row: r, dollars: r.tvl_usd * r.change_7d / 100 }; })
      .sort(function (a, b) { return b.dollars - a.dollars; })
      .slice(0, 5);
    return el('section', { class: 'movers', 'aria-label': 'Biggest seven-day inflows' },
      el('h2', { text: 'Biggest 7-day inflows — dollars, not per cent' }),
      el('div', { class: 'mover-grid' }, inflow.map(function (m) {
        return el('div', { class: 'mover' },
          el('b', { text: m.row.name }),
          el('span', { class: 'flow', text: '+' + fmtUsd(m.dollars) }),
          el('span', { class: 'pct', text: fmtPct(m.row.change_7d) + ' on ' + fmtUsd(m.row.tvl_usd) + ' TVL' }),
          el('span', { class: 'note', text: 'Rank ' + m.row.rank + ' · ' + (m.row.category || 'Other') })
        );
      })),
      el('p', { class: 'movers-note', text: 'Ranked by TVL x 7-day change — dollars moved, not per cent gained. A spike still counts when the dollars behind it are real.' })
    );
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise — and never a prediction that a token will launch.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function downloadCsv() {
    var list = sortedRows(filteredRows());
    var lines = ['rank,slug,name,category,chains,tvl_usd,change_7d,age_days,implied_value_usd'];
    list.forEach(function (r) {
      var cells = [r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', '"' + (r.category || '').replace(/"/g, '""') + '"', '"' + (r.chains || []).join(';') + '"', r.tvl_usd, r.change_7d === null ? '' : r.change_7d, r.age_days === null ? '' : r.age_days, r.implied_value_usd];
      lines.push(cells.join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'token-radar-board.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var csv = el('button', { class: 'button', type: 'button', text: 'Download CSV', onclick: downloadCsv });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      csv,
      el('span', { class: 'count', text: state.tab === 'pre-token' ? filteredRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num' }, el('span', { class: 'rank-pill' + (r.rank <= 3 ? ' top3' : ''), text: String(r.rank) })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num' }, el('span', { class: 'status live', text: 'live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // One plain-English line on what drives this row's number.
  function driverLine(row) {
    if (row.growth_multiplier < 0.95) return 'What drives it: a recent TVL decline pulls the number down — declines are weighted harder than growth, because a drawdown is remembered longer than a spike.';
    if (row.maturity_multiplier < 0.8) return 'What drives it: the protocol is young, so the maturity factor holds the number back — surviving longer is what lifts it from here.';
    if (row.reach_multiplier > 1.05) return 'What drives it: the protocol runs on several chains, and that reach lifts the number — capped, because being everywhere is not being twice as good.';
    if (row.growth_multiplier > 1.1) return 'What drives it: strong seven-day growth lifts the number — growth helps, but less than a decline hurts.';
    return 'What drives it: the TVL itself. This protocol’s implied value is mostly its locked value, with growth, age and reach moving it only a little.';
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Reach multiplier' }), el('b', { class: 'num', text: String(row.reach_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'driver', text: driverLine(row) }),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price, and not a prediction that a token will launch.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, (row.farm_steps || []).map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // The model sandbox: six sliders re-rank the board live, so a reader can
  // see how much the ranking depends on each constant.
  var SANDBOX_SLIDERS = [
    { key: 'base_multiple', label: 'Base multiple (TVL x)', min: 0.05, max: 0.5, step: 0.05 },
    { key: 'growth_up', label: 'Growth weight (rises)', min: 0, max: 0.8, step: 0.05 },
    { key: 'growth_down', label: 'Decline weight (falls)', min: 0, max: 1, step: 0.05 },
    { key: 'maturity_floor', label: 'Maturity floor', min: 0.3, max: 0.9, step: 0.05 },
    { key: 'maturity_range', label: 'Maturity range', min: 0, max: 0.7, step: 0.05 },
    { key: 'reach_step', label: 'Reach per extra chain', min: 0, max: 0.15, step: 0.01 }
  ];
  function sandboxModel() {
    if (!sandbox) return DATA.model;
    var m = {};
    Object.keys(DATA.model).forEach(function (k) { m[k] = DATA.model[k]; });
    Object.keys(sandbox).forEach(function (k) { m[k] = sandbox[k]; });
    return m;
  }
  function sandboxPanel() {
    var m = sandboxModel();
    var reranked = DATA.rows.map(function (r) { return { row: r, value: impliedOf(r, m) }; })
      .sort(function (a, b) { return b.value - a.value || (a.row.slug < b.row.slug ? -1 : 1); });
    var sliders = SANDBOX_SLIDERS.map(function (s) {
      var current = sandbox && sandbox[s.key] !== undefined ? sandbox[s.key] : DATA.model[s.key];
      var input = el('input', { type: 'range', min: String(s.min), max: String(s.max), step: String(s.step), value: String(current), 'aria-label': s.label });
      var valueLabel = el('b', { text: String(current) });
      input.addEventListener('input', function () {
        if (!sandbox) sandbox = {};
        sandbox[s.key] = Number(input.value);
        render();
      });
      return el('div', { class: 'slider' }, el('label', null, el('span', { text: s.label }), valueLabel), input);
    });
    var rows = reranked.slice(0, 10).map(function (item) {
      var move = item.row.rank - (reranked.indexOf(item) + 1);
      var moveText = move === 0 ? '—' : (move > 0 ? 'up ' + move : 'down ' + Math.abs(move));
      return el('tr', null,
        el('td', { class: 'num', text: String(reranked.indexOf(item) + 1) }),
        el('td', null, el('b', { text: item.row.name })),
        el('td', { class: 'num', text: 'was ' + item.row.rank }),
        el('td', { class: 'num', text: moveText }),
        el('td', { class: 'num', text: fmtUsd(item.value) })
      );
    });
    var reset = el('button', { class: 'button ghost', type: 'button', text: 'Reset to radar-3', onclick: function () { sandbox = null; render(); } });
    return el('section', { class: 'panel section' },
      el('h2', { text: 'Model sandbox — move a constant, watch the ranking move' }),
      el('p', { text: 'The sliders change the radar-3 constants and re-rank the whole board in the page, from the same snapshot figures. The shipped values are the board’s ranking; anything else is an experiment.' }),
      el('div', { class: 'sandbox-grid' }, sliders),
      el('div', { class: 'sandbox-out' },
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('caption', { class: 'sub', text: 'Top 10 under the current slider values, against their shipped ranks.' }),
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'New' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Shipped rank' }), el('th', { scope: 'col', text: 'Move' }), el('th', { scope: 'col', text: 'Implied value' }))),
            el('tbody', null, rows)
          )
        )
      ),
      el('div', null, reset, el('span', { class: 'sandbox-note', text: sandbox ? ' Showing an experiment — the board above still uses the shipped radar-3 constants.' : ' Showing the shipped radar-3 constants.' }))
    );
  }

  function methodology() {
    var m = DATA.model;
    return el('section', { class: 'panel section' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple +
        ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_up + ' up / ' + m.growth_down + ' down)' +
        ' x (' + m.maturity_floor + ' + ' + m.maturity_range + ' x (1 - exp(-age_days / ' + m.maturity_days + ')))' +
        ' x (1 + ' + m.reach_step + ' x min(extra chains, ' + m.reach_max_extra_chains + ')) )'
      ),
      el('ul', { class: 'method-list' },
        el('li', { text: 'Declines hurt more than growth helps (' + m.growth_down + ' against ' + m.growth_up + '): a protocol that loses a fifth of its TVL in a week has usually lost trust, while a spike is often one deposit. The model discounts the spike and charges for the fall.' }),
        el('li', { text: 'Maturity saturates: a protocol that has run a year with no token has proved it can survive without one; the second and third years add less, because each extra year proves less than the first.' }),
        el('li', { text: 'Reach is capped at +' + Math.round(m.reach_step * m.reach_max_extra_chains * 100) + '%: running on more chains adds distribution, but being everywhere is not being twice as good.' }),
        el('li', { text: 'Bridges, liquid staking and restaking, exchanges and wrapped or staked products are excluded from the ranked board: each is a product of a token that already trades, not a protocol waiting on a launch. The same rule keeps them out of the early rows below the floor.' }),
        el('li', { text: 'Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Seven-day growth is clamped to ' + m.growth_floor + '% .. +' + m.growth_cap + '%, so one wild week cannot decide a rank.' }),
        el('li', { text: 'Implied value is a model, not a promise: it says what a token might be worth if the protocol’s record stayed as it is. It does not predict whether or when a token launches, and the board keeps pre-token protocols apart from live-token ones, whose market caps are facts.' })
      )
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(movers());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(sandboxPanel());
      shell.appendChild(methodology());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
