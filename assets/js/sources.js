/* Where the matcher looks.
   Internet: Wikipedia (full articles) and, with a key, Google Programmable Search.
   Publications: OpenAlex, Crossref, Europe PMC and Semantic Scholar (titles and abstracts).
   Submitted works: every earlier submission kept in this browser's repository, plus reference files.
   Searches use phrases taken from the submission, the way a crawler-backed index would be probed. */
(function (root) {
  "use strict";
  var VT = root.VT = root.VT || {};
  var R = VT.sources = {};

  R.DEFAULTS = {
    wikipedia: true, wikiLang: "en", openalex: true, crossref: true, europepmc: true, semanticscholar: true,
    repository: true, google: false, googleKey: "", googleCx: "", queries: 60
  };

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function getJson(url, timeout) {
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, timeout || 15000) : null;
    try {
      var res = await fetch(url, { signal: ctl ? ctl.signal : undefined, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally { if (t) clearTimeout(t); }
  }

  /* Runs tasks with limited concurrency and a minimum gap between starts. */
  async function pool(items, limit, gap, fn) {
    var out = new Array(items.length), next = 0, last = 0, errors = 0;
    async function worker() {
      while (next < items.length) {
        var i = next++;
        var wait = last + gap - Date.now();
        last = Math.max(Date.now(), last + gap);
        if (wait > 0) await sleep(wait);
        try { out[i] = await fn(items[i], i); } catch (e) { out[i] = null; errors++; }
      }
    }
    var ws = [];
    for (var k = 0; k < Math.min(limit, items.length); k++) ws.push(worker());
    await Promise.all(ws);
    if (items.length && errors === items.length) throw new Error("No response");
    return out;
  }

  function domainOf(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch (e) { return url; }
  }

  /* Query phrases: eight-word windows from sentences spread across the submission, choosing the window
     with the least common words, plus a keyword query built from the rarest words of every third
     sentence. */
  R.queries = function (doc, max) {
    var words = doc.words, cands = [];
    doc.sentences.forEach(function (s) {
      var toks = [];
      for (var i = s.start; i < s.end; i++) {
        var w = words[i];
        if (w.bib || !w.isWord) continue;
        if (/^[a-z][a-z'\-]*$/.test(w.n)) toks.push(w.n);
      }
      if (toks.length >= 8) cands.push(toks);
    });
    if (!cands.length) return { phrases: [], keywords: [] };
    var step = Math.max(1, cands.length / max), phrases = [], keywords = [];
    for (var x = 0; x < cands.length && phrases.length < max; x += step) {
      var toks = cands[Math.floor(x)], best = 0, bestScore = -1;
      for (var i = 0; i + 8 <= toks.length; i++) {
        var sc = 0;
        for (var k = i; k < i + 8; k++) sc += VT.text.STOPWORDS.has(toks[k]) ? 0 : Math.min(12, toks[k].length);
        if (sc > bestScore) { bestScore = sc; best = i; }
      }
      phrases.push(toks.slice(best, best + 8).join(" "));
      if (phrases.length % 3 === 1) {
        var rare = toks.filter(function (t) { return !VT.text.STOPWORDS.has(t) && t.length > 3; })
          .sort(function (a, b) { return b.length - a.length; }).slice(0, 6);
        if (rare.length >= 3) keywords.push(rare.join(" "));
      }
    }
    return { phrases: phrases, keywords: keywords };
  };

  /* Wikipedia ------------------------------------------------------------------------------------- */
  async function wikipedia(q, cfg, progress) {
    var lang = (cfg.wikiLang || "en").replace(/[^a-z\-]/g, "") || "en";
    var api = "https://" + lang + ".wikipedia.org/w/api.php";
    var searches = q.phrases.map(function (p) { return { q: "\"" + p + "\"", limit: 3 }; })
      .concat(q.keywords.map(function (k) { return { q: k, limit: 2 }; }));
    var titles = new Set();
    await pool(searches, 4, 120, async function (s) {
      var j = await getJson(api + "?action=query&list=search&format=json&origin=*&srlimit=" + s.limit + "&srsearch=" + encodeURIComponent(s.q));
      ((j.query && j.query.search) || []).forEach(function (r) { if (titles.size < 40) titles.add(r.title); });
      progress();
    });
    var pages = await pool(Array.from(titles), 4, 100, async function (title) {
      var j = await getJson(api + "?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*&titles=" + encodeURIComponent(title));
      var pg = j.query && j.query.pages, text = "";
      if (pg) Object.keys(pg).forEach(function (k) { text += pg[k].extract || ""; });
      return text ? { title: title, text: text } : null;
    });
    var host = lang + ".wikipedia.org";
    var texts = pages.filter(Boolean).map(function (p) { return p.title + ". " + p.text; });
    return texts.length ? [{ id: "web:" + host, type: "internet", title: host, url: "https://" + host + "/", texts: texts }] : [];
  }

  /* Google Programmable Search: a result for a quoted phrase means the page carries that phrase. */
  async function google(q, cfg, progress) {
    if (!cfg.googleKey || !cfg.googleCx) return [];
    var byDomain = new Map();
    await pool(q.phrases.slice(0, 90), 2, 250, async function (p) {
      var j = await getJson("https://www.googleapis.com/customsearch/v1?num=5&key=" + encodeURIComponent(cfg.googleKey) + "&cx=" + encodeURIComponent(cfg.googleCx) + "&q=" + encodeURIComponent("\"" + p + "\""));
      (j.items || []).forEach(function (it) {
        var d = (it.displayLink || domainOf(it.link)).toLowerCase();
        if (!byDomain.has(d)) byDomain.set(d, { id: "web:" + d, type: "internet", title: d, url: it.link, texts: [] });
        byDomain.get(d).texts.push(p + " . " + (it.title || "") + " . " + (it.snippet || ""));
      });
      progress();
    });
    return Array.from(byDomain.values());
  }

  /* OpenAlex: titles and abstracts (rebuilt from the inverted index). */
  async function openalex(q, cfg, progress) {
    var out = new Map();
    var searches = q.phrases.slice(0, 40).map(function (p) { return "\"" + p + "\""; }).concat(q.keywords.slice(0, 20));
    await pool(searches, 3, 120, async function (s) {
      var j = await getJson("https://api.openalex.org/works?per-page=5&select=id,doi,display_name,abstract_inverted_index&search=" + encodeURIComponent(s));
      (j.results || []).forEach(function (r) {
        if (out.has(r.id) || !r.display_name) return;
        var abs = "";
        if (r.abstract_inverted_index) {
          var arr = [];
          Object.keys(r.abstract_inverted_index).forEach(function (w) { r.abstract_inverted_index[w].forEach(function (pos) { arr[pos] = w; }); });
          abs = arr.filter(Boolean).join(" ");
        }
        out.set(r.id, { id: "pub:" + r.display_name.toLowerCase(), type: "publication", title: r.display_name, url: r.doi || r.id, texts: [r.display_name + ". " + abs] });
      });
      progress();
    });
    return Array.from(out.values());
  }

  async function crossref(q, cfg, progress) {
    var out = new Map();
    await pool(q.phrases.slice(0, 30).concat(q.keywords.slice(0, 10)), 2, 200, async function (s) {
      var j = await getJson("https://api.crossref.org/works?rows=5&select=DOI,title,abstract,URL&query.bibliographic=" + encodeURIComponent(s));
      ((j.message && j.message.items) || []).forEach(function (r) {
        var title = (r.title && r.title[0]) || "";
        if (!title || out.has(r.DOI)) return;
        var abs = (r.abstract || "").replace(/<[^>]+>/g, " ");
        out.set(r.DOI, { id: "pub:" + title.toLowerCase(), type: "publication", title: title, url: r.URL || ("https://doi.org/" + r.DOI), texts: [title + ". " + abs] });
      });
      progress();
    });
    return Array.from(out.values());
  }

  async function europepmc(q, cfg, progress) {
    var out = new Map();
    await pool(q.phrases.slice(0, 30), 3, 150, async function (p) {
      var j = await getJson("https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=5&query=" + encodeURIComponent("\"" + p + "\""));
      ((j.resultList && j.resultList.result) || []).forEach(function (r) {
        if (!r.title || out.has(r.id)) return;
        var abs = (r.abstractText || "").replace(/<[^>]+>/g, " ");
        out.set(r.id, { id: "pub:" + r.title.toLowerCase(), type: "publication", title: r.title.replace(/\.$/, ""), url: r.doi ? "https://doi.org/" + r.doi : "https://europepmc.org/article/" + r.source + "/" + r.id, texts: [r.title + " " + abs] });
      });
      progress();
    });
    return Array.from(out.values());
  }

  async function semanticscholar(q, cfg, progress) {
    var out = new Map();
    await pool(q.keywords.slice(0, 12).concat(q.phrases.slice(0, 8)), 1, 1100, async function (s) {
      var j = await getJson("https://api.semanticscholar.org/graph/v1/paper/search?limit=5&fields=title,abstract,url&query=" + encodeURIComponent(s));
      (j.data || []).forEach(function (r) {
        if (!r.title || out.has(r.paperId)) return;
        out.set(r.paperId, { id: "pub:" + r.title.toLowerCase(), type: "publication", title: r.title, url: r.url || "", texts: [r.title + ". " + (r.abstract || "")] });
      });
      progress();
    });
    return Array.from(out.values());
  }

  /* Merges sources that share an id (one domain, one title). */
  function merge(list) {
    var m = new Map();
    list.forEach(function (s) {
      if (!s) return;
      var cur = m.get(s.id);
      if (cur) cur.texts = cur.texts.concat(s.texts);
      else m.set(s.id, { id: s.id, type: s.type, title: s.title, url: s.url, texts: s.texts.slice(), tokenLists: s.tokenLists });
    });
    return Array.from(m.values());
  }
  R.merge = merge;

  /* Searches every enabled database. onStep(label, fraction) reports progress; errors in one database
     never stop the others. Returns {sources, log}. */
  R.collect = async function (doc, cfg, extra, onStep) {
    cfg = Object.assign({}, R.DEFAULTS, cfg || {});
    var q = R.queries(doc, cfg.queries);
    var jobs = [];
    if (cfg.wikipedia) jobs.push(["Wikipedia", wikipedia]);
    if (cfg.google && cfg.googleKey && cfg.googleCx) jobs.push(["Google Programmable Search", google]);
    if (cfg.openalex) jobs.push(["OpenAlex", openalex]);
    if (cfg.crossref) jobs.push(["Crossref", crossref]);
    if (cfg.europepmc) jobs.push(["Europe PMC", europepmc]);
    if (cfg.semanticscholar) jobs.push(["Semantic Scholar", semanticscholar]);
    var log = [], found = [];
    var totalCalls = Math.max(1, jobs.length * (q.phrases.length + q.keywords.length)), done = 0;
    function tick(name) { return function () { done++; if (onStep) onStep("Searching " + name, Math.min(1, done / totalCalls)); }; }
    await Promise.all(jobs.map(async function (job) {
      try {
        var got = await job[1](q, cfg, tick(job[0]));
        found = found.concat(got);
        log.push({ db: job[0], ok: true, count: got.length });
      } catch (e) {
        log.push({ db: job[0], ok: false, error: String(e && e.message || e) });
      }
    }));
    return { sources: merge(found.concat(extra || [])), log: log, queries: q };
  };

  /* Repository of earlier submissions (IndexedDB). ------------------------------------------------- */
  var DB = "turn-in-out", STORE = "submissions";
  function openDb() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined") return reject(new Error("No IndexedDB"));
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function tx(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode), store = t.objectStore(STORE), out;
        out = fn(store);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); db.close(); };
        t.onerror = function () { reject(t.error); db.close(); };
      });
    });
  }
  R.repoAll = function () {
    return tx("readonly", function (s) { return s.getAll(); }).catch(function () { return []; });
  };
  R.repoPut = function (rec) { return tx("readwrite", function (s) { return s.put(rec); }).catch(function () { return null; }); };
  R.repoDelete = function (id) { return tx("readwrite", function (s) { return s.delete(id); }).catch(function () { return null; }); };
  R.repoClear = function () { return tx("readwrite", function (s) { return s.clear(); }).catch(function () { return null; }); };

  /* A fingerprint of the submission's normalized words, so a document is never matched against an
     identical copy of itself. */
  R.contentKey = function (doc) {
    var h1 = 0x811c9dc5, h2 = 0x12345678;
    doc.words.forEach(function (w) {
      for (var i = 0; i < w.n.length; i++) { var c = w.n.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 0x01000193); h2 = Math.imul(h2 ^ c, 0x5bd1e995); }
      h1 ^= 32; h2 ^= 32;
    });
    return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  };

  /* Repository entries become "Submitted works" sources. */
  R.repoSources = function (records, skipKey) {
    return records.filter(function (r) { return r.key !== skipKey && r.tokens; }).map(function (r) {
      var when = new Date(r.date);
      var label = (r.institution || "Submitted to Turn In Out") + " on " + when.getFullYear() + "-" + String(when.getMonth() + 1).padStart(2, "0") + "-" + String(when.getDate()).padStart(2, "0");
      return { id: "sub:" + r.id, type: "submitted", title: label, url: "", texts: [], tokenLists: [r.tokens.split(" ")] };
    });
  };
})(typeof self !== "undefined" ? self : globalThis);
