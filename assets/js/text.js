/* Text model shared by every engine: tokens, sentences, paragraphs, quotation and citation detection,
   the bibliography, and the integrity flags (replaced characters and hidden text).
   A document is a list of words in reading order. Each word keeps its raw text, a normalized form for
   matching, and where it sits on the page so the reports can highlight it. */
(function (root) {
  "use strict";
  var VT = root.VT = root.VT || {};
  var T = VT.text = {};

  /* Letters from other alphabets that look like Latin letters. A word that mixes them with Latin letters
     is flagged as "Replaced Characters", and the letters are swapped back before matching. */
  var HOMOGLYPHS = {
    "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0443": "y", "\u0445": "x",
    "\u0456": "i", "\u0458": "j", "\u0455": "s", "\u0501": "d", "\u04bb": "h", "\u04cf": "l", "\u0261": "g",
    "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041a": "K", "\u041c": "M", "\u041d": "H", "\u041e": "O",
    "\u0420": "P", "\u0421": "C", "\u0422": "T", "\u0425": "X", "\u0423": "Y", "\u0406": "I", "\u0408": "J",
    "\u0405": "S", "\u03bf": "o", "\u039f": "O", "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0396": "Z",
    "\u0397": "H", "\u0399": "I", "\u039a": "K", "\u039c": "M", "\u039d": "N", "\u03a1": "P", "\u03a4": "T",
    "\u03a5": "Y", "\u03a7": "X", "\u03b1": "a", "\u03bd": "v", "\u0131": "i", "\u0578": "n", "\u057d": "u"
  };
  T.HOMOGLYPHS = HOMOGLYPHS;
  var HIDDEN_CHARS = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;
  var LATIN = /[A-Za-z]/;

  T.STOPWORDS = new Set(("a about above after again against all am an and any are as at be because been before being below between both but by " +
    "can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its " +
    "itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the " +
    "their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why " +
    "will with would you your yours yourself yourselves also may might must shall upon via per et al").split(" "));

  var ABBREVIATIONS = new Set(("al e.g i.e etc vs cf fig figs eq eqs no nos vol pp p dr mr mrs ms prof sr jr st jan feb mar apr jun jul aug sep sept oct nov dec " +
    "inc ltd co corp dept est approx ca ed eds rev univ sec ch art n.d").split(" "));

  /* Normalized form used for matching: lower case, look-alike letters swapped back, hidden characters and
     surrounding punctuation removed. Returns "" for tokens that are only punctuation. */
  T.normalize = function (raw) {
    var s = raw.replace(HIDDEN_CHARS, "");
    s = T.fixHomoglyphs(s);
    s = s.normalize("NFKC").toLowerCase();
    s = s.replace(/[\u2018\u2019\u02bc`]/g, "'").replace(/[\u2010-\u2015]/g, "-");
    s = s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    return s;
  };

  T.fixHomoglyphs = function (s) {
    if (!LATIN.test(s)) return s;
    var out = "";
    for (var i = 0; i < s.length; i++) out += HOMOGLYPHS[s[i]] || s[i];
    return out;
  };

  /* Characters inside a word that a reader would not see: hidden characters between letters, or look-alike
     letters from another alphabet mixed into a Latin word. */
  T.wordFlags = function (raw) {
    var flags = 0;
    var core = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (/\p{L}[\u00ad\u200b-\u200f\u2060-\u2064\ufeff]+\p{L}/u.test(core)) flags |= 1;
    if (LATIN.test(core)) {
      for (var i = 0; i < core.length; i++) if (HOMOGLYPHS[core[i]]) { flags |= 2; break; }
    }
    return flags;
  };

  T.isWord = function (raw) { return /[\p{L}\p{N}]/u.test(raw); };

  /* Splits a run of text into raw tokens separated by white space, with their character offsets. */
  T.splitTokens = function (s) {
    var out = [], re = /[^\s\u00a0\u2002-\u200a\u3000]+/g, m;
    while ((m = re.exec(s))) out.push({ raw: m[0], start: m.index, end: m.index + m[0].length });
    return out;
  };

  function endsSentence(raw, next) {
    var s = raw.replace(/["'\u201d\u2019)\]]+$/, "");
    if (!/[.!?]$/.test(s)) return false;
    if (/[!?]$/.test(s)) return true;
    var core = s.slice(0, -1).toLowerCase().replace(/^[("'\u201c\u2018[]+/, "");
    if (ABBREVIATIONS.has(core)) return false;
    if (/^[a-z]$/i.test(core) && next && /^[A-Z]/.test(next)) return false;
    if (/^\d+(\.\d+)*$/.test(core) && next && /^[a-z]/.test(next)) return false;
    if (/\.\w+$/.test(core) && /^(e\.g|i\.e|n\.d|u\.s|u\.k|a\.m|p\.m)$/i.test(core)) return false;
    if (next && /^[a-z]/.test(next)) return false;
    return true;
  }

  /* Builds sentences, quotation state, citations and the bibliography for a document whose words already
     carry raw text and paragraph numbers. */
  T.analyze = function (doc) {
    var words = doc.words, n = words.length, i;
    for (i = 0; i < n; i++) {
      var w = words[i];
      w.n = T.normalize(w.raw);
      w.isWord = w.n.length > 0;
      w.flag = T.wordFlags(w.raw) | (w.tiny ? 4 : 0);
    }
    // sentences
    var sentences = [], start = 0;
    for (i = 0; i < n; i++) {
      var last = i === n - 1;
      var paraBreak = !last && words[i + 1].para !== words[i].para;
      if (last || paraBreak || endsSentence(words[i].raw, words[i + 1].raw)) {
        sentences.push({ start: start, end: i + 1, para: words[start].para });
        start = i + 1;
      }
    }
    sentences.forEach(function (s, k) { for (var j = s.start; j < s.end; j++) words[j].sent = k; });
    doc.sentences = sentences;
    markQuotes(doc);
    markCitations(doc);
    doc.bib = findBibliography(doc);
    for (i = 0; i < n; i++) words[i].bib = doc.bib && i >= doc.bib.start && i < doc.bib.end;
    doc.wordCount = 0;
    for (i = 0; i < n; i++) if (words[i].isWord) doc.wordCount++;
    doc.flags = collectFlags(doc);
    return doc;
  };

  /* Quotation marks: a word is quoted when it sits between an opening and a closing double quotation mark
     (straight or curly) inside one paragraph. Curly single quotes count too when they wrap whole words. */
  function markQuotes(doc) {
    var words = doc.words, open = -1, para = -1, kind = "";
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      w.quoted = false;
      if (w.para !== para) { open = -1; para = w.para; }
      var raw = w.raw;
      var opens = /^[(\[]*["\u201c\u00ab]/.test(raw) ? "d" : (/^[(\[]*\u2018/.test(raw) ? "s" : "");
      var closes = /["\u201d\u00bb][.,;:!?)\]]*$/.test(raw) ? "d" : (/\u2019[.,;:!?)\]]*$/.test(raw) && !/\w\u2019\w*$/.test(raw.replace(/[.,;:!?)\]]+$/, "")) ? "s" : "");
      if (open < 0 && opens) { open = i; kind = opens; }
      if (open >= 0) w.quoted = true;
      if (open >= 0 && closes === kind && (i > open || raw.replace(/[^"\u201c\u201d\u2018\u2019]/g, "").length >= 2)) open = -1;
      if (open >= 0 && i - open > 400) open = -1;
    }
  }

  var CITE_PATTERNS = [
    /\((?:see\s+|e\.g\.,?\s+|cf\.\s+)?[\p{Lu}][\p{L}'\u2019\-]+(?:\s+(?:et\s+al\.?|and|&)\s*(?:[\p{Lu}][\p{L}'\u2019\-]+)?)?,?\s+(?:\d{4}[a-z]?|n\.d\.)/u,
    /[\p{Lu}][\p{L}'\u2019\-]+(?:\s+(?:et\s+al\.?|and|&)\s+[\p{Lu}]?[\p{L}'\u2019\-]*)?\s*\((?:\d{4}[a-z]?|n\.d\.)/u,
    /\[\d+(?:\s*[,\u2013\-]\s*\d+)*\]/,
    /\(\d{4}[a-z]?(?:,\s*(?:p|pp)\.\s*\d+)?\)/,
    /\((?:[\p{Lu}][\p{L}\-]+\s+)*\[[A-Z]{2,}\],\s*\d{4}\)/u
  ];

  /* In-text citations: a sentence that carries an author-year or numbered citation marks all its words as
     cited. */
  function markCitations(doc) {
    var words = doc.words;
    doc.sentences.forEach(function (s) {
      var text = "";
      for (var j = s.start; j < s.end; j++) text += words[j].raw + " ";
      var cited = CITE_PATTERNS.some(function (re) { return re.test(text); });
      s.cited = cited;
      for (j = s.start; j < s.end; j++) words[j].cited = cited;
    });
  }

  var BIB_HEAD = /^(?:[0-9IVX]+\.?\s*)?(references?|bibliography|works\s+cited|literature\s+cited|reference\s+list|sources\s+cited|list\s+of\s+references|references\s+cited)\s*:?$/i;
  var AFTER_BIB = /^(?:appendi(?:x|ces)\b|annex\b|ethics\s+statement|acknowledg|about\s+the\s+author|author\s+biograph|curriculum\s+vitae|glossary)/i;

  /* The bibliography starts at the last "References"-style heading that stands on its own line in the
     back half of the document and runs until an appendix-style heading or the end. */
  function findBibliography(doc) {
    var lines = doc.lines || [];
    var words = doc.words, found = null;
    for (var k = lines.length - 1; k >= 0; k--) {
      var L = lines[k];
      var text = lineText(doc, L).trim();
      if (!BIB_HEAD.test(text)) continue;
      if (L.start < words.length * 0.3) continue;
      found = { start: L.end, end: words.length };
      break;
    }
    if (!found) return null;
    for (var j = 0; j < lines.length; j++) {
      var M = lines[j];
      if (M.start < found.start) continue;
      var t = lineText(doc, M).trim();
      if (AFTER_BIB.test(t) && t.split(/\s+/).length <= 14 && !/[.,;]$/.test(t)) { found.end = M.start; break; }
    }
    return found.end > found.start ? found : null;
  }

  function lineText(doc, L) {
    var s = "";
    for (var i = L.start; i < L.end; i++) s += doc.words[i].raw + " ";
    return s;
  }
  T.lineText = lineText;

  function collectFlags(doc) {
    var groups = { 1: [], 2: [], 4: [] };
    doc.words.forEach(function (w, i) { [1, 2, 4].forEach(function (b) { if (w.flag & b) groups[b].push(i); }); });
    var out = [];
    function pages(list) { var s = new Set(); list.forEach(function (i) { s.add(doc.words[i].page); }); return s.size; }
    if (groups[2].length) out.push({ type: "Replaced Characters", count: groups[2].length, pages: pages(groups[2]), words: groups[2],
      desc: "Letters are swapped with similar characters from another alphabet." });
    var hidden = groups[1].concat(groups[4]);
    if (hidden.length) out.push({ type: "Hidden Text", count: hidden.length, pages: pages(hidden), words: hidden,
      desc: "Text is altered to blend into the white background of the document." });
    return out;
  }

  T.countChars = function (doc) {
    var c = 0;
    doc.words.forEach(function (w) { c += w.raw.length; });
    return c + Math.max(0, doc.words.length - 1);
  };

  /* Simple 32-bit string hash (FNV-1a) used for word n-gram fingerprints. */
  T.hash = function (s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  };

  /* Tokenizes plain source text (a web page, an abstract) into normalized words for matching. */
  T.sourceTokens = function (text) {
    var out = [];
    T.splitTokens(text).forEach(function (t) { var n = T.normalize(t.raw); if (n) out.push(n); });
    return out;
  };
})(typeof self !== "undefined" ? self : globalThis);
