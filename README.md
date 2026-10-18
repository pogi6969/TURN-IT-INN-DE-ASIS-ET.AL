# Turn In Out

A website and an installable app that check papers for similarity, plagiarism and AI writing, and produce two PDF reports for every document scanned:

- **Similarity Report**: Cover Page, Integrity Overview (Overall Similarity, filters, the four match groups, internet / publications / submitted works shares, integrity flags), the numbered Top Sources list, then every page of the paper with matches highlighted in each source's colour and source numbers in the margin.
- **AI Writing Report**: Cover Page, AI Writing Overview (percentage detected as AI, number of AI-generated segments, caution and disclaimer), then every page of the paper with the likely AI-generated text highlighted.

Both reports use the same page grid, typefaces, colours and wording as the reference reports in every scan.

## How it works

1. **Reading.** PDFs are read with pdf.js, keeping every word's position so highlights land on the original page. Word (.docx), text, Markdown, RTF and pasted text are laid out on Letter pages in Tinos.
2. **Text model.** Words, sentences and paragraphs; quotation marks; in-text citations (author-year and numbered); the bibliography; integrity flags for replaced characters (look-alike letters from other alphabets) and hidden text (invisible characters inside words, tiny text).
3. **Searching.** Eight-word phrases and keyword queries from the paper are searched in Wikipedia (full articles), OpenAlex, Crossref, Europe PMC and Semantic Scholar, plus Google Programmable Search when a key is given. Every earlier submission in the browser's repository and every other file in the same batch is searched too.
4. **Similarity.** Five-word fingerprints. Overall Similarity is the share of the paper's words matched to any source; Top Sources gives each matched word to the strongest source first, so overlapping sources are not counted twice. Matches are grouped as Not Cited or Quoted, Missing Quotations, Missing Citation, and Cited and Quoted. The bibliography, quoted text and small matches can be filtered out.
5. **AI writing.** Only qualifying prose is scored (no headings, lists, tables, bibliography or fragments). Each sentence is scored in overlapping windows of its neighbours by a logistic model over stylometric signals (vocabulary predictability, word length, sentence-length burstiness, stock transitions and phrases, citation, number and punctuation habits). The model was fitted on sentence-level labels from the reference AI Writing Report and reproduces its 27% on that manuscript. At least 300 qualifying words are needed; scores from 1% to 19% show as *% without highlights.

Everything runs in the browser. Only search phrases leave the device.

## Files

- `index.html`: the website, with the scanner, how it works, the reports, install steps and FAQ
- `app/index.html`: the installable app (scanner, submissions, settings)
- `assets/js/`: `text.js` (text model), `extract.js` (PDF, Word and text reading), `sources.js` (databases and the repository), `similarity.js` (matching), `ai.js` (AI writing detection), `report.js` (the two report PDFs), `ui.js` and `boot.js` (interface)
- `assets/vendor/`: pdf.js 3.11.174, pdf-lib 1.17.1, @pdf-lib/fontkit 1.1.1, mammoth 1.8.0
- `assets/fonts/`: Lexend Deca and Noto Sans (report headings and text), Tinos (Word and text pages); SIL Open Font License
- `manifest.webmanifest`, `sw.js`: installing and offline use
- `tests/`: Node checks for the engines

## Publish

The site is published by GitHub Pages from the `gh-pages` branch, which carries the same files as `main`. After changing `main`, publish with `git push origin main:gh-pages`.

- Website: https://pogi6969.github.io/TURN-IT-INN-DE-ASIS-ET.AL/
- App: https://pogi6969.github.io/TURN-IT-INN-DE-ASIS-ET.AL/app/

Run locally with `python3 -m http.server 8000` and open http://localhost:8000.

After changing any file, bump `VERSION` in `sw.js` so installed copies refresh.

## Tests

```
cd tests
npm install
npm test
```
