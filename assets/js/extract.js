/* Reads a submission into the shared document model.
   PDF: pdf.js gives every text run with its position; runs are cut into words, words into lines and lines
   into paragraphs, so the report can draw highlights over the original page.
   Word, plain text and pasted text: the text is laid out on Letter pages with the Tinos typeface, and the
   report draws those pages itself. */
(function (root) {
  "use strict";
  var VT = root.VT = root.VT || {};
  var X = VT.extract = {};

  /* Advance widths (1/1000 em) of the printable ASCII characters in Times and Helvetica, used to place each
     word inside a pdf.js text run. Runs are rescaled to their measured width, so only proportions matter. */
  var TIMES = [250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541];
  var HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];

  function charWidth(ch, family) {
    var c = ch.charCodeAt(0);
    if (family === "mono") return 600;
    var table = family === "sans" ? HELV : TIMES;
    if (c >= 32 && c <= 126) return table[c - 32];
    if (/\s/.test(ch)) return table[0];
    if (c >= 0x2000 && c <= 0x206f) return family === "sans" ? 556 : 500;
    return family === "sans" ? 600 : 560;
  }

  function familyOf(style) {
    var f = ((style && style.fontFamily) || "").toLowerCase();
    if (/mono|courier/.test(f)) return "mono";
    if (/sans|arial|helvetica|calibri|verdana|segoe|roboto/.test(f)) return "sans";
    return "serif";
  }

  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[Math.floor(s.length / 2)];
  }

  function percentile(a, q) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
  }

  /* PDF ------------------------------------------------------------------------------------------- */

  X.fromPdf = async function (bytes, onProgress) {
    var lib = root.pdfjsLib;
    var task = lib.getDocument({ data: bytes.slice(0), isEvalSupported: false, verbosity: 0, disableFontFace: true });
    var pdf = await task.promise;
    var doc = { kind: "pdf", pages: [], words: [], lines: [], meta: {} };
    try {
      var md = await pdf.getMetadata();
      if (md && md.info) doc.meta = { title: md.info.Title || "", author: md.info.Author || "" };
    } catch (e) { /* no metadata */ }
    var para = -1, lastLineOfPrev = null;
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var vp = page.getViewport({ scale: 1 });
      var tc = await page.getTextContent();
      doc.pages.push({ width: vp.width, height: vp.height, rotate: page.rotate || 0, view: page.view.slice() });
      var lines = pageLines(lib, tc, vp, p - 1);
      para = assignParagraphs(lines, para, lastLineOfPrev);
      lines.forEach(function (L) {
        L.start = doc.words.length;
        L.words.forEach(function (w) { w.line = doc.lines.length; w.para = L.para; doc.words.push(w); });
        L.end = doc.words.length;
        delete L.words;
        doc.lines.push(L);
      });
      if (lines.length) lastLineOfPrev = lines[lines.length - 1];
      page.cleanup();
      if (onProgress) onProgress(p / pdf.numPages);
    }
    doc.pageCount = pdf.numPages;
    await pdf.destroy();
    return doc;
  };

  /* Turns one page's text runs into lines of words. */
  function pageLines(lib, tc, vp, pageIndex) {
    var lines = [], cur = null, pending = null;

    function flushWord() {
      if (pending && pending.raw.length) cur.words.push(pending);
      pending = null;
    }
    function newLine(base, size) {
      flushWord();
      cur = { page: pageIndex, base: base, size: size, words: [] };
      lines.push(cur);
    }

    tc.items.forEach(function (item) {
      if (typeof item.str !== "string") return;
      var str = item.str;
      if (!str.length) { if (item.hasEOL) flushWord(); return; }
      var tx = lib.Util.transform(vp.transform, item.transform);
      var size = Math.hypot(tx[2], tx[3]) || Math.abs(tx[3]) || 10;
      var angle = Math.atan2(tx[1], tx[0]);
      var rot = Math.abs(angle) > 0.05;
      var x = tx[4], base = tx[5];
      var style = tc.styles[item.fontName] || {};
      var asc = style.ascent, desc = style.descent;
      if (!(asc > 0.5 && asc < 1.5)) asc = 0.891;
      if (!(desc < 0 && desc > -0.6)) desc = -0.216;
      var fam = familyOf(style);
      var widths = [], total = 0;
      for (var i = 0; i < str.length; i++) { var cw = charWidth(str[i], fam); widths.push(cw); total += cw; }
      var runWidth = item.width > 0 ? item.width : total * size / 1000;
      var k = total > 0 ? runWidth / total : 0;

      if (!cur || Math.abs(base - cur.base) > 0.5 * Math.max(size, cur.size) || (cur.words.length && x < lastX1() - 2 * size)) {
        newLine(base, size);
      } else if (pending && x - pending.x1 > 0.18 * size) {
        flushWord();
      }
      var top = base - asc * size, bottom = base - desc * size;
      var pos = x;
      for (i = 0; i < str.length; i++) {
        var ch = str[i], w = widths[i] * k;
        if (/[\s\u00a0\u2002-\u200a\u3000]/.test(ch)) {
          flushWord();
        } else {
          if (!pending) pending = { raw: "", page: pageIndex, x0: pos, x1: pos, top: top, bottom: bottom, base: base, size: size, tiny: size < 1.5, rot: rot };
          pending.raw += ch;
          pending.x1 = pos + w;
          if (top < pending.top) pending.top = top;
          if (bottom > pending.bottom) pending.bottom = bottom;
        }
        pos += w;
      }
      if (size > cur.size) cur.size = size;
      if (item.hasEOL) flushWord();
    });
    flushWord();

    function lastX1() {
      var ws = cur.words;
      return pending ? pending.x1 : (ws.length ? ws[ws.length - 1].x1 : -1e9);
    }

    lines = lines.filter(function (L) { return L.words.length; });
    lines.forEach(function (L) {
      L.x0 = Math.min.apply(null, L.words.map(function (w) { return w.x0; }));
      L.x1 = Math.max.apply(null, L.words.map(function (w) { return w.x1; }));
      L.top = Math.min.apply(null, L.words.map(function (w) { return w.top; }));
      L.bottom = Math.max.apply(null, L.words.map(function (w) { return w.bottom; }));
    });
    return lines;
  }

  /* Paragraph breaks come from wide gaps between lines, short lines that end a sentence, first-line
     indents and changes of type size. A page break continues the paragraph unless the last line ended one. */
  function assignParagraphs(lines, para, prevPageLast) {
    if (!lines.length) return para;
    var full = lines.filter(function (L) { return L.words.length >= 5; });
    var left = percentile(full.map(function (L) { return L.x0; }), 0.1);
    var right = percentile(full.map(function (L) { return L.x1; }), 0.9);
    var width = Math.max(1, right - left);
    var gaps = [];
    for (var i = 1; i < lines.length; i++) {
      var g = lines[i].base - lines[i - 1].base;
      if (g > 0 && g < 2.2 * lines[i].size) gaps.push(g);
    }
    var pitch = median(gaps) || 0;
    lines.forEach(function (L, idx) {
      var prev = idx ? lines[idx - 1] : prevPageLast;
      var brk = !prev;
      if (prev) {
        var lastWord = prev.words ? prev.words[prev.words.length - 1].raw : prev.lastRaw;
        var endsSentence = /[.!?:]["'\u201d\u2019)]*$/.test(lastWord || "");
        var prevShort = prev.x1 < right - 0.15 * width;
        if (!idx) {
          brk = endsSentence || prevShort;
        } else {
          var gap = L.base - prev.base;
          var prevCount = prev.words.length;
          if (gap < 0 || gap > (pitch ? pitch * 1.35 + 1 : 1.9 * L.size)) brk = true;
          else if (prevShort && (endsSentence || prevCount <= 12)) brk = true;
          else if (Math.abs(L.size - prev.size) > 1.5) brk = true;
          else if (L.x0 > left + 1.2 * L.size && prev.x1 >= right - 0.15 * width && L.x0 - prev.x0 > 1.2 * L.size) brk = true;
        }
      }
      if (brk) para++;
      L.para = para;
    });
    var last = lines[lines.length - 1];
    last.lastRaw = last.words[last.words.length - 1].raw;
    return para;
  }

  /* Word, plain text and pasted text ---------------------------------------------------------------- */

  /* Blocks are {type: "h1" | "h2" | "h3" | "p" | "li", runs: [{text, b, i}]}. */
  X.blocksFromText = function (text) {
    text = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
    var parts = /\n\s*\n/.test(text) ? text.split(/\n\s*\n+/) : text.split(/\n/);
    var blocks = [];
    parts.forEach(function (part) {
      var t = part.replace(/\s*\n\s*/g, " ").trim();
      if (!t) return;
      var words = t.split(/\s+/).length;
      var heading = words <= 12 && !/[.,;:!?]$/.test(t) && (t === t.toUpperCase() && /[A-Z]/.test(t) || /^(\d+(\.\d+)*\.?|[IVX]+\.|Chapter|Section|Appendix)\s/i.test(t));
      if (/^[-*\u2022]\s+/.test(t)) blocks.push({ type: "li", runs: [{ text: t.replace(/^[-*\u2022]\s+/, "") }] });
      else blocks.push({ type: heading ? "h2" : "p", runs: [{ text: t, b: heading }] });
    });
    return blocks;
  };

  X.blocksFromHtml = function (html) {
    var dom = new DOMParser().parseFromString("<body>" + html + "</body>", "text/html");
    var blocks = [];
    function runsOf(node) {
      var runs = [];
      (function walk(n, b, i) {
        if (n.nodeType === 3) { if (n.nodeValue) runs.push({ text: n.nodeValue, b: b, i: i }); return; }
        if (n.nodeType !== 1) return;
        var tag = n.tagName.toLowerCase();
        if (tag === "br") { runs.push({ text: " ", b: b, i: i }); return; }
        var nb = b || tag === "strong" || tag === "b", ni = i || tag === "em" || tag === "i";
        for (var c = n.firstChild; c; c = c.nextSibling) walk(c, nb, ni);
      })(node, false, false);
      return runs;
    }
    function visit(el, listDepth) {
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
        var tag = c.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) blocks.push({ type: tag <= "h1" ? "h1" : (tag === "h2" ? "h2" : "h3"), runs: runsOf(c).map(function (r) { r.b = true; return r; }) });
        else if (tag === "p") blocks.push({ type: "p", runs: runsOf(c) });
        else if (tag === "ul" || tag === "ol") {
          var k = 0;
          for (var li = c.firstElementChild; li; li = li.nextElementSibling) {
            k++;
            var nested = li.querySelectorAll("ul,ol");
            var clone = li.cloneNode(true);
            clone.querySelectorAll("ul,ol").forEach(function (x) { x.remove(); });
            blocks.push({ type: "li", depth: listDepth, marker: tag === "ol" ? k + "." : "\u2022", runs: runsOf(clone) });
            nested.forEach(function (x) { visit({ firstElementChild: x }, listDepth + 1); });
          }
        } else if (tag === "table") {
          c.querySelectorAll("tr").forEach(function (tr) {
            var cells = [];
            tr.querySelectorAll("td,th").forEach(function (td) { cells.push(td.textContent.replace(/\s+/g, " ").trim()); });
            if (cells.join("").length) blocks.push({ type: "p", table: true, runs: [{ text: cells.join("   ") }] });
          });
        } else visit(c, listDepth);
      }
    }
    visit(dom.body, 0);
    return blocks.filter(function (b) { return b.runs.some(function (r) { return r.text.trim(); }); });
  };

  X.fromDocx = async function (arrayBuffer, fonts) {
    var res = await root.mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
    return X.layoutFlow(X.blocksFromHtml(res.value), fonts);
  };

  X.fromText = function (text, fonts) {
    return X.layoutFlow(X.blocksFromText(text), fonts);
  };

  /* Lays blocks out on Letter pages: one-inch margins, 12 pt Tinos with 1.5 line spacing. `fonts` maps
     R, B, I and BI to pdf-lib fonts used only to measure words. */
  X.layoutFlow = function (blocks, fonts) {
    var W = 612, H = 792, M = 72, maxX = W - M;
    var doc = { kind: "flow", pages: [], words: [], lines: [], meta: {} };
    var cache = new Map();
    function width(word, key, size) {
      var ck = key + size + "\u0000" + word;
      var v = cache.get(ck);
      if (v === undefined) {
        try { v = fonts[key].widthOfTextAtSize(word, size); } catch (e) { v = word.length * size * 0.5; }
        cache.set(ck, v);
      }
      return v;
    }
    var page = -1, y = 0;
    function newPage() { page++; doc.pages.push({ width: W, height: H, rotate: 0 }); y = M; }
    newPage();
    blocks.forEach(function (blk, bi) {
      var size = blk.type === "h1" ? 16 : blk.type === "h2" ? 14 : blk.type === "h3" ? 13 : 12;
      var leading = blk.type === "p" || blk.type === "li" ? 18 : size * 1.4;
      var before = blk.type[0] === "h" ? (bi ? 14 : 0) : 0;
      var after = blk.type[0] === "h" ? 6 : 8;
      var indent = blk.type === "li" ? 18 + 18 * (blk.depth || 0) : 0;
      y += before;
      var tokens = [];
      blk.runs.forEach(function (r) {
        var key = (r.b ? "B" : "") + (r.i ? "I" : "") || "R";
        var re = /\S+/g, m, s = r.text.replace(/[\u00a0\u2002-\u200a]/g, " ");
        var leadingSpace = /^\s/.test(s);
        while ((m = re.exec(s))) {
          var glue = m.index === 0 && !leadingSpace && tokens.length && !/\s$/.test(tokens[tokens.length - 1].after || " ");
          if (glue) { tokens[tokens.length - 1].parts.push({ text: m[0], key: key }); }
          else tokens.push({ parts: [{ text: m[0], key: key }] });
          tokens[tokens.length - 1].after = s.slice(m.index + m[0].length, m.index + m[0].length + 1);
        }
      });
      if (!tokens.length) return;
      var para = bi;
      var x = M + indent, lineWords = [];
      function flushLine() {
        if (!lineWords.length) return;
        if (y + leading > H - M) { newPage(); }
        var base = y + size;
        var L = { page: page, base: base, size: size, para: para, start: doc.words.length, x0: lineWords[0].x0, x1: lineWords[lineWords.length - 1].x1 };
        lineWords.forEach(function (w) {
          w.page = page; w.base = base; w.top = base - 0.891 * size; w.bottom = base + 0.216 * size;
          w.line = doc.lines.length; w.para = para;
          doc.words.push(w);
        });
        L.end = doc.words.length; L.top = base - 0.891 * size; L.bottom = base + 0.216 * size;
        doc.lines.push(L);
        y += leading;
        lineWords = [];
        x = M + indent;
      }
      if (blk.type === "li") {
        var marker = blk.marker || "\u2022";
        lineWords.push({ raw: marker, x0: M + indent - 14, x1: M + indent - 14 + width(marker, "R", size), size: size, parts: [{ text: marker, key: "R" }], marker: true });
      }
      tokens.forEach(function (tok) {
        var w = 0;
        tok.parts.forEach(function (pt) { pt.w = width(pt.text, pt.key, size); w += pt.w; });
        var space = width(" ", "R", size);
        var nonMarker = lineWords.filter(function (q) { return !q.marker; }).length;
        if (nonMarker && x + w > maxX) flushLine();
        var raw = tok.parts.map(function (pt) { return pt.text; }).join("");
        lineWords.push({ raw: raw, x0: x, x1: x + w, size: size, parts: tok.parts });
        x += w + space;
      });
      flushLine();
      y += after;
    });
    doc.pageCount = doc.pages.length;
    return doc;
  };
})(typeof self !== "undefined" ? self : globalThis);
