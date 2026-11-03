/**
 * Text out of a document, in the browser, with nothing sent anywhere to get it.
 *
 * A carrier's rate card arrives as a PDF and the desk has to read it on a laptop in a warehouse with
 * no signal. So the text is lifted locally - pdf.js for PDFs, plain reading for text and CSV - and only
 * the text ever leaves the machine. The file itself is never uploaded, which also means the operator is
 * not handing a supplier's price list to a model endpoint along with the question.
 *
 * PDFs are rendered as text layers only: a scan has no text layer, and rather than return an empty
 * string that looks like an empty document, that case is refused in words the operator can act on.
 */

const TEXTY = /\.(txt|csv|tsv|md|json|html?|xml)$/i;

export function isPdf(name) {
  return /\.pdf$/i.test(String(name || ""));
}

export function isPlainText(name) {
  return TEXTY.test(String(name || ""));
}

export function suffixOf(name) {
  const m = /(\.[a-z0-9]+)$/i.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "(no extension)";
}

/** PDF pages joined with a page break, so a rate table does not run its columns together. */
export async function pdfText(file, { maxChars = 20000 } = {}) {
  const pdfjs = await import("pdfjs-dist/build/pdf.min.mjs");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const parts = [];
  let used = 0;
  for (let p = 1; p <= doc.numPages && used < maxChars; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items.map((it) => (it.str ?? "") + (it.hasEOL ? "\n" : " ")).join("");
    parts.push(text.trim());
    used += text.length;
  }
  const total = doc.numPages;
  return { text: parts.join("\n\n").slice(0, maxChars), pages: total, empty: parts.join("").trim() === "" };
}

export async function fileText(file, opts = {}) {
  if (isPlainText(file.name)) {
    const raw = await file.text();
    return { text: raw.slice(0, opts.maxChars ?? 20000), pages: null, empty: raw.trim() === "" };
  }
  if (isPdf(file.name)) return pdfText(file, opts);
  const err = new Error(
    `${suffixOf(file.name)} files are not read in this build. Save it as a PDF, or as text or CSV, and attach that.`,
  );
  err.code = "UNREADABLE_TYPE";
  throw err;
}
