/* The scanner: upload, settings, progress, results with both reports, and the list of earlier submissions.
   Used by the website (index.html) and the installable app (app/index.html). */
(function (root) {
  "use strict";
  var VT = root.VT = root.VT || {};
  var U = VT.ui = {};

  var SETTINGS_KEY = "tio-settings";
  var DEFAULTS = Object.assign({}, VT.sources.DEFAULTS, {
    excludeBib: true, excludeQuotes: true, minWords: 0, saveToRepo: true, author: "", institution: ""
  });

  function loadSettings() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* storage off */ } }

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") e.className = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }

  var fontCache = null;
  async function fonts(base) {
    if (fontCache) return fontCache;
    var out = {};
    var files = VT.report.FONT_FILES;
    await Promise.all(Object.keys(files).map(async function (k) {
      var r = await fetch(base + "assets/fonts/" + files[k]);
      if (!r.ok) throw new Error("Could not load the report fonts.");
      out[k] = new Uint8Array(await r.arrayBuffer());
    }));
    fontCache = out;
    return out;
  }

  /* pdf-lib fonts used only to measure words when laying out Word and text files. */
  async function measureFonts(base) {
    var fb = await fonts(base);
    var d = await root.PDFLib.PDFDocument.create();
    d.registerFontkit(root.fontkit);
    var out = {};
    for (var k of ["R", "B", "I", "BI"]) out[k] = await d.embedFont(fb[k], { subset: true });
    return out;
  }

  /* Reads one file (or pasted text) into an analyzed document. */
  async function readSubmission(item, base, onProgress) {
    var name = item.name, lower = name.toLowerCase(), doc, bytes = null;
    if (item.text != null) {
      doc = VT.extract.fromText(item.text, await measureFonts(base));
    } else if (lower.endsWith(".pdf") || item.file.type === "application/pdf") {
      bytes = new Uint8Array(await item.file.arrayBuffer());
      doc = await VT.extract.fromPdf(bytes, onProgress);
    } else if (lower.endsWith(".docx")) {
      doc = await VT.extract.fromDocx(await item.file.arrayBuffer(), await measureFonts(base));
    } else if (/\.(txt|md|text|csv|rtf|html?)$/.test(lower) || /^text\//.test(item.file.type)) {
      var t = await item.file.text();
      if (/\.html?$/.test(lower)) t = new DOMParser().parseFromString(t, "text/html").body.textContent || "";
      if (/\.rtf$/.test(lower)) t = t.replace(/\\par[d]?/g, "\n").replace(/\{\*?\\[^{}]+}|[{}]|\\[a-z]+-?\d* ?/gi, "");
      doc = VT.extract.fromText(t, await measureFonts(base));
    } else {
      throw new Error(name + ": this file type is not supported. Use PDF, Word (.docx) or plain text.");
    }
    VT.text.analyze(doc);
    if (!doc.wordCount) throw new Error(name + ": no text could be read. Scanned images need text recognition (OCR) first.");
    return { doc: doc, bytes: bytes };
  }

  /* Renders one page of the original PDF to JPEG, for pages that cannot be embedded. */
  function rasterizer(bytes) {
    var pdfP = null;
    return async function (p) {
      if (!pdfP) pdfP = root.pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
      var pdf = await pdfP, page = await pdf.getPage(p + 1);
      var vp = page.getViewport({ scale: 2 });
      var canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      var c2 = canvas.getContext("2d");
      c2.fillStyle = "#fff"; c2.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: c2, viewport: vp }).promise;
      var blob = await new Promise(function (r) { canvas.toBlob(r, "image/jpeg", 0.86); });
      return new Uint8Array(await blob.arrayBuffer());
    };
  }

  U.mount = function (rootEl, opts) {
    opts = opts || {};
    var base = opts.base || "";
    root.pdfjsLib.GlobalWorkerOptions.workerSrc = base + "assets/vendor/pdf.worker.min.js";
    var settings = loadSettings();
    var queue = [];
    var busy = false;

    rootEl.classList.add("tio");
    var tabs = el("div", { class: "tio-tabs", role: "tablist" });
    var panels = {};
    [["scan", "New scan"], ["history", "Submissions"], ["settings", "Settings"]].forEach(function (t, i) {
      var b = el("button", { class: "tio-tab", role: "tab", type: "button", "aria-selected": i === 0 ? "true" : "false", "data-tab": t[0], text: t[1], onclick: function () { show(t[0]); } });
      tabs.appendChild(b);
      panels[t[0]] = el("section", { class: "tio-panel", role: "tabpanel", hidden: i !== 0 });
    });
    rootEl.appendChild(tabs);
    Object.keys(panels).forEach(function (k) { rootEl.appendChild(panels[k]); });

    function show(name) {
      tabs.querySelectorAll(".tio-tab").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.tab === name ? "true" : "false"); });
      Object.keys(panels).forEach(function (k) { panels[k].hidden = k !== name; });
      if (name === "history") renderHistory();
    }
    U.show = show;

    /* New scan ---------------------------------------------------------------------------------- */
    var fileInput = el("input", { type: "file", multiple: true, accept: ".pdf,.docx,.txt,.md,.rtf,.html,.htm,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain", class: "tio-hidden", id: "tio-file" });
    var drop = el("label", { class: "tio-drop", for: "tio-file" }, [
      el("span", { class: "tio-drop-icon", "aria-hidden": "true" }),
      el("strong", { text: "Drop files here or choose files" }),
      el("span", { class: "tio-muted", text: "PDF, Word (.docx) or plain text. Several files are checked against each other too." })
    ]);
    var list = el("ul", { class: "tio-files" });
    var pasteBox = el("textarea", { class: "tio-input tio-paste", rows: 8, placeholder: "Or paste text here" });
    var author = el("input", { class: "tio-input", type: "text", value: settings.author, placeholder: "Student or author name" });
    var institution = el("input", { class: "tio-input", type: "text", value: settings.institution, placeholder: "School or university (optional)" });
    var titleInput = el("input", { class: "tio-input", type: "text", placeholder: "Defaults to the file name" });
    var startBtn = el("button", { class: "tio-btn tio-primary", type: "button", text: "Check for similarity and AI writing", onclick: run });
    var progress = el("div", { class: "tio-progress", hidden: true }, [
      el("div", { class: "tio-progress-label" }), el("div", { class: "tio-bar" }, [el("span")]), el("ol", { class: "tio-steps" })
    ]);
    var errorBox = el("div", { class: "tio-error", role: "alert", hidden: true });
    var results = el("div", { class: "tio-results" });

    panels.scan.appendChild(el("div", { class: "tio-card" }, [
      fileInput, drop, list,
      el("details", { class: "tio-pastewrap" }, [el("summary", { text: "Paste text instead" }), pasteBox]),
      el("div", { class: "tio-grid" }, [
        field("Author", author), field("Institution", institution), field("Submission title", titleInput)
      ]),
      el("p", { class: "tio-note", text: "Phrases from the document are sent as search queries to the databases turned on in Settings. The whole document never leaves this device." }),
      startBtn, errorBox
    ]));
    panels.scan.appendChild(progress);
    panels.scan.appendChild(results);

    function field(label, input) { return el("label", { class: "tio-field" }, [el("span", { text: label }), input]); }

    fileInput.addEventListener("change", function () { addFiles(fileInput.files); fileInput.value = ""; });
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
    drop.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });

    function addFiles(files) {
      Array.prototype.forEach.call(files, function (f) { queue.push({ name: f.name, file: f, size: f.size }); });
      renderQueue();
    }
    function renderQueue() {
      list.textContent = "";
      queue.forEach(function (q, i) {
        list.appendChild(el("li", {}, [
          el("span", { class: "tio-fname", text: q.name }), el("span", { class: "tio-muted", text: VT.report.formatSize(q.size) }),
          el("button", { class: "tio-link", type: "button", text: "Remove", "aria-label": "Remove " + q.name, onclick: function () { queue.splice(i, 1); renderQueue(); } })
        ]));
      });
    }

    var STEPS = ["Reading the document", "Checking integrity flags", "Searching the internet and publications", "Comparing with submitted works", "Detecting AI writing", "Building the reports"];
    function setStep(idx, label, frac) {
      progress.hidden = false;
      progress.querySelector(".tio-progress-label").textContent = label;
      progress.querySelector(".tio-bar span").style.width = Math.round(100 * Math.max(0, Math.min(1, frac))) + "%";
      var ol = progress.querySelector(".tio-steps");
      ol.textContent = "";
      STEPS.forEach(function (s, i) { ol.appendChild(el("li", { class: i < idx ? "done" : i === idx ? "now" : "", text: s })); });
    }

    async function run() {
      if (busy) return;
      errorBox.hidden = true;
      var items = queue.slice();
      if (pasteBox.value.trim()) items.push({ name: (titleInput.value.trim() || "Pasted text") + ".txt", text: pasteBox.value, size: new Blob([pasteBox.value]).size });
      if (!items.length) { showError("Add a file or paste some text first."); return; }
      settings.author = author.value.trim();
      settings.institution = institution.value.trim();
      saveSettings(settings);
      busy = true;
      startBtn.disabled = true;
      try {
        var reportFonts = await fonts(base);
        var read = [];
        for (var i = 0; i < items.length; i++) {
          setStep(0, "Reading " + items[i].name, i / items.length);
          try { read.push(Object.assign({ item: items[i] }, await readSubmission(items[i], base))); }
          catch (e) { showError(e.message || String(e)); }
        }
        var repo = settings.repository ? await VT.sources.repoAll() : [];
        for (var j = 0; j < read.length; j++) {
          await scanOne(read[j], read, repo, reportFonts, j, read.length);
        }
        queue = [];
        renderQueue();
        pasteBox.value = "";
        titleInput.value = "";
        progress.hidden = true;
      } catch (e) {
        showError(e.message || String(e));
      } finally {
        busy = false;
        startBtn.disabled = false;
      }
    }

    async function scanOne(entry, all, repo, reportFonts, idx, count) {
      var doc = entry.doc, item = entry.item;
      var label = count > 1 ? " (" + (idx + 1) + " of " + count + ")" : "";
      setStep(1, "Checking integrity flags" + label, 0.1);
      var key = VT.sources.contentKey(doc);
      var now = new Date();
      var peers = all.filter(function (x) { return x !== entry; }).map(function (x) {
        return { id: "sub:peer:" + x.item.name, type: "submitted", title: (settings.institution || "Submitted to Turn In Out") + " on " + now.toISOString().slice(0, 10),
          url: "", texts: [], tokenLists: [x.doc.words.filter(function (w) { return w.isWord; }).map(function (w) { return w.n; })] };
      });
      var extra = (settings.repository ? VT.sources.repoSources(repo, key) : []).concat(peers);
      setStep(2, "Searching the internet and publications" + label, 0.15);
      var found = await VT.sources.collect(doc, settings, extra, function (l, f) { setStep(2, l + label, 0.15 + 0.5 * f); });
      setStep(3, "Comparing with submitted works" + label, 0.7);
      var sim = VT.sim.compare(doc, found.sources, { excludeBib: settings.excludeBib, excludeQuotes: settings.excludeQuotes, minWords: +settings.minWords || 0 });
      setStep(4, "Detecting AI writing" + label, 0.78);
      var ai = VT.ai.detect(doc);
      setStep(5, "Building the reports" + label, 0.85);
      var counts = VT.report.counts(doc);
      var info = {
        author: settings.author || "Anonymous", institution: settings.institution, title: (count === 1 && titleInput.value.trim()) || item.name,
        fileName: item.name, fileSize: item.size, submissionId: VT.report.newSubmissionId(), submittedAt: now, downloadedAt: new Date(),
        pages: doc.pageCount, words: counts.words, chars: counts.chars
      };
      var ropts = { pdfBytes: entry.bytes, rasterize: entry.bytes ? rasterizer(entry.bytes) : null };
      var simPdf = await VT.report.similarity(doc, sim, info, reportFonts, ropts);
      setStep(5, "Building the reports" + label, 0.93);
      var aiPdf = await VT.report.ai(doc, ai, info, reportFonts, ropts);
      var rec = {
        id: info.submissionId, key: key, title: info.title, author: info.author, institution: info.institution, fileName: item.name,
        date: now.getTime(), similarity: Math.round(sim.overall), ai: ai.enough ? (ai.hidden ? "*" : ai.percent) : null,
        tokens: settings.saveToRepo ? doc.words.filter(function (w) { return w.isWord; }).map(function (w) { return w.n; }).join(" ") : "",
        simPdf: new Blob([simPdf], { type: "application/pdf" }), aiPdf: new Blob([aiPdf], { type: "application/pdf" })
      };
      await VT.sources.repoPut(rec);
      results.prepend(resultCard(rec, sim, ai, found.log));
    }

    function showError(msg) {
      errorBox.hidden = false;
      errorBox.textContent = msg;
    }

    function fileBase(name) { return name.replace(/\.[^.]+$/, ""); }

    function download(blob, name) {
      var url = URL.createObjectURL(blob);
      var a = el("a", { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    }

    function scoreTile(label, value, sub, tone) {
      return el("div", { class: "tio-score " + (tone || "") }, [el("span", { class: "tio-score-label", text: label }), el("strong", { text: value }), el("span", { class: "tio-muted", text: sub })]);
    }

    function resultCard(rec, sim, ai, log) {
      var viewer = el("div", { class: "tio-viewer", hidden: true });
      var simLabel = Math.round(sim ? sim.overall : rec.similarity) + "%";
      var aiLabel = rec.ai == null ? "--" : rec.ai + "%";
      var head = el("div", { class: "tio-result-head" }, [
        el("div", {}, [el("h3", { text: rec.title }), el("p", { class: "tio-muted", text: rec.author + " \u00b7 " + new Date(rec.date).toLocaleString() + " \u00b7 " + rec.id })])
      ]);
      var tiles = el("div", { class: "tio-scores" }, [
        scoreTile("Overall Similarity", simLabel, sim ? sim.sources.length + " sources, " + sim.matches.length + " matches" : "", "sim"),
        scoreTile("Detected as AI", aiLabel, ai ? (ai.enough ? ai.segments.length + " AI-generated segments" : "Fewer than 300 qualifying words") : "", "ai")
      ]);
      var actions = el("div", { class: "tio-actions" }, [
        el("button", { class: "tio-btn tio-primary", type: "button", text: "Similarity report (PDF)", onclick: function () { download(rec.simPdf, fileBase(rec.fileName) + " - Similarity Report.pdf"); } }),
        el("button", { class: "tio-btn tio-primary", type: "button", text: "AI writing report (PDF)", onclick: function () { download(rec.aiPdf, fileBase(rec.fileName) + " - AI Writing Report.pdf"); } }),
        el("button", { class: "tio-btn", type: "button", text: "View similarity report", onclick: function () { openViewer(viewer, rec.simPdf, this); } }),
        el("button", { class: "tio-btn", type: "button", text: "View AI writing report", onclick: function () { openViewer(viewer, rec.aiPdf, this); } })
      ]);
      var kids = [head, tiles, actions];
      if (sim && sim.sources.length) {
        var ol = el("ol", { class: "tio-sources" });
        sim.sources.slice(0, 12).forEach(function (s) {
          var c = VT.report.sourceColor(s.n).dark.map(function (v) { return Math.round(v * 255); });
          var title = s.url ? el("a", { href: s.url, target: "_blank", rel: "noopener", text: s.title }) : el("span", { text: s.title });
          ol.appendChild(el("li", {}, [el("span", { class: "tio-num", style: "background:rgb(" + c.join(",") + ")", text: String(s.n) }), el("span", { class: "tio-type", text: s.typeLabel }), title, el("span", { class: "tio-pct", text: VT.sim.sourcePct(s.pct) })]));
        });
        kids.push(el("details", { class: "tio-more" }, [el("summary", { text: "Top sources" }), ol]));
      }
      if (log && log.length) {
        kids.push(el("p", { class: "tio-muted tio-log", text: "Searched: " + log.map(function (l) { return l.db + (l.ok ? " (" + l.count + ")" : " (unavailable)"); }).join(", ") + (rec.tokens ? "; saved to the submitted works repository." : ".") }));
      }
      kids.push(viewer);
      return el("article", { class: "tio-card tio-result" }, kids);
    }

    /* Report viewer: renders the PDF pages with pdf.js as they scroll into view. */
    async function openViewer(viewer, blob, btn) {
      if (!viewer.hidden && viewer.dataset.src === btn.textContent) { viewer.hidden = true; viewer.textContent = ""; viewer.dataset.src = ""; return; }
      viewer.hidden = false;
      viewer.dataset.src = btn.textContent;
      viewer.textContent = "";
      var pdf = await root.pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
      var io = "IntersectionObserver" in root ? new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); draw(en.target); } });
      }, { rootMargin: "800px" }) : null;
      for (var p = 1; p <= pdf.numPages; p++) {
        var holder = el("div", { class: "tio-page", "data-page": p, "aria-label": "Report page " + p });
        viewer.appendChild(holder);
        if (io) io.observe(holder); else draw(holder);
      }
      async function draw(holder) {
        var page = await pdf.getPage(+holder.dataset.page);
        var cssW = holder.clientWidth || 612, ratio = Math.min(2.5, (root.devicePixelRatio || 1));
        var vp = page.getViewport({ scale: cssW / 612 * ratio });
        var canvas = el("canvas", { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
        holder.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      }
    }

    /* Submissions ------------------------------------------------------------------------------- */
    async function renderHistory() {
      var p = panels.history;
      p.textContent = "";
      var recs = (await VT.sources.repoAll()).sort(function (a, b) { return b.date - a.date; });
      if (!recs.length) {
        p.appendChild(el("div", { class: "tio-card tio-empty" }, [el("p", { text: "No submissions yet. Scanned documents appear here, and later scans are compared with them." })]));
        return;
      }
      var table = el("div", { class: "tio-card" }, [
        el("div", { class: "tio-hist-head" }, [
          el("h3", { text: recs.length + " submission" + (recs.length === 1 ? "" : "s") + " in this browser's repository" }),
          el("button", { class: "tio-link", type: "button", text: "Delete all", onclick: async function () { if (confirm("Delete every stored submission and its reports?")) { await VT.sources.repoClear(); renderHistory(); } } })
        ])
      ]);
      var ul = el("ul", { class: "tio-history" });
      recs.forEach(function (r) {
        ul.appendChild(el("li", {}, [
          el("div", { class: "tio-hist-main" }, [el("strong", { text: r.title }), el("span", { class: "tio-muted", text: r.author + " \u00b7 " + new Date(r.date).toLocaleString() })]),
          el("span", { class: "tio-chip sim", text: (r.similarity == null ? "--" : r.similarity + "%") + " similar" }),
          el("span", { class: "tio-chip ai", text: (r.ai == null ? "--" : r.ai + "%") + " AI" }),
          el("div", { class: "tio-hist-actions" }, [
            r.simPdf ? el("button", { class: "tio-link", type: "button", text: "Similarity PDF", onclick: function () { download(r.simPdf, fileBase(r.fileName) + " - Similarity Report.pdf"); } }) : null,
            r.aiPdf ? el("button", { class: "tio-link", type: "button", text: "AI PDF", onclick: function () { download(r.aiPdf, fileBase(r.fileName) + " - AI Writing Report.pdf"); } }) : null,
            el("button", { class: "tio-link danger", type: "button", text: "Delete", onclick: async function () { await VT.sources.repoDelete(r.id); renderHistory(); } })
          ])
        ]));
      });
      table.appendChild(ul);
      p.appendChild(table);
    }

    /* Settings ---------------------------------------------------------------------------------- */
    function check(key, label, hint) {
      var input = el("input", { type: "checkbox", checked: !!settings[key], onchange: function () { settings[key] = input.checked; saveSettings(settings); } });
      return el("label", { class: "tio-check" }, [input, el("span", {}, [el("strong", { text: label }), hint ? el("small", { class: "tio-muted", text: hint }) : null])]);
    }
    function textSetting(key, label, type, hint) {
      var input = el("input", { class: "tio-input", type: type || "text", value: settings[key] == null ? "" : settings[key], onchange: function () { settings[key] = type === "number" ? Math.max(0, +input.value || 0) : input.value.trim(); saveSettings(settings); } });
      return el("label", { class: "tio-field" }, [el("span", { text: label }), input, hint ? el("small", { class: "tio-muted", text: hint }) : null]);
    }
    panels.settings.appendChild(el("div", { class: "tio-card tio-settings" }, [
      el("h3", { text: "Filters" }),
      check("excludeBib", "Exclude bibliography", "Matches in the reference list are left out."),
      check("excludeQuotes", "Exclude quoted text", "Text inside quotation marks is left out."),
      textSetting("minWords", "Exclude matches smaller than (words)", "number", "0 keeps every match of five words or more."),
      el("h3", { text: "Internet" }),
      check("wikipedia", "Wikipedia", "Full articles are compared."),
      textSetting("wikiLang", "Wikipedia language code", "text", "en, fil, es, fr, de and so on."),
      check("google", "Google Programmable Search", "Searches the whole web for exact phrases. Needs your own API key and search engine ID."),
      textSetting("googleKey", "Google API key", "password"),
      textSetting("googleCx", "Search engine ID (cx)", "text"),
      el("h3", { text: "Publications" }),
      check("openalex", "OpenAlex", "Over 250 million scholarly works."),
      check("crossref", "Crossref", "Journal articles, books and proceedings with DOIs."),
      check("europepmc", "Europe PMC", "Life-science and health literature."),
      check("semanticscholar", "Semantic Scholar", "Papers across every field."),
      el("h3", { text: "Submitted works" }),
      check("repository", "Compare with earlier submissions", "Every document scanned in this browser."),
      check("saveToRepo", "Save new submissions to the repository", "Later scans are then compared with them.")
    ]));

    return { show: show };
  };
})(typeof self !== "undefined" ? self : globalThis);
