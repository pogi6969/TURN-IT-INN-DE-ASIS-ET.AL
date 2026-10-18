/* Checks for the engines: text model, similarity, AI detection and both report PDFs.
   Run with `npm test` inside tests/ after `npm install`. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const VT = require("./load.js");

const FONTS = path.join(__dirname, "..", "assets", "fonts");

async function measureFonts(bytes) {
  const d = await PDFLib.PDFDocument.create();
  d.registerFontkit(fontkit);
  const out = {};
  for (const k of ["R", "B", "I", "BI"]) out[k] = await d.embedFont(bytes[k], { subset: true });
  return out;
}

const ESSAY = [
  "ACCESS TO PUBLIC TRANSPORT",
  "Public transport plays a crucial role in ensuring that communities can access essential services. Moreover, it fosters economic growth and enhances social inclusion across diverse regions. Consequently, policymakers increasingly emphasize comprehensive frameworks that integrate accessibility into planning.",
  "In transportation research, accessibility refers to how easily people can access opportunities such as jobs, schools, markets, and health services. By treating opportunities as less valuable when they are more expensive to reach, Hansen (1959) offered an early formal measure.",
  "We rode the jeepney to Daraga on Saturday and it took almost an hour because of the rain. My sister said the fare went up again, which honestly surprised nobody.",
  "As one planner put it, \"the city that cannot be reached cannot be used\" and the line stuck with us. The study also uses a gravity-style measure as a robustness check.",
  "Furthermore, the framework underscores the pivotal importance of reliable data. Additionally, it highlights how informal transit networks can be systematically documented, thereby facilitating evidence-based decision making and fostering sustainable urban development.",
  "REFERENCES",
  "Hansen, W. G. (1959). How accessibility shapes land use. Journal of the American Institute of Planners, 25(2), 73-76."
].join("\n\n");

(async () => {
  const fontBytes = {};
  for (const [k, f] of Object.entries(VT.report.FONT_FILES)) fontBytes[k] = fs.readFileSync(path.join(FONTS, f));
  const doc = VT.extract.fromText(ESSAY.repeat(1).replace("Saturday", "Saturday"), await measureFonts(fontBytes));
  VT.text.analyze(doc);

  // text model
  assert.ok(doc.sentences.length >= 12, "sentences are split");
  assert.ok(doc.bib && doc.words[doc.bib.start].raw === "Hansen,", "the reference list is found");
  const quoted = doc.words.filter(w => w.quoted).map(w => w.raw).join(" ");
  assert.ok(quoted.includes("cannot be reached"), "quoted words are marked");
  assert.ok(doc.words.find(w => w.raw === "Hansen").cited, "author-year citations are found");
  assert.strictEqual(VT.text.normalize("раper"), "paper", "look-alike letters are swapped back");
  assert.strictEqual(VT.text.wordFlags("pаper"), 2, "replaced characters are flagged");
  assert.strictEqual(VT.text.wordFlags("pa​per"), 1, "hidden characters inside a word are flagged");

  // similarity
  const sources = [
    { id: "web:example.org", type: "internet", title: "example.org", texts: ["In transportation research, accessibility refers to how easily people can access opportunities such as jobs, schools, markets, and health services."] },
    { id: "pub:hansen", type: "publication", title: "How accessibility shapes land use", texts: ["accessibility refers to how easily people can access opportunities such as jobs. Treating opportunities as less valuable when they are more expensive to reach"] },
    { id: "sub:1", type: "submitted", title: "Submitted to Turn In Out on 2026-01-01", texts: ["Hansen, W. G. (1959). How accessibility shapes land use. Journal of the American Institute of Planners"] }
  ];
  const sim = VT.sim.compare(doc, sources, { excludeBib: true, excludeQuotes: true });
  assert.ok(sim.overall > 5 && sim.overall < 40, "overall similarity " + sim.overall);
  assert.strictEqual(sim.sources[0].title, "How accessibility shapes land use", "the source with the most matched words comes first");
  assert.ok(sim.sources[1] && sim.sources[1].title === "example.org" && sim.sources[1].words < sim.sources[0].words, "an overlapping source keeps only its own words");
  assert.ok(!sim.sources.some(s => s.type === "submitted"), "the excluded bibliography does not match");
  assert.ok(sim.groups.find(g => g.key === "mq").count >= 1, "a cited match is a Missing Quotations match");
  const withBib = VT.sim.compare(doc, sources, { excludeBib: false, excludeQuotes: true });
  assert.ok(withBib.sources.some(s => s.type === "submitted"), "the bibliography matches when it is not filtered");
  assert.strictEqual(VT.sim.sourcePct(0.4), "<1%");
  assert.strictEqual(VT.sim.sourcePct(3.6), "4%");

  // AI writing
  const ai = VT.ai.detect(doc);
  assert.ok(ai.qualifyingWords > 100, "qualifying prose is counted");
  assert.strictEqual(ai.enough, false, "fewer than 300 qualifying words gives no score");
  const long = VT.extract.fromText(Array(4).fill(ESSAY.split("\n\n").slice(0, 6).join("\n\n")).join("\n\n"), await measureFonts(fontBytes));
  VT.text.analyze(long);
  const ai2 = VT.ai.detect(long);
  assert.ok(ai2.enough && ai2.percent >= 0 && ai2.percent <= 100, "a score is given");
  const scores = new Map(ai2.sentenceScores.map(s => [long.words.slice(long.sentences[s.sentence].start, long.sentences[s.sentence].end).map(w => w.raw).join(" "), s.score]));
  const machine = [...scores].find(([t]) => t.startsWith("Furthermore"))[1];
  const human = [...scores].find(([t]) => t.startsWith("We rode"))[1];
  assert.ok(machine > human, "stock AI prose scores above casual human prose");

  // reports
  const counts = VT.report.counts(long);
  const info = { author: "Test Author", title: "essay.txt", fileName: "essay.txt", institution: "Test School", submissionId: VT.report.newSubmissionId(),
    submittedAt: new Date(), downloadedAt: new Date(), fileSize: 4096, pages: long.pageCount, words: counts.words, chars: counts.chars };
  const simLong = VT.sim.compare(long, sources, { excludeBib: true, excludeQuotes: true });
  const simPdf = await PDFLib.PDFDocument.load(await VT.report.similarity(long, simLong, info, fontBytes));
  assert.strictEqual(simPdf.getPageCount(), 2 + VT.report.sourcePageCount(simLong.sources.length) + long.pageCount, "similarity report pages");
  const aiPdf = await PDFLib.PDFDocument.load(await VT.report.ai(long, ai2, info, fontBytes));
  assert.strictEqual(aiPdf.getPageCount(), 2 + long.pageCount, "AI writing report pages");
  assert.match(info.submissionId, /^tio:oid:::1:\d{9}$/);
  console.log("All checks passed: similarity " + simLong.overall.toFixed(1) + "%, AI " + ai2.percent + "%, " + simPdf.getPageCount() + " + " + aiPdf.getPageCount() + " report pages.");
})().catch(e => { console.error(e); process.exit(1); });
