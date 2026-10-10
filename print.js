// ─── Printable documents ─────────────────────────────────────────────────────
// The app already hands out CSV, which is the right answer for a spreadsheet and
// the wrong answer for a hardware store. Two documents live here instead, both
// rendered on the server so printing can never race a fetch:
//
//   • the shopping list you carry into Ace, grouped the way the store is laid
//     out, with a tick box and a price to write in;
//   • the prop list the show actually runs on - every prop in the order the
//     scenes happen, then the preset, then what is still to be found.
//
// Both are plain HTML with the stylesheet inlined. Nothing is fetched, so a
// slow font or a missed CSS file cannot leave someone holding a blank sheet.
//
// Type is 19px minimum (14pt) because these get read in a lumber aisle and in
// the wings on a blue work light, and there is exactly one @page rule: Chrome
// lays a mixed-orientation document out at its widest page and shrinks the rest.

// ── Little helpers ───────────────────────────────────────────────────────────
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Notes arrive with newlines in them (someone listing two handcuffs and where
// each came from). Keep the breaks; they are the content.
const escLines = (v) => esc(v).replace(/\r?\n/g, '<br>');

const has = (v) => v != null && String(v).trim() !== '';

// A tick box, drawn rather than typed. A character like "☐" depends on a font
// that may not be installed on whatever prints this.
const BOX = '<span class="box" aria-hidden="true"></span>';

// Somewhere to write a number. Printers drop background fills by default but
// always draw borders, so the rule is a border.
const WRITE = '<span class="write" aria-hidden="true"></span>';

const today = () => new Date().toLocaleDateString('en-US',
  { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

// An Ace item number is worth more at the counter than a URL is. Pull it off
// the product link, and stay quiet if the note already says it.
function aceRef(m) {
  const link = m.link || '';
  if (!/acehardware\.com/i.test(link)) return '';
  const hit = link.match(/\/p\/(\d+)/);
  if (!hit) return '';
  if ((m.notes || '').includes(hit[1])) return '';
  return 'Ace #' + hit[1];
}

// Group rows into buckets, in a stated order, with anything unexpected kept at
// the end rather than dropped. A list that silently loses a row is worse than
// no list at all.
function bucket(rows, keyOf, order, tailLabel) {
  const map = new Map();
  const push = (k, row) => {
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  };
  for (const row of rows) {
    const keys = keyOf(row);
    if (!keys.length) push(tailLabel, row);
    else for (const k of keys) push(k, row);
  }
  const known = order.filter((k) => map.has(k));
  const extra = [...map.keys()]
    .filter((k) => !order.includes(k) && k !== tailLabel)
    .sort((a, b) => a.localeCompare(b));
  const tail = map.has(tailLabel) ? [tailLabel] : [];
  return [...known, ...extra, ...tail].map((k) => [k, map.get(k)]);
}

const byName = (field) => (a, b) =>
  String(a[field] || '').localeCompare(String(b[field] || ''), undefined,
    { numeric: true, sensitivity: 'base' });

// ── The page itself ──────────────────────────────────────────────────────────
const CSS = `
*{box-sizing:border-box}
html,body{margin:0;background:#f2ede1}
body{
  font:19px/1.42 "EB Garamond",Georgia,"Times New Roman",serif;
  color:#19181a; -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
.sheet{max-width:7.7in; margin:0 auto; background:#fffdf7; padding:28px 34px 40px;
  box-shadow:0 10px 30px rgba(21,44,82,.12)}

/* Masthead. The poster's canton blue, one brass rule, and nothing else - this
   is paperwork, and the drama belongs on the poster. */
.mast{border-bottom:3px solid #b08a24; padding-bottom:12px; margin-bottom:6px}
.show{font-family:"Cinzel",Georgia,serif; font-weight:700; font-size:17px;
  letter-spacing:.2em; text-transform:uppercase; color:#152c52; margin:0}
h1{font-family:"Cinzel",Georgia,serif; font-weight:900; font-size:35px;
  line-height:1.04; margin:6px 0 0; color:#152c52}
.sub{font-size:19px; font-style:italic; color:#56504a; margin:6px 0 0}
.meta{display:flex; flex-wrap:wrap; gap:4px 22px; margin:10px 0 0;
  font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;
  font-size:19px; color:#56504a}
.meta b{color:#19181a; font-weight:700}

/* Section headings carry the count, because "Lumber" and "Lumber (14)" are
   different instructions when you are standing in the aisle. */
h2{font-family:"Cinzel",Georgia,serif; font-size:25px; color:#152c52;
  margin:26px 0 0; padding:0 0 5px; border-bottom:1.5px solid #152c52;
  page-break-after:avoid; break-after:avoid}
h2 .n{font-family:system-ui,Arial,sans-serif; font-size:17px; font-weight:400;
  color:#56504a; letter-spacing:.04em}
h3{font-family:"Cinzel",Georgia,serif; font-size:21px; color:#152c52;
  margin:20px 0 0; padding:0 0 3px; border-bottom:1px solid #d9d0b9;
  page-break-after:avoid; break-after:avoid}
h3 .n{font-family:system-ui,Arial,sans-serif; font-size:17px; font-weight:400; color:#56504a}
.lead{font-size:19px; color:#56504a; margin:8px 0 0}

table{width:100%; border-collapse:collapse; margin:7px 0 0}
thead{display:table-header-group}
th{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;
  font-size:17px; font-weight:700; text-transform:uppercase; letter-spacing:.08em;
  color:#56504a; text-align:left; padding:5px 7px; border-bottom:1.5px solid #c3b894;
  vertical-align:bottom}
td{font-size:19px; padding:7px; border-bottom:1px solid #e6dfcb; vertical-align:top}
tbody tr{page-break-inside:avoid; break-inside:avoid}
td,th{orphans:2; widows:2}
.c{text-align:center}
.r{text-align:right}
.item{font-weight:600}
.qty{font-family:"Cinzel",Georgia,serif; font-weight:700; color:#7a5c12; white-space:nowrap}
.note{display:block; font-size:19px; color:#56504a; margin-top:2px}
.ref{display:inline-block; font-family:system-ui,Arial,sans-serif; font-size:19px;
  font-weight:700; color:#8c1720; white-space:nowrap}
.flag{display:inline-block; font-family:system-ui,Arial,sans-serif; font-size:19px;
  font-weight:700; padding:1px 7px; border:1px solid #c3b894; border-radius:9px;
  color:#56504a; white-space:nowrap}
.flag.buy{border-color:#ae1f2b; color:#8c1720}
.flag.open{border-color:#ae1f2b; color:#8c1720}

.box{display:inline-block; width:15px; height:15px; border:1.5px solid #19181a;
  vertical-align:-1px}
.write{display:inline-block; min-width:62px; border-bottom:1px solid #b9ad8c;
  height:17px; vertical-align:-2px}

/* Subtotals sit under their own group, so a long trip can be added up as it
   goes instead of at the till. */
.sum{font-family:system-ui,Arial,sans-serif; font-size:19px; color:#56504a;
  text-align:right; padding-top:7px}
.total{margin:22px 0 0; padding:12px 14px; border:2px solid #152c52;
  display:flex; justify-content:space-between; align-items:baseline; gap:18px;
  page-break-inside:avoid}
.total span{font-family:"Cinzel",Georgia,serif; font-size:21px; color:#152c52;
  letter-spacing:.06em; text-transform:uppercase}
.total .write{min-width:150px; border-bottom:1.5px solid #152c52; height:22px}

.callout{margin:18px 0 0; padding:11px 14px; border-left:4px solid #ae1f2b;
  background:#f8f3e7; font-size:19px; page-break-inside:avoid}
.callout b{color:#8c1720}

.foot{margin:30px 0 0; padding-top:10px; border-top:1.5px solid #b08a24;
  font-family:system-ui,Arial,sans-serif; font-size:19px; color:#56504a;
  display:flex; justify-content:space-between; gap:20px; flex-wrap:wrap}

.bar{position:sticky; top:0; z-index:5; background:#152c52; color:#fffdf7;
  padding:11px 16px; display:flex; gap:12px; align-items:center; flex-wrap:wrap;
  font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif; font-size:17px}
.bar b{font-weight:700}
.bar a,.bar button{appearance:none; font:inherit; font-weight:700; cursor:pointer;
  border-radius:9px; border:1px solid rgba(255,253,247,.5); background:transparent;
  color:#fffdf7; padding:7px 13px; text-decoration:none}
.bar .go{background:#b08a24; border-color:#b08a24; color:#19181a}
.bar .sp{margin-left:auto}

@page{size:Letter; margin:.5in .6in .55in .8in}
@media print{
  html,body{background:#fff}
  .sheet{max-width:none; margin:0; padding:0; box-shadow:none; background:#fff}
  .bar{display:none}
  .callout{background:none}
}
`;

function shell(opts) {
  const links = opts.links || '';
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n'
    + '<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<meta name="robots" content="noindex, nofollow">\n'
    + '<title>' + esc(opts.title) + '</title>\n'
    + '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
    + 'family=Cinzel:wght@700;900&family=EB+Garamond:ital,wght@0,400;0,600;1,400&display=swap">\n'
    + '<style>' + CSS + '</style>\n</head>\n<body>\n'
    + '<div class="bar">'
    + '<b>' + esc(opts.barTitle) + '</b>'
    + links
    + '<span class="sp"></span>'
    + '<button class="go" type="button" onclick="window.print()">Print this list</button>'
    + '<a href="' + esc(opts.back) + '">Back to the list</a>'
    + '</div>\n'
    + '<div class="sheet">\n'
    + '<header class="mast">\n'
    + '<p class="show">A Few Good Men &middot; Bold Theatre</p>\n'
    + '<h1>' + esc(opts.heading) + '</h1>\n'
    + (opts.sub ? '<p class="sub">' + esc(opts.sub) + '</p>\n' : '')
    + '<div class="meta">' + opts.meta + '</div>\n'
    + '</header>\n'
    + opts.body
    + '<div class="foot"><span>' + esc(opts.footLeft) + '</span>'
    + '<span>Printed ' + esc(today()) + '</span></div>\n'
    + '</div>\n</body>\n</html>\n';
}

// ─── The Ace shopping list ───────────────────────────────────────────────────
// Grouped by category, because the categories already are the store: lumber at
// the back, hardware in the middle, paint at the counter. Default is what is
// still needed; ?all=1 prints everything.
function shoppingHtml(store, vocab, q) {
  const all = q && (q.all === '1' || q.all === 'true');
  const byArea = q && q.group === 'area';

  const items = store.items.slice();
  const wanted = items.filter((m) => m.status === 'Needed');
  const settled = items.filter((m) => m.status !== 'Needed');
  const rows = all ? items : wanted;

  const order = byArea
    ? [...new Set(items.map((m) => m.area || vocab.UNASSIGNED))].sort((a, b) => a.localeCompare(b))
    : vocab.CATEGORIES;
  const groups = bucket(rows,
    (m) => [byArea ? (m.area || vocab.UNASSIGNED) : (m.category || 'Other')],
    order, 'Uncategorised');

  // Costs are optional and, right now, nobody has entered any. Print the column
  // as a write-in rule rather than a column of blanks pretending to be data,
  // and only show a printed figure where one actually exists.
  const priced = rows.filter((m) => m.est_cost != null && m.est_cost !== '');
  const known = priced.reduce((t, m) => t + (Number(m.est_cost) * (Number(m.qty) || 1) || 0), 0);

  let body = '';
  if (!groups.length) {
    body += '<p class="lead">Nothing on the list needs buying right now.</p>\n';
  }

  for (const [name, list] of groups) {
    list.sort(byName('name'));
    body += '<h3>' + esc(name) + ' <span class="n">· ' + list.length
      + (list.length === 1 ? ' item' : ' items') + '</span></h3>\n';
    body += '<table><thead><tr>'
      + '<th class="c" style="width:28px">Got</th>'
      + '<th style="width:74px">Qty</th>'
      + '<th>Item</th>'
      + '<th style="width:1.5in">For</th>'
      + '<th style="width:88px">Price</th>'
      + '</tr></thead><tbody>\n';
    for (const m of list) {
      const ref = aceRef(m);
      const bits = [];
      if (has(m.notes)) bits.push(escLines(m.notes));
      if (ref) bits.push('<span class="ref">' + esc(ref) + '</span>');
      if (all && m.status !== 'Needed') bits.push('<span class="flag">' + esc(m.status) + '</span>');
      const cost = m.est_cost == null || m.est_cost === ''
        ? WRITE : '$' + esc(m.est_cost);
      body += '<tr>'
        + '<td class="c">' + BOX + '</td>'
        + '<td class="qty">' + esc(m.qty) + (has(m.unit) ? ' ' + esc(m.unit) : '') + '</td>'
        + '<td><span class="item">' + esc(m.name) + '</span>'
        + (bits.length ? '<span class="note">' + bits.join(' &nbsp;·&nbsp; ') + '</span>' : '')
        + '</td>'
        + '<td>' + esc(m.area === vocab.UNASSIGNED ? '—' : m.area) + '</td>'
        + '<td class="r">' + cost + '</td>'
        + '</tr>\n';
    }
    body += '</tbody></table>\n';
    body += '<p class="sum">' + esc(name) + ' subtotal ' + WRITE + '</p>\n';
  }

  if (groups.length) {
    body += '<div class="total"><span>Total</span>' + WRITE + '</div>\n';
    if (priced.length) {
      body += '<p class="sum">Estimates already on the list add up to $'
        + known.toFixed(2) + ' across ' + priced.length
        + (priced.length === 1 ? ' item' : ' items') + '.</p>\n';
    }
  }

  // The reason to carry the list is to not buy a second paint sprayer. Anything
  // already handled gets a short strip at the end, named, not just counted.
  if (!all && settled.length) {
    body += '<h2>Do not buy <span class="n">· already have it or already bought</span></h2>\n';
    body += '<table><thead><tr><th style="width:74px">Qty</th><th>Item</th>'
      + '<th style="width:1.4in">Status</th></tr></thead><tbody>\n';
    for (const m of settled.slice().sort(byName('name'))) {
      body += '<tr><td class="qty">' + esc(m.qty) + (has(m.unit) ? ' ' + esc(m.unit) : '')
        + '</td><td><span class="item">' + esc(m.name) + '</span></td>'
        + '<td><span class="flag">' + esc(m.status) + '</span></td></tr>\n';
    }
    body += '</tbody></table>\n';
  }

  const meta = '<span><b>' + rows.length + '</b> '
    + (rows.length === 1 ? 'line' : 'lines') + ' to buy</span>'
    + '<span><b>' + groups.length + '</b> '
    + (byArea ? 'set pieces' : 'departments') + '</span>'
    + (all ? '<span>Showing the whole list</span>'
      : '<span>' + settled.length + ' already handled, listed at the end</span>');

  return shell({
    title: 'Ace shopping list — A Few Good Men',
    barTitle: 'Shopping list',
    heading: 'Ace Shopping List',
    sub: all ? 'Every line on the materials list' : 'Everything the build still needs',
    meta,
    body,
    back: '/',
    footLeft: 'Tick it off as it goes in the cart. Write the price in as you go.',
    links: '<a href="' + (all ? '/print/shopping' : '/print/shopping?all=1') + '">'
      + (all ? 'Only what is needed' : 'Show the whole list') + '</a>'
      + '<a href="/print/shopping?' + (all ? 'all=1&' : '')
      + (byArea ? '' : 'group=area') + '">'
      + (byArea ? 'Group by department' : 'Group by set piece') + '</a>',
  });
}

// ─── The prop list the show runs on ──────────────────────────────────────────
// Four passes over the same props, because a props list is read four different
// ways: in running order during the show, as a preset before it, as a chase
// list in the weeks before, and alphabetically when someone asks "do we have
// a flask?". A prop in three scenes appears three times in the running order -
// that is the point of a running order.
// The stage manager's prop list. One line per prop, split into the two acts, with
// who handles it, which scenes it is in and the script pages. Deliberately no
// sourcing status: this is the copy that lives on the prop table and in the booth,
// where the only question is what the prop is, how many, and when it is needed.
function propsHtml(store, vocab, q) {
  const props = store.props.slice();
  const ACTS = vocab.PROP_ACTS || {};
  const order = vocab.PROP_SCENES || [];
  const pos = (s) => {
    const i = order.indexOf(s);
    return i === -1 ? 999 : i;
  };
  const sceneAct = (s) => ACTS[s] || ACTS[(order.find((k) => k.toLowerCase() === String(s).toLowerCase()) || '')] || 0;

  const who = (m) => (m.used_by || []).filter(has).join(', ') || '—';
  // Scenes of this prop that belong to the given act, printed in running order.
  const actScenes = (m, act) => (m.scenes || []).filter(has)
    .filter((s) => sceneAct(s) === act)
    .sort((a, b) => pos(a) - pos(b));
  // Anything typed into a scene field that is not a scene — a character name, a
  // guess — is kept and shown at the end rather than quietly dropped.
  const strayScenes = (m) => (m.scenes || []).filter(has).filter((s) => !sceneAct(s));

  const inAct = (act) => props
    .filter((m) => actScenes(m, act).length)
    .sort((a, b) => {
      const d = pos(actScenes(a, act)[0]) - pos(actScenes(b, act)[0]);
      return d || byName('item')(a, b);
    });

  const rows = (list, act) => {
    let out = '<table><thead><tr>'
      + '<th>Prop</th>'
      + '<th class="c" style="width:58px">How<br>many</th>'
      + '<th style="width:1.9in">Used by</th>'
      + '<th style="width:1.6in">Scene</th>'
      + '<th style="width:76px">Pages</th>'
      + '</tr></thead><tbody>\n';
    for (const m of list) {
      out += '<tr>'
        + '<td><span class="item">' + esc(m.item) + '</span>'
        + (has(m.notes) ? '<span class="note">' + escLines(m.notes) + '</span>' : '')
        + '</td>'
        + '<td class="c qty">' + esc(m.qty || 1) + '</td>'
        + '<td>' + esc(who(m)) + '</td>'
        + '<td>' + esc(actScenes(m, act).join(', ')) + '</td>'
        + '<td class="c">' + (has(m.pages) ? esc(m.pages) : WRITE) + '</td>'
        + '</tr>\n';
    }
    return out + '</tbody></table>\n';
  };

  const one = inAct(1);
  const two = inAct(2);
  const stray = props.filter((m) => strayScenes(m).length);
  const unplaced = props.filter((m) => !(m.scenes || []).filter(has).length);
  const borrowed = props.filter((m) => has(m.borrowed_from) || has(m.return_to));

  let body = '';

  body += '<h2>Act One <span class="n">· ' + one.length
    + (one.length === 1 ? ' prop' : ' props') + '</span></h2>\n';
  body += one.length ? rows(one, 1)
    : '<p class="lead">No props listed in an Act One scene yet.</p>\n';

  body += '<h2>Act Two <span class="n">· ' + two.length
    + (two.length === 1 ? ' prop' : ' props') + '</span></h2>\n';
  body += two.length ? rows(two, 2)
    : '<p class="lead">No props listed in an Act Two scene yet.</p>\n';

  // Everything the two act tables could not place, so a prop is never lost between them.
  if (stray.length || unplaced.length) {
    body += '<h2>Still to place <span class="n">· no act yet</span></h2>\n';
    body += '<table><thead><tr>'
      + '<th>Prop</th><th class="c" style="width:58px">How<br>many</th>'
      + '<th style="width:1.75in">Used by</th>'
      + '<th style="width:2.1in">What the scene says</th>'
      + '</tr></thead><tbody>\n';
    for (const m of [...stray, ...unplaced].sort(byName('item'))) {
      const said = strayScenes(m).join(', ');
      body += '<tr><td><span class="item">' + esc(m.item) + '</span></td>'
        + '<td class="c qty">' + esc(m.qty || 1) + '</td>'
        + '<td>' + esc(who(m)) + '</td>'
        + '<td>' + (said ? esc(said) : '<span class="flag open">No scene listed</span>')
        + '</td></tr>\n';
    }
    body += '</tbody></table>\n';
    body += '<p class="lead">Give each of these a scene on the props page and it moves '
      + 'into the act it belongs to.</p>\n';
  }

  // Borrowed things have to go home again. Prints only when something is borrowed.
  if (borrowed.length) {
    body += '<h2>Borrowed <span class="n">· where it came from, where it goes back</span></h2>\n';
    body += '<table><thead><tr><th>Prop</th>'
      + '<th style="width:2.3in">From</th><th style="width:2.3in">Return to</th>'
      + '</tr></thead><tbody>\n';
    for (const m of borrowed.slice().sort(byName('item'))) {
      body += '<tr>'
        + '<td><span class="item">' + esc(m.item) + '</span></td>'
        + '<td>' + (has(m.borrowed_from) ? esc(m.borrowed_from) : WRITE) + '</td>'
        + '<td>' + (has(m.return_to) ? esc(m.return_to) : WRITE) + '</td></tr>\n';
    }
    body += '</tbody></table>\n';
  }

  const meta = '<span><b>' + props.length + '</b> '
    + (props.length === 1 ? 'prop' : 'props') + '</span>'
    + '<span><b>' + one.length + '</b> in Act One</span>'
    + '<span><b>' + two.length + '</b> in Act Two</span>';

  return shell({
    title: 'Prop list — A Few Good Men',
    barTitle: 'Prop list',
    heading: 'Prop List',
    sub: 'Act One and Act Two · who handles it, which scene, which pages',
    meta,
    body,
    back: '/',
    footLeft: 'Within each act the props are in running order. A prop used in both acts '
      + 'is listed in both. Pages left blank are for the book.',
    links: '',
  });
}

module.exports = { shoppingHtml, propsHtml };
