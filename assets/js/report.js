/* Report PDFs, laid out on the same grid as the reference reports.
   Similarity report: Cover Page, Integrity Overview (score, filters, match groups, top sources, integrity
   flags), the numbered source list, then every page of the submission with colour-coded highlights and
   source numbers in the margin.
   AI writing report: Cover Page, AI Writing Overview, then every page of the submission with the likely
   AI-generated text highlighted.
   All measurements are PDF points on a 612 x 792 page, written top-down and converted when drawn. */
(function (root) {
  "use strict";
  var VT = root.VT = root.VT || {};
  var P = VT.report = {};

  var PAGE_W = 612, PAGE_H = 792;
  var INK = [0.098, 0.098, 0.098], INK_ID = [0.094, 0.094, 0.094], GREY = [0.388, 0.388, 0.388], BOX_INK = [0.173, 0.173, 0.173];
  var RULE = [0.8, 0.8, 0.8], RULE_LIGHT = [0.9, 0.9, 0.9], INFO_BLUE = [0.816, 0.91, 0.977], AI_CYAN = [0.729, 0.91, 0.941];
  var BRAND = [0.357, 0.169, 0.839];
  var GROUP_COLORS = { ncq: [0.973, 0.387, 0.441], mq: [0.965, 0.559, 0.289], mc: [0.957, 0.895, 0.668], cq: [0.758, 0.926, 0.875] };
  /* Source colours repeat pink, blue, green, purple, restarting every ten sources. */
  var DARK = [[0.797, 0.078, 0.461], [0.133, 0.367, 0.777], [0.0, 0.457, 0.273], [0.457, 0.199, 0.906]];
  var LIGHT = [[0.996, 0.863, 0.906], [0.84, 0.898, 0.984], [0.758, 0.926, 0.875], [0.926, 0.875, 0.996]];
  function colorIndex(n) { return ((n - 1) % 10) % 4; }
  P.sourceColor = function (n) { return { dark: DARK[colorIndex(n)], light: LIGHT[colorIndex(n)] }; };

  var ICONS = {
    globe: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z",
    book: "M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z",
    person: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
    school: "M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z",
    doc: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
    quote: "M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z",
    lines: "M3 18h12v-2H3v2zM3 6v2h18V6H3zm0 7h18v-2H3v2z",
    robot: "M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3zM7.5 11.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S9.83 13 9 13s-1.5-.67-1.5-1.5zM16 17H8v-2h8v2zm-1-4c-.83 0-1.5-.67-1.5-1.5S14.17 10 15 10s1.5.67 1.5 1.5S15.83 13 15 13z"
  };
  var GROUP_ICON = { ncq: "doc", mq: "quote", mc: "lines", cq: "school" };

  P.FONT_FILES = {
    lexSemi: "LexendDeca-SemiBold.ttf", lexMed: "LexendDeca-Medium.ttf", noto: "NotoSans-Regular.ttf", notoSemi: "NotoSans-SemiBold.ttf",
    R: "Tinos-Regular.ttf", B: "Tinos-Bold.ttf", I: "Tinos-Italic.ttf", BI: "Tinos-BoldItalic.ttf"
  };
  var ASC = { lexSemi: 1.0, lexMed: 1.0, noto: 1.069, notoSemi: 1.069 };

  /* Formatting --------------------------------------------------------------------------------- */
  P.formatDate = function (d) {
    try {
      return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
    } catch (e) { return d.toUTCString(); }
  };
  P.formatSize = function (bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
    return bytes + " B";
  };
  P.newSubmissionId = function () {
    var n = "";
    for (var i = 0; i < 9; i++) n += Math.floor(Math.random() * 10);
    return "tio:oid:::1:" + n.replace(/^0/, "1");
  };
  /* Word and character counts as printed on the cover page: words are runs of letters and digits
     (joined by apostrophes, hyphens or decimal points), characters are everything except white space. */
  P.counts = function (doc) {
    var text = doc.words.map(function (w) { return w.raw; }).join(" ");
    return {
      words: (text.match(/[\p{L}\p{N}]+(?:['\u2019\-.][\p{L}\p{N}]+)*/gu) || []).length,
      chars: text.replace(/\s/g, "").length
    };
  };
  function num(n) { return Number(n).toLocaleString("en-US"); }

  /* Builder ------------------------------------------------------------------------------------- */
  async function start(fontBytes) {
    var L = root.PDFLib;
    var pdf = await L.PDFDocument.create();
    pdf.registerFontkit(root.fontkit);
    var fonts = {};
    var keys = Object.keys(fontBytes);
    for (var i = 0; i < keys.length; i++) fonts[keys[i]] = await pdf.embedFont(fontBytes[keys[i]], { subset: true });
    return { L: L, pdf: pdf, fonts: fonts };
  }

  function ctx(b, page) {
    var L = b.L;
    function col(c) { return L.rgb(c[0], c[1], c[2]); }
    var api = {
      page: page,
      text: function (s, x, top, font, size, color) {
        s = clean(s, b.fonts[font]);
        page.drawText(s, { x: x, y: PAGE_H - top - (ASC[font] || 0.9) * size, size: size, font: b.fonts[font], color: col(color || INK) });
        return b.fonts[font].widthOfTextAtSize(s, size);
      },
      width: function (s, font, size) { return b.fonts[font].widthOfTextAtSize(clean(s, b.fonts[font]), size); },
      rule: function (y, x0, x1, color) {
        page.drawLine({ start: { x: x0, y: PAGE_H - y }, end: { x: x1, y: PAGE_H - y }, thickness: 0.5, color: col(color || RULE) });
      },
      rect: function (x, top, w, h, color) {
        page.drawRectangle({ x: x, y: PAGE_H - top - h, width: w, height: h, color: col(color) });
      },
      round: function (x, top, w, h, r, color) {
        r = Math.min(r, h / 2, w / 2);
        var p = "M" + r + " 0H" + (w - r) + "A" + r + " " + r + " 0 0 1 " + w + " " + r + "V" + (h - r) + "A" + r + " " + r + " 0 0 1 " + (w - r) + " " + h +
          "H" + r + "A" + r + " " + r + " 0 0 1 0 " + (h - r) + "V" + r + "A" + r + " " + r + " 0 0 1 " + r + " 0Z";
        page.drawSvgPath(p, { x: x, y: PAGE_H - top, color: col(color), borderWidth: 0 });
      },
      circle: function (cx, cy, r, color) { page.drawCircle({ x: cx, y: PAGE_H - cy, size: r, color: col(color) }); },
      icon: function (name, x, top, size, color) {
        page.drawSvgPath(ICONS[name], { x: x, y: PAGE_H - top, scale: size / 24, color: col(color || INK), borderWidth: 0 });
      },
      col: col
    };
    return api;
  }

  /* Drops characters the font cannot draw. */
  function clean(s, font) {
    s = String(s == null ? "" : s).replace(/[\u0000-\u001f\u200b-\u200f\u2028\u2029\ufeff]/g, " ");
    try {
      var set = font.getCharacterSet ? font.getCharacterSet() : null;
      if (!set) return s;
      if (!font.__set) font.__set = new Set(set);
      var out = "";
      for (var ch of s) out += font.__set.has(ch.codePointAt(0)) ? ch : "?";
      return out;
    } catch (e) { return s; }
  }

  function truncate(c, s, font, size, max) {
    if (c.width(s, font, size) <= max) return s;
    var lo = 0, hi = s.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (c.width(s.slice(0, mid) + " ...", font, size) <= max) lo = mid; else hi = mid - 1;
    }
    return s.slice(0, lo).replace(/\s+$/, "") + " ...";
  }

  function wrap(c, s, font, size, max) {
    var words = String(s).split(/\s+/), lines = [], cur = "";
    words.forEach(function (w) {
      var t = cur ? cur + " " + w : w;
      if (cur && c.width(t, font, size) > max) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  /* The Turn In Out mark: a violet tile with two white arrows, one in and one out. */
  function drawMark(c, x, top, size) {
    var k = size / 512, white = c.col([1, 1, 1]);
    c.round(x, top, size, size, 112 * k, BRAND);
    var L = root.PDFLib;
    c.page.pushOperators(L.pushGraphicsState(), L.setLineJoin(L.LineJoinStyle.Round));
    ["M150 200H352", "M308 156L352 200L308 244", "M362 312H160", "M204 268L160 312L204 356"].forEach(function (d) {
      c.page.drawSvgPath(d, { x: x, y: PAGE_H - top, scale: k, borderColor: white, borderWidth: 40, borderLineCap: 1 });
    });
    c.page.pushOperators(L.popGraphicsState());
  }

  function header(c, info, index, total, section) {
    [24, 748].forEach(function (top) {
      drawMark(c, 36, top + 2, 12.5);
      var size = 9;
      while (c.width("turninout", "lexMed", size) > 50 && size > 6) size -= 0.25;
      c.text("turninout", 51, top + 3.2, "lexMed", size, INK);
      var label = "Page " + index + " of " + total + " - " + section;
      c.text(label, 107, top + 3.5, "noto", 6, INK);
      var idW = c.width(info.submissionId, "noto", 6);
      var idX = 576 - idW;
      c.text(info.submissionId, idX, top + 3.5, "noto", 6, INK_ID);
      c.text("Submission ID", idX - 5 - c.width("Submission ID", "noto", 6), top + 3.5, "noto", 6, INK);
    });
  }

  function cover(b, info) {
    var c = ctx(b, b.pdf.addPage([PAGE_W, PAGE_H]));
    c.text(info.author || "Anonymous", 36, 336, "lexSemi", 20);
    c.text(truncate(c, info.title || info.fileName, "lexMed", 17, 540), 36, 369, "lexMed", 17);
    if (info.institution) {
      c.icon("school", 36, 397, 12, GREY);
      c.text(info.institution, 56, 397.4, "noto", 8, GREY);
    }
    c.rule(425, 36, 576);
    c.text("Document Details", 36, 443.3, "notoSemi", 10);
    var rows = [["Submission ID", info.submissionId], ["Submission Date", P.formatDate(info.submittedAt)], ["Download Date", P.formatDate(info.downloadedAt)],
      ["File Name", info.fileName], ["File Size", P.formatSize(info.fileSize)]];
    rows.forEach(function (r, i) {
      var top = 472.5 + 36 * i;
      c.text(r[0], 36, top, "notoSemi", 7, GREY);
      c.text(truncate(c, r[1], "notoSemi", 7, 340), 36, top + 14, "notoSemi", 7, i === 0 ? INK_ID : INK);
    });
    var stats = [num(info.pages) + (info.pages === 1 ? " Page" : " Pages"), num(info.words) + " Words", num(info.chars) + " Characters"];
    var bw = Math.max(89, 24 + Math.max.apply(null, stats.map(function (s) { return c.width(s, "notoSemi", 7); })));
    c.rect(403, 470, bw, 78, [0.973, 0.973, 0.973]);
    stats.forEach(function (s, i) { c.text(s, 415, 484.5 + 22 * i, "notoSemi", 7); });
    return c;
  }

  /* Match groups (left) and the database summary (right), as on both overview pages. */
  function groupsBlock(c, sim, top, rightX) {
    c.text("Match Groups", 36, top, "notoSemi", 10);
    sim.groups.forEach(function (g, i) {
      var y = top + 22.4 + 25 * i;
      c.circle(42.25, y + 5.6, 6.25, GROUP_COLORS[g.key]);
      c.icon(GROUP_ICON[g.key], 38.6, y + 2, 7.3, INK);
      var w = c.text(String(g.count), 53, y + 0.8, "notoSemi", 7);
      c.text(" " + g.label + "  " + VT.sim.pct(g.pct), 53 + w, y + 0.8, "noto", 7);
      c.text(g.desc, 53, y + 10.8, "noto", 7, GREY);
    });
    c.text("Top Sources", rightX, top, "notoSemi", 10);
    [["internet", "globe", "Internet sources"], ["publication", "book", "Publications"], ["submitted", "person", "Submitted works (Student Papers)"]].forEach(function (r, i) {
      var y = top + 22.4 + 14 * i;
      c.text(VT.sim.pct(sim.types[r[0]]), rightX, y, "noto", 7);
      c.icon(r[1], 322, y + 0.6, 8.5, INK);
      c.text(r[2], 336, y, "noto", 7);
    });
  }

  function overview(b, sim, doc) {
    var c = ctx(b, b.pdf.addPage([PAGE_W, PAGE_H]));
    var w = c.text(VT.sim.pct(sim.overall), 36, 59.2, "lexMed", 17);
    c.text("Overall Similarity", 36 + w + 10, 59.2, "lexMed", 17);
    c.text("The combined total of all matches, including overlapping sources, for each database.", 36, 82.1, "noto", 7, GREY);
    var y = 103.7;
    if (sim.filtered.length) {
      c.text("Filtered from the Report", 36, y, "notoSemi", 10);
      sim.filtered.forEach(function (f, i) {
        var t = y + 20.4 + 14 * i;
        c.page.drawSvgPath("M0 0L2 1.8L0 3.6Z", { x: 39.5, y: PAGE_H - (t + 3), color: c.col(INK), borderWidth: 0 });
        c.text(f, 48, t, "noto", 7);
      });
      y = y + 20.4 + 14 * (sim.filtered.length - 1) + 21.9 + 14.2;
    } else {
      c.text("No filters applied", 36, y, "notoSemi", 10);
      y += 32;
    }
    c.rule(y, 36, 576);
    var gTop = y + 15.9;
    groupsBlock(c, sim, gTop, 298.5);
    var y2 = gTop + 22.4 + 25 * 3 + 29.4;
    c.rule(y2, 36, 576);
    var fTop = y2 + 12.9;
    c.text("Integrity Flags", 36, fTop, "notoSemi", 10);
    var flags = doc.flags || [];
    c.text(flags.length + " Integrity Flag" + (flags.length === 1 ? "" : "s") + " for Review", 36, fTop + 20.6, "notoSemi", 7);
    if (!flags.length) c.text("No suspicious text manipulations found.", 36, fTop + 35.6, "noto", 7, GREY);
    flags.forEach(function (f, i) {
      var t = fTop + 35.6 + 34 * i;
      c.text(f.type, 36, t, "notoSemi", 7);
      c.text(num(f.count) + " suspect character" + (f.count === 1 ? "" : "s") + " on " + num(f.pages) + " page" + (f.pages === 1 ? "" : "s"), 36, t + 10, "noto", 7);
      c.text(f.desc, 36, t + 20, "noto", 7, GREY);
    });
    c.round(301, fTop + 17.1, 266, 64, 8, INFO_BLUE);
    ["Our system's algorithms look deeply at a document for any inconsistencies that", "would set it apart from a normal submission. If we notice something strange, we flag",
      "it for you to review.", "", "A Flag is not necessarily an indicator of a problem. However, we'd recommend you", "focus your attention there for further review."].forEach(function (s, i) {
      if (s) c.text(s, 313, fTop + 24.8 + 8 * i, "noto", 6, BOX_INK);
    });
    return c;
  }

  function sourceRow(c, s, top) {
    var col = P.sourceColor(s.n);
    var label = String(s.n), nw = Math.max(24.5, c.width(label, "notoSemi", 7) + 14);
    c.round(36, top, nw, 15, 7.5, col.dark);
    c.text(label, 36 + (nw - c.width(label, "notoSemi", 7)) / 2, top + 3, "notoSemi", 7, [0.996, 0.996, 0.996]);
    c.round(66, top, 70, 15, 7.5, col.light);
    c.text(s.typeLabel, 66 + (70 - c.width(s.typeLabel, "notoSemi", 7)) / 2, top + 3, "notoSemi", 7);
    c.text(truncate(c, s.title, "notoSemi", 8, 335), 36, top + 17.4, "notoSemi", 8);
    c.text(VT.sim.sourcePct(s.pct), 386, top + 17.4, "notoSemi", 8);
    c.rule(top + 34, 36, 386, RULE_LIGHT);
  }

  function sourcePages(b, sim) {
    var pages = [];
    var c = ctx(b, b.pdf.addPage([PAGE_W, PAGE_H]));
    pages.push(c);
    groupsBlock(c, sim, 54.3, 298);
    c.rule(190, 36, 576);
    c.text("Top Sources", 36, 204.3, "notoSemi", 10);
    c.text("The sources with the highest number of matches within the submission. Overlapping sources will not be displayed.", 36, 223.5, "noto", 7, GREY);
    var list = sim.sources, i = 0;
    for (; i < Math.min(10, list.length); i++) sourceRow(c, list[i], 253 + 46 * i);
    while (i < list.length) {
      c = ctx(b, b.pdf.addPage([PAGE_W, PAGE_H]));
      pages.push(c);
      for (var k = 0; k < 15 && i < list.length; k++, i++) sourceRow(c, list[i], 60 + 46 * k);
    }
    return pages;
  }

  P.sourcePageCount = function (n) { return 1 + Math.max(0, Math.ceil((n - 10) / 15)); };

  /* Submission pages ------------------------------------------------------------------------------ */

  /* Highlight rectangles: consecutive highlighted words of one colour on one line become one box. */
  function highlightRects(doc, ranges) {
    var colorOf = new Map();
    ranges.forEach(function (r) { for (var i = r.start; i < r.end; i++) if (!colorOf.has(i)) colorOf.set(i, r.color); });
    var rects = [], cur = null;
    doc.words.forEach(function (w, i) {
      var c = colorOf.get(i);
      if (!c || w.rot) { cur = null; return; }
      if (cur && cur.color === c && cur.line === w.line) {
        cur.x1 = Math.max(cur.x1, w.x1);
        cur.top = Math.min(cur.top, w.top);
        cur.bottom = Math.max(cur.bottom, w.bottom);
      } else {
        cur = { page: w.page, line: w.line, color: c, x0: w.x0, x1: w.x1, top: w.top, bottom: w.bottom };
        rects.push(cur);
      }
    });
    return rects;
  }

  async function submissionPages(b, doc, opts) {
    var L = b.L;
    var src = null;
    if (doc.kind === "pdf" && opts.pdfBytes) {
      try {
        src = await L.PDFDocument.load(opts.pdfBytes, { ignoreEncryption: true, updateMetadata: false });
      } catch (e) { src = null; }
    }
    /* All pages are embedded in one call so fonts and images they share are copied once. */
    var embedded = new Map();
    if (src) {
      var want = [], boxes = [];
      doc.pages.forEach(function (info, p) {
        if (info.rotate || p >= src.getPageCount()) return;
        var sp = src.getPage(p), cb = sp.getCropBox();
        want.push(p);
        boxes.push({ left: cb.x, bottom: cb.y, right: cb.x + cb.width, top: cb.y + cb.height });
      });
      try {
        var list = await b.pdf.embedPages(want.map(function (p) { return src.getPage(p); }), boxes);
        want.forEach(function (p, k) { embedded.set(p, list[k]); });
      } catch (e) { embedded.clear(); }
    }
    var rects = highlightRects(doc, opts.highlights || []);
    var byPage = new Map();
    rects.forEach(function (r) { if (!byPage.has(r.page)) byPage.set(r.page, []); byPage.get(r.page).push(r); });
    var markersByPage = new Map();
    (opts.markers || []).forEach(function (m) { if (!markersByPage.has(m.page)) markersByPage.set(m.page, []); markersByPage.get(m.page).push(m); });
    var out = [];
    for (var p = 0; p < doc.pages.length; p++) {
      var info = doc.pages[p];
      var page = b.pdf.addPage([PAGE_W, PAGE_H]);
      var c = ctx(b, page);
      var w = info.width, h = info.height;
      var s = Math.min(PAGE_W / w, PAGE_H / h);
      var ox = (PAGE_W - w * s) / 2, oyTop = (PAGE_H - h * s) / 2;
      var tf = { x: function (x) { return ox + x * s; }, y: function (y) { return oyTop + y * s; } };
      (byPage.get(p) || []).forEach(function (r) {
        c.rect(tf.x(r.x0), tf.y(r.top), (r.x1 - r.x0) * s, (r.bottom - r.top) * s, r.color);
      });
      var drawn = false;
      var emb = embedded.get(p);
      if (emb) {
        try {
          page.drawPage(emb, { x: ox, y: PAGE_H - oyTop - h * s, xScale: s * w / emb.width, yScale: s * h / emb.height });
          drawn = true;
        } catch (e) { drawn = false; }
      }
      if (!drawn && doc.kind === "pdf" && opts.rasterize) {
        try {
          var img = await opts.rasterize(p);
          var jpg = await b.pdf.embedJpg(img);
          page.drawImage(jpg, { x: ox, y: PAGE_H - oyTop - h * s, width: w * s, height: h * s });
          drawn = true;
        } catch (e) { drawn = false; }
      }
      if (!drawn) drawFlowPage(b, c, doc, p, tf, s);
      drawMarkers(c, markersByPage.get(p) || [], tf);
      out.push(c);
    }
    return out;
  }

  /* Draws a laid-out page (Word, text, or a PDF page that could not be embedded) word by word. */
  function drawFlowPage(b, c, doc, p, tf, s) {
    var black = b.L.rgb(0, 0, 0);
    doc.words.forEach(function (w) {
      if (w.page !== p) return;
      var parts = w.parts || [{ text: w.raw, key: "R" }];
      var x = tf.x(w.x0);
      var size = (w.size || 12) * s;
      parts.forEach(function (pt) {
        var font = b.fonts[pt.key] || b.fonts.R;
        var t = clean(pt.text, font);
        c.page.drawText(t, { x: x, y: PAGE_H - tf.y(w.base), size: size, font: font, color: black });
        x += font.widthOfTextAtSize(t, size);
      });
    });
  }

  /* Source numbers in the left margin, at the line where each match starts. Numbers on one line sit side
     by side; a line that would overlap the previous numbers moves down. */
  function drawMarkers(c, markers, tf) {
    var lines = new Map();
    markers.forEach(function (m) {
      var key = m.line;
      if (!lines.has(key)) lines.set(key, { top: m.top, list: [] });
      var L = lines.get(key);
      if (L.list.indexOf(m.n) < 0) L.list.push(m.n);
    });
    var rows = Array.from(lines.values()).sort(function (a, b) { return a.top - b.top; });
    var lastBottom = -1e9;
    rows.forEach(function (r) {
      var top = Math.max(tf.y(r.top), lastBottom + 1.5);
      var x = 7.5;
      r.list.forEach(function (n) {
        var label = String(n), wdt = Math.max(17.7, c.width(label, "notoSemi", 7.8) + 9);
        var col = P.sourceColor(n).dark;
        c.round(x, top, wdt, 15.5, 7.75, col);
        c.text(label, x + (wdt - c.width(label, "notoSemi", 7.8)) / 2, top + 2.6, "notoSemi", 7.8, [0.996, 0.996, 0.996]);
        x += wdt + 2;
      });
      lastBottom = top + 15.5;
    });
  }

  function finish(b, pages, info, sections) {
    pages.forEach(function (c, i) { header(c, info, i + 1, pages.length, sections[i]); });
    b.pdf.setTitle(info.fileName || "Submission");
    b.pdf.setAuthor(info.author || "");
    b.pdf.setCreator("Turn In Out");
    b.pdf.setProducer("Turn In Out");
    return b.pdf.save();
  }

  /* Public: similarity report ------------------------------------------------------------------- */
  P.similarity = async function (doc, sim, info, fontBytes, opts) {
    opts = opts || {};
    var b = await start(fontBytes);
    var pages = [], sections = [];
    pages.push(cover(b, info)); sections.push("Cover Page");
    pages.push(overview(b, sim, doc)); sections.push("Integrity Overview");
    sourcePages(b, sim).forEach(function (c) { pages.push(c); sections.push("Integrity Overview"); });
    var highlights = sim.matches.map(function (m) { return { start: m.start, end: m.end, color: P.sourceColor(m.source).light }; });
    var markers = sim.matches.map(function (m) {
      var w = doc.words[m.start];
      return { page: w.page, line: w.line, top: doc.lines[w.line] ? doc.lines[w.line].top : w.top, n: m.source };
    });
    var subs = await submissionPages(b, doc, { pdfBytes: opts.pdfBytes, rasterize: opts.rasterize, highlights: highlights, markers: markers });
    subs.forEach(function (c) { pages.push(c); sections.push("Integrity Submission"); });
    return finish(b, pages, info, sections);
  };

  /* Public: AI writing report ------------------------------------------------------------------- */
  P.ai = async function (doc, ai, info, fontBytes, opts) {
    opts = opts || {};
    var b = await start(fontBytes);
    var pages = [], sections = [];
    pages.push(cover(b, info)); sections.push("Cover Page");
    var c = ctx(b, b.pdf.addPage([PAGE_W, PAGE_H]));
    pages.push(c); sections.push("AI Writing Overview");
    c.rule(60, 36, 576);
    var head, sub;
    if (!ai.enough) {
      head = "--  AI detection unavailable";
      sub = ["This submission has fewer than 300 words of qualifying prose, which is", "too little text for a reliable AI writing assessment."];
    } else {
      head = (ai.hidden ? "*" : ai.percent) + "% detected as AI";
      sub = ["The percentage indicates the combined amount of likely AI-generated text as", "well as likely AI-generated text that was also likely revised by AI."];
    }
    c.text(head, 36, 81, "lexMed", 17);
    sub.forEach(function (s, i) { c.text(s, 36, 100.5 + 10 * i, "noto", 7); });
    c.round(306, 76, 273, 56, 8, INFO_BLUE);
    c.text("Caution: Review required.", 318, 85.6, "notoSemi", 6, [0.176, 0.176, 0.176]);
    ["It is essential to understand the limitations of AI detection before making decisions", "about a student\u2019s work. We encourage you to learn more about how this AI detection",
      "works before using the tool."].forEach(function (s, i) { c.text(s, 318, 101.6 + 8 * i, "noto", 6, [0.176, 0.176, 0.176]); });
    c.rule(148, 36, 576);
    c.circle(42, 174, 6, AI_CYAN);
    c.icon("robot", 38.2, 170.2, 7.6, INK);
    if (ai.enough && !ai.hidden) {
      var w = c.text(String(ai.segments.length), 52, 166.5, "notoSemi", 7);
      c.text(" AI-generated  " + ai.percent + "%", 52 + w, 166.5, "noto", 7);
      c.text("Likely generated or likely generated and revised by AI.", 52, 176.5, "noto", 7, GREY);
    } else if (ai.enough) {
      c.text("AI-generated  *%", 52, 166.5, "noto", 7);
      c.text("Scores between 1% and 19% are shown as *% and not highlighted, as they have a higher likelihood of false positives.", 52, 176.5, "noto", 7, GREY);
    } else {
      c.text("Not enough qualifying text", 52, 166.5, "noto", 7);
      c.text("Qualifying text is long-form prose sentences; headings, lists, tables and the bibliography do not count.", 52, 176.5, "noto", 7, GREY);
    }
    c.rule(200, 36, 576);
    c.text("Disclaimer", 36, 217.6, "notoSemi", 6, GREY);
    wrap(c, "Our AI writing assessment is designed to help educators identify text that might be prepared by a generative AI tool. Our AI writing assessment may not always be accurate (it may misidentify writing that is likely human generated as AI generated and likely AI generated as human generated) so it should not be used as the sole basis for adverse actions against a student. It takes further scrutiny and human judgment in conjunction with an organization's application of its specific academic policies to determine whether any academic misconduct has occurred.", "noto", 6, 540)
      .forEach(function (s, i) { c.text(s, 36, 225.6 + 8 * i, "noto", 6, GREY); });
    c.rule(264, 36, 576);
    var highlights = ai.enough && !ai.hidden ? ai.segments.map(function (s) { return { start: s.start, end: s.end, color: AI_CYAN }; }) : [];
    var subs = await submissionPages(b, doc, { pdfBytes: opts.pdfBytes, rasterize: opts.rasterize, highlights: highlights, markers: [] });
    subs.forEach(function (x) { pages.push(x); sections.push("AI Writing Submission"); });
    return finish(b, pages, info, sections);
  };
})(typeof self !== "undefined" ? self : globalThis);
