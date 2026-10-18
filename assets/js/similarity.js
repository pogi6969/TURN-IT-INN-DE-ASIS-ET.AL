/* Similarity matching.
   Every source is cut into overlapping five-word fingerprints. Words of the submission that sit inside a
   fingerprint shared with a source are matched to it. The overall similarity is the share of the
   submission's words matched to any source (overlaps counted once); the top-sources list hands each
   matched word to the strongest source first so overlapping sources are not counted twice; each run of
   words matched to one source is a match, sorted into four groups by quotation marks and citations. */
(function (root) {
  "use strict";
  var VT = root.VT = root.VT || {};
  var S = VT.sim = {};
  var N = 5;

  S.TYPES = { internet: "Internet", publication: "Publication", submitted: "Submitted works" };

  S.GROUPS = [
    { key: "ncq", label: "Not Cited or Quoted", desc: "Matches with neither in-text citation nor quotation marks" },
    { key: "mq", label: "Missing Quotations", desc: "Matches that are still very similar to source material" },
    { key: "mc", label: "Missing Citation", desc: "Matches that have quotation marks, but no in-text citation" },
    { key: "cq", label: "Cited and Quoted", desc: "Matches with in-text citation present, but no quotation marks" }
  ];

  function gramHash(toks, i) {
    return VT.text.hash(toks[i] + " " + toks[i + 1] + " " + toks[i + 2] + " " + toks[i + 3] + " " + toks[i + 4]);
  }

  /* opts: {excludeBib, excludeQuotes, minWords}. sources: [{id, type, title, url, texts: [string], tokens?: [string]}]. */
  S.compare = function (doc, sources, opts) {
    opts = opts || {};
    var words = doc.words;
    var tok = [], wordOf = [], excluded = [];
    words.forEach(function (w, i) {
      if (!w.isWord) return;
      tok.push(w.n);
      wordOf.push(i);
      excluded.push((opts.excludeBib && w.bib) || (opts.excludeQuotes && w.quoted));
    });
    var T = tok.length;

    // index every source fingerprint
    var index = new Map();
    sources.forEach(function (src, si) {
      var lists = src.tokenLists || (src.texts || []).map(VT.text.sourceTokens);
      lists.forEach(function (st) {
        for (var i = 0; i + N <= st.length; i++) {
          var h = gramHash(st, i), cur = index.get(h);
          if (cur === undefined) index.set(h, si);
          else if (typeof cur === "number") { if (cur !== si) index.set(h, [cur, si]); }
          else if (cur.indexOf(si) < 0) cur.push(si);
        }
      });
    });

    // mark submission words covered by each source
    var cover = sources.map(function () { return null; });
    for (var i = 0; i + N <= T; i++) {
      var hit = index.get(gramHash(tok, i));
      if (hit === undefined) continue;
      var list = typeof hit === "number" ? [hit] : hit;
      list.forEach(function (si) {
        var c = cover[si] || (cover[si] = new Uint8Array(T));
        for (var k = i; k < i + N; k++) c[k] = 1;
      });
    }

    // drop excluded words, runs below the minimum and runs made only of common words
    var minWords = Math.max(N, opts.minWords || 0);
    cover.forEach(function (c, si) {
      if (!c) return;
      for (var k = 0; k < T; k++) if (excluded[k]) c[k] = 0;
      var a = 0;
      while (a < T) {
        if (!c[a]) { a++; continue; }
        var b = a;
        while (b < T && c[b]) b++;
        var content = 0;
        for (var q = a; q < b; q++) if (!VT.text.STOPWORDS.has(tok[q]) && !/^\d+$/.test(tok[q])) content++;
        if (b - a < minWords || content < 2) for (q = a; q < b; q++) c[q] = 0;
        a = b;
      }
    });

    var union = new Uint8Array(T), byType = { internet: new Uint8Array(T), publication: new Uint8Array(T), submitted: new Uint8Array(T) };
    cover.forEach(function (c, si) {
      if (!c) return;
      var t = byType[sources[si].type] || byType.internet;
      for (var k = 0; k < T; k++) if (c[k]) { union[k] = 1; t[k] = 1; }
    });

    // greedy assignment: strongest remaining source takes its words first
    var assigned = new Int32Array(T).fill(-1), order = [];
    var alive = cover.map(function (c, si) { return c ? si : -1; }).filter(function (si) { return si >= 0; });
    while (alive.length) {
      var best = -1, bestCount = 0;
      alive.forEach(function (si) {
        var c = cover[si], n = 0;
        for (var k = 0; k < T; k++) if (c[k] && assigned[k] < 0) n++;
        if (n > bestCount) { bestCount = n; best = si; }
      });
      if (best < 0 || bestCount === 0) break;
      var c = cover[best];
      for (var k = 0; k < T; k++) if (c[k] && assigned[k] < 0) assigned[k] = best;
      order.push({ si: best, words: bestCount });
      alive = alive.filter(function (si) { return si !== best; });
    }

    var number = new Map();
    var list = order.map(function (o, j) {
      number.set(o.si, j + 1);
      var src = sources[o.si];
      return { n: j + 1, id: src.id, type: src.type, typeLabel: S.TYPES[src.type] || "Internet", title: src.title, url: src.url || "", words: o.words, pct: 100 * o.words / Math.max(1, T) };
    });

    // matches = runs of words given to one source
    var matches = [], groups = {};
    S.GROUPS.forEach(function (g) { groups[g.key] = { count: 0, words: 0 }; });
    var a2 = 0;
    while (a2 < T) {
      if (assigned[a2] < 0) { a2++; continue; }
      var si2 = assigned[a2], b2 = a2;
      while (b2 < T && assigned[b2] === si2) b2++;
      var quoted = 0, cited = 0;
      for (var q2 = a2; q2 < b2; q2++) { var w = words[wordOf[q2]]; if (w.quoted) quoted++; if (w.cited) cited++; }
      var isQ = quoted * 2 > b2 - a2, isC = cited * 2 > b2 - a2;
      var g = isQ ? (isC ? "cq" : "mc") : (isC ? "mq" : "ncq");
      groups[g].count++;
      groups[g].words += b2 - a2;
      matches.push({ source: number.get(si2), start: wordOf[a2], end: wordOf[b2 - 1] + 1, group: g, words: b2 - a2 });
      a2 = b2;
    }

    function share(arr) { var n = 0; for (var k = 0; k < T; k++) n += arr[k]; return 100 * n / Math.max(1, T); }
    var filtered = [];
    if (opts.excludeBib) filtered.push("Bibliography");
    if (opts.excludeQuotes) filtered.push("Quoted Text");
    if (opts.minWords && opts.minWords > N) filtered.push("Small Matches (less than " + opts.minWords + " words)");
    return {
      totalWords: T,
      overall: share(union),
      types: { internet: share(byType.internet), publication: share(byType.publication), submitted: share(byType.submitted) },
      sources: list,
      matches: matches,
      groups: S.GROUPS.map(function (gr) { return { key: gr.key, label: gr.label, desc: gr.desc, count: groups[gr.key].count, pct: 100 * groups[gr.key].words / Math.max(1, T) }; }),
      filtered: filtered
    };
  };

  /* Display rules from the reference report: whole percentages, and "<1%" for a source below one percent. */
  S.pct = function (x) { return Math.round(x) + "%"; };
  S.sourcePct = function (x) { return x > 0 && x < 1 ? "<1%" : Math.round(x) + "%"; };
})(typeof self !== "undefined" ? self : globalThis);
