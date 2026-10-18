/* AI writing detection.
   Like the reference reports, the document is cut into qualifying prose sentences (headings, tables,
   lists of figures, the bibliography and fragments are left out), each sentence is scored in the context
   of overlapping windows of neighbouring sentences, and the percentage is the share of qualifying words in
   sentences scored as likely AI-generated.
   The score comes from a logistic model over stylometric signals that separate model-written prose from
   human prose: how predictable the vocabulary is, how uniform sentence lengths are (burstiness), stock
   transitions and phrases, list rhythm, citations, numbers, contractions and so on. */
(function (root) {
  "use strict";
  var VT = root.VT = root.VT || {};
  var A = VT.ai = {};

  var RANK = null;
  function rankOf(w) {
    if (!RANK) {
      RANK = new Map();
      (VT.wordlist || "").split(" ").forEach(function (x, i) { if (!RANK.has(x)) RANK.set(x, i + 1); });
    }
    var r = RANK.get(w);
    if (r === undefined && w.length > 4) {
      var stem = w.replace(/(ies|es|s|ed|ing|ly)$/, "");
      r = RANK.get(stem) || RANK.get(stem + "e") || RANK.get(w.replace(/ies$/, "y"));
    }
    return r;
  }

  var AI_LEXICON = new Set(("delve delves delving crucial pivotal comprehensive robust seamless seamlessly leverage leverages leveraging utilize utilizes utilizing " +
    "utilization facilitate facilitates facilitating foster fosters fostering enhance enhances enhancing enhanced ensure ensures ensuring underscore underscores " +
    "underscoring highlight highlights highlighting showcase showcases showcasing notably additionally furthermore moreover consequently ultimately overall " +
    "essential vital significant significantly various diverse numerous intricate multifaceted nuanced landscape realm tapestry paramount fundamental " +
    "fundamentally strictly precisely rigorous rigorously thorough thoroughly effectively efficiently specifically particularly primarily predicated inherent " +
    "inherently dynamic holistic integrate integrates integrating integration streamline streamlined optimal optimize optimizing insights valuable align " +
    "aligns aligned alignment enabling empower empowers empowering navigate navigating evolving commitment testament serves underlying framework frameworks " +
    "structured systematically systematic accordingly thereby wherein crucially critical critically core key ensures robustness scalability substantial " +
    "substantially distinct distinctly explicit explicitly accurate accurately reliable reliably objective objectives emphasize emphasizes emphasizing " +
    "comprehensively represent represents representing facilitated incorporate incorporates incorporating encompass encompasses encompassing establish " +
    "establishes established demonstrate demonstrates demonstrating indicate indicates indicating respective respectively thus hence therefore " +
    "furthermore additionally methodology methodological pertinent subsequent subsequently prerequisite").split(" "));

  var TRANSITIONS = /^(however|moreover|additionally|furthermore|consequently|thus|therefore|hence|overall|ultimately|notably|specifically|instead|accordingly|similarly|importantly|crucially|meanwhile|nevertheless|nonetheless|conversely|finally|first|second|third|lastly|in\s+addition|in\s+contrast|by\s+contrast|on\s+the\s+other\s+hand|as\s+a\s+result|in\s+summary|in\s+conclusion|to\s+this\s+end|for\s+example|for\s+instance|in\s+particular|in\s+practice|in\s+essence|taken\s+together|together|because|while|although|under|by|through|using|based\s+on|according\s+to|regardless|despite|due\s+to)\b/i;
  var STOCK = /\b(plays?\s+an?\s+(crucial|vital|key|pivotal|important|significant)\s+role|it\s+is\s+(important|essential|crucial|worth)\s+(to\s+note|noting)|serves\s+as|a\s+testament\s+to|in\s+today'?s|ever-?(evolving|changing)|not\s+only\b.*\bbut\s+also|in\s+order\s+to|a\s+wide\s+range\s+of|a\s+variety\s+of|in\s+terms\s+of|with\s+respect\s+to|the\s+fact\s+that|in\s+accordance\s+with|as\s+well\s+as|rather\s+than|such\s+as|both\b.*\band\b|is\s+designed\s+to|aims?\s+to|allows?\s+(for|us|the)|enables?\b|provides?\s+a)\b/gi;
  var HEDGE = new Set("may might could can often typically generally usually potentially likely possibly tend tends".split(" "));
  var BE = new Set("is are was were be been being".split(" "));
  var CONTRACTION = /\w(n't|'re|'ll|'ve|'d|'m)$|^(it|that|there|what|he|she|let|who|here)'s$/i;

  function isAlpha(n) { return /^[a-z][a-z'\-]*$/.test(n); }

  /* Which sentences carry qualifying prose. */
  A.qualifying = function (doc) {
    var words = doc.words, paraSents = new Map();
    doc.sentences.forEach(function (s) { paraSents.set(s.para, (paraSents.get(s.para) || 0) + 1); });
    return doc.sentences.map(function (s) {
      var n = 0, alpha = 0, sym = 0, raw = "";
      for (var i = s.start; i < s.end; i++) {
        var w = words[i];
        if (w.bib) return false;
        raw += w.raw + " ";
        if (!w.isWord) { if (/[=<>+\u2211\u222b\u2208\u2264\u2265\u00d7]/.test(w.raw)) sym++; continue; }
        n++;
        if (isAlpha(w.n)) alpha++;
      }
      if (n < 5) return false;
      if (/(\u2026|\.{4,}|\u00b7{4,})/.test(raw)) return false;
      if (alpha / n < 0.6 || sym > n * 0.25) return false;
      var last = words[s.end - 1].raw;
      if (paraSents.get(s.para) === 1 && n <= 10 && !/[.!?:;]["'\u201d)]*$/.test(last)) return false;
      return true;
    });
  };

  function sentenceStats(doc, s) {
    var words = doc.words, toks = [], raws = [];
    for (var i = s.start; i < s.end; i++) { if (words[i].isWord) { toks.push(words[i].n); raws.push(words[i].raw); } }
    var text = raws.join(" ");
    var n = toks.length || 1, alpha = 0, lr = 0, rare = 0, unk = 0, ai = 0, digit = 0, first = 0, we = 0, contr = 0, wlen = 0, long = 0,
      passive = 0, func = 0, hedge = 0, upper = 0, sym = 0;
    toks.forEach(function (t, k) {
      if (isAlpha(t)) {
        alpha++;
        var r = rankOf(t);
        lr += Math.log(r || 60000);
        if (!r || r > 8000) rare++;
        if (!r && raws[k] === raws[k].toLowerCase()) unk++;
        wlen += t.length;
        if (t.length >= 9) long++;
      }
      if (AI_LEXICON.has(t)) ai++;
      if (/\d/.test(t)) digit++;
      if (t === "i" || t === "me" || t === "my") first++;
      if (t === "we" || t === "our" || t === "us") we++;
      if (CONTRACTION.test(t.replace(/\u2019/g, "'"))) contr++;
      if (VT.text.STOPWORDS.has(t)) func++;
      if (HEDGE.has(t)) hedge++;
      if (BE.has(t) && k + 1 < toks.length && /(ed|en)$/.test(toks[k + 1])) passive++;
      if (k > 0 && /^[A-Z]/.test(raws[k])) upper++;
      if (/[^\p{L}\p{N}'\-.,;:!?()"\u201c\u201d\u2019\u2018\[\]%]/u.test(raws[k])) sym++;
    });
    var a = alpha || 1;
    var stock = (text.match(STOCK) || []).length;
    return {
      len: Math.log(1 + n), words: n,
      logrank: lr / a, rare: rare / a, unk: unk / a, wlen: wlen / a, long: long / a,
      ai: ai / n, stock: stock / n, trans: TRANSITIONS.test(text) ? 1 : 0,
      comma: (text.match(/,/g) || []).length / n, triad: /\w+, (?:\w+ ){0,3}\w+,? (and|or) \w+/.test(text) ? 1 : 0,
      digit: digit / n, cite: s.cited ? 1 : 0, paren: (text.match(/[()]/g) || []).length / n,
      first: first / n, we: we / n, contr: contr / n, passive: passive / n, func: func / n,
      semi: (text.match(/[;:]/g) || []).length / n, dash: (text.match(/[\u2014\u2013]|\s-\s/g) || []).length / n,
      question: /\?["'\u201d)]*$/.test(text) ? 1 : 0, thisStart: /^(this|these|such|that|it|those|its)\b/i.test(text) ? 1 : 0,
      hedge: hedge / n, upper: upper / n, sym: sym / n, toks: toks
    };
  }

  A.FEATURES = ["len", "logrank", "rare", "unk", "wlen", "long", "ai", "stock", "trans", "comma", "triad", "digit", "cite", "paren", "first",
    "we", "contr", "passive", "func", "semi", "dash", "question", "thisStart", "hedge", "upper", "sym", "wLenSd", "wLogrankSd", "wTtr", "wAi", "wDigit", "wCite"];

  /* Feature vectors for every qualifying sentence: its own signals averaged over a window of up to two
     qualifying sentences on each side, plus window-level burstiness and vocabulary spread. */
  A.featureRows = function (doc, qual) {
    var idx = [], stats = [];
    doc.sentences.forEach(function (s, k) { if (qual[k]) { idx.push(k); stats.push(sentenceStats(doc, s)); } });
    var rows = stats.map(function (st, j) {
      var lo = Math.max(0, j - 2), hi = Math.min(stats.length, j + 3), win = stats.slice(lo, hi);
      var row = {};
      ["len", "logrank", "rare", "unk", "wlen", "long", "ai", "stock", "trans", "comma", "triad", "digit", "cite", "paren", "first", "we", "contr",
        "passive", "func", "semi", "dash", "question", "thisStart", "hedge", "upper", "sym"].forEach(function (f) {
        row[f] = 0.5 * st[f] + 0.5 * mean(win.map(function (x) { return x[f]; }));
      });
      row.wLenSd = sd(win.map(function (x) { return x.words; })) / (mean(win.map(function (x) { return x.words; })) || 1);
      row.wLogrankSd = sd(win.map(function (x) { return x.logrank; }));
      var all = [];
      win.forEach(function (x) { all = all.concat(x.toks); });
      row.wTtr = all.length ? new Set(all).size / Math.sqrt(all.length) : 0;
      row.wAi = mean(win.map(function (x) { return x.ai; }));
      row.wDigit = mean(win.map(function (x) { return x.digit; }));
      row.wCite = mean(win.map(function (x) { return x.cite; }));
      return row;
    });
    return { sentences: idx, rows: rows, stats: stats };
  };

  function mean(a) { if (!a.length) return 0; var s = 0; a.forEach(function (x) { s += x; }); return s / a.length; }
  function sd(a) { if (a.length < 2) return 0; var m = mean(a), s = 0; a.forEach(function (x) { s += (x - m) * (x - m); }); return Math.sqrt(s / a.length); }

  /* Logistic model. Means and spreads standardize each feature; weights were fitted on sentence-level
     labels from a reference report and kept small so no single signal decides a sentence. */
  A.MODEL = {
    mu: [2.843366, 5.786847, 0.158235, 0.029478, 5.387677, 0.160733, 0.010318, 0.002493, 0.070566, 0.056737, 0.121534, 0.051056, 0.089136, 0.052761, 0.000536, 0.00129, 0.000393, 0.014503, 0.350995, 0.011695, 0.000759, 0.012071, 0.052948, 0.004829, 0.064893, 0.005343, 0.413821, 0.64735, 7.419998, 0.010316, 0.051065, 0.089136],
    sd: [0.369188, 0.63942, 0.081486, 0.033639, 0.680219, 0.081628, 0.01941, 0.007755, 0.169046, 0.04757, 0.216116, 0.05096, 0.200563, 0.071489, 0.006068, 0.005948, 0.002796, 0.021374, 0.085583, 0.023824, 0.005767, 0.092138, 0.141966, 0.011352, 0.077505, 0.01869, 0.151484, 0.306604, 1.022753, 0.014572, 0.040175, 0.162852],
    w: [-0.0218, 0.3678, -0.1672, -0.0352, 0.3217, 0.0904, 0.0374, -0.0096, 0.2127, -0.1923, 0.0224, -0.0994, -0.1742, -0.32, -0.3, 0.0, -0.3, 0.0726, -0.3579, -0.0748, 0.1607, -0.15, 0.1342, -0.0557, 0.0269, -0.1005, -0.3246, -0.2807, 0.5823, 0.4128, 0.0268, -0.4548],
    bias: -1.4117,
    threshold: 0.45
  };

  function score(row) {
    var M = A.MODEL, z = M.bias;
    A.FEATURES.forEach(function (f, i) { z += M.w[i] * ((row[f] - M.mu[i]) / (M.sd[i] || 1)); });
    return 1 / (1 + Math.exp(-z));
  }

  /* Runs the detector. Returns the percentage, the number of AI-generated segments, the flagged word
     ranges and the qualifying word count. */
  A.detect = function (doc) {
    var qual = A.qualifying(doc);
    var fr = A.featureRows(doc, qual);
    var raw = fr.rows.map(score);
    var smooth = raw.map(function (p, j) {
      var a = raw[j - 1], b = raw[j + 1];
      var s = p * 2, w = 2;
      if (a !== undefined) { s += a; w++; }
      if (b !== undefined) { s += b; w++; }
      return s / w;
    });
    var total = 0, flaggedWords = 0, flagged = [];
    fr.sentences.forEach(function (k, j) {
      var n = fr.stats[j].words;
      total += n;
      if (smooth[j] >= A.MODEL.threshold) { flaggedWords += n; flagged.push(k); }
    });
    var segments = [], prev = -2;
    flagged.forEach(function (k) {
      var s = doc.sentences[k];
      if (k === prev + 1 && segments.length) segments[segments.length - 1].end = s.end;
      else segments.push({ start: s.start, end: s.end });
      prev = k;
    });
    var pct = total ? (100 * flaggedWords / total) : 0;
    var enough = total >= 300;
    return {
      enough: enough,
      qualifyingWords: total,
      aiWords: flaggedWords,
      percent: enough ? Math.round(pct) : null,
      exact: pct,
      hidden: enough && Math.round(pct) > 0 && Math.round(pct) < 20,
      segments: segments,
      sentenceScores: fr.sentences.map(function (k, j) { return { sentence: k, score: smooth[j] }; })
    };
  };
})(typeof self !== "undefined" ? self : globalThis);
