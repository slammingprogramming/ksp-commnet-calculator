// SPDX-License-Identifier: AGPL-3.0-or-later
/* Interface language (KSPI18n).
 *
 * The app builds its screens from English text spread over many files, so instead of wrapping every string this module
 * translates what ends up on the page: it walks the text, the aria-labels, tooltips and placeholders, and swaps every text that
 * has a row in i18n-data.js for its translation, again whenever the app adds or changes something. Text that is not in the
 * catalogue (long explanations, anything with numbers or body and part names in it) stays English on purpose.
 *
 * The chosen language is a per-browser preference kept under its own key (`kspcomm.lang`), apart from the saved scenario,
 * so "Reset" does not change it. Choosing a language reloads the page, which keeps the code simple: nothing ever has to be
 * translated back. */
(function (root, factory) {
  const data = typeof module === 'object' && module.exports ? require('./i18n-data.js') : root.KSPI18nData;
  const api = factory(data);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.KSPI18n = api;
    if (typeof document !== 'undefined') api.init(document, root);
  }
})(typeof self !== 'undefined' ? self : this, function (data) {
  'use strict';
  const KEY = 'kspcomm.lang';
  const languages = data.languages;
  const tables = {};

  /** English text -> translated text for one language code (empty for English or an unknown code). */
  function table(code) {
    if (tables[code]) return tables[code];
    const col = languages.findIndex((l) => l.code === code);
    const t = new Map();
    if (col > 0) for (const row of data.rows) if (row[col]) t.set(row[0], row[col]);
    tables[code] = t;
    return t;
  }

  /** Translates one text: an exact match, else the same without a trailing colon or ellipsis (put back afterwards). */
  function translate(code, text) {
    if (typeof text !== 'string' || !text) return text;
    const t = table(code);
    if (!t.size) return text;
    const hit = t.get(text);
    if (hit !== undefined) return hit;
    const m = /^(.*?)([:：]?)$/.exec(text);
    if (m && m[2] && t.has(m[1])) return t.get(m[1]) + m[2];
    return text;
  }

  /** Translates a text node's value, keeping the spaces around it. */
  function translateSpaced(code, value) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
    if (!m[2]) return value;
    const out = translate(code, m[2]);
    return out === m[2] ? value : m[1] + out + m[3];
  }

  function isSupported(code) { return languages.some((l) => l.code === code); }

  function init(doc, win) {
    let code = 'en';
    try { const v = win.localStorage.getItem(KEY); if (v && isSupported(v)) code = v; } catch (e) { /* storage blocked: English */ }
    doc.documentElement.lang = code;

    const ATTRS = ['aria-label', 'title', 'placeholder'];
    const SKIP = /^(SCRIPT|STYLE|TEXTAREA|CANVAS|CODE|PRE)$/;
    const text = (node) => {
      const v = translateSpaced(code, node.nodeValue);
      if (v !== node.nodeValue) node.nodeValue = v;
    };
    const attrs = (el) => {
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v) continue;
        const out = translate(code, v);
        if (out !== v) el.setAttribute(a, out);
      }
    };
    const walk = (node) => {
      if (node.nodeType === 3) { if (!node.parentElement || !SKIP.test(node.parentElement.tagName)) text(node); return; }
      if (node.nodeType !== 1 || SKIP.test(node.tagName)) return;
      attrs(node);
      for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
    };

    // The picker is mounted before the first translation so its own label is translated too.
    const top = doc.querySelector('.top-inner');
    if (top) {
      const sel = doc.createElement('select');
      sel.id = 'lang';
      sel.className = 'lang';
      sel.setAttribute('aria-label', 'Language');
      sel.title = 'Language';
      for (const l of languages) { const o = doc.createElement('option'); o.value = l.code; o.textContent = l.name; sel.appendChild(o); }
      sel.value = code;
      sel.addEventListener('change', () => {
        try { win.localStorage.setItem(KEY, sel.value); } catch (e) { /* cannot be remembered */ }
        win.location.reload();
      });
      const reset = doc.getElementById('reset');
      const box = doc.createElement('div');
      box.className = 'top-tools';
      top.appendChild(box);
      box.appendChild(sel);
      if (reset) box.appendChild(reset);
    }

    if (code === 'en') return;
    walk(doc.body);
    if (typeof win.MutationObserver !== 'function') return;
    // Our own writes come back through here too, but a translated text is no catalogue key, so they end at once.
    new win.MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'childList') r.addedNodes.forEach(walk);
        else if (r.type === 'characterData') { if (r.target.parentElement && !SKIP.test(r.target.parentElement.tagName)) text(r.target); }
        else if (r.type === 'attributes') attrs(r.target);
      }
    }).observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  return { languages: languages, table: table, translate: translate, translateSpaced: translateSpaced, isSupported: isSupported, init: init, KEY: KEY };
});
