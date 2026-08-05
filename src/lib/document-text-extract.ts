// Extracts plain text from an uploaded race-calendar document, client-side,
// so the server-side AI parsing step (parseRaceScheduleText in
// race-schedule.functions.ts) only ever has to deal with a plain string.
// A scanned/image-only PDF (no real text layer) won't extract anything
// useful here — there's no OCR step, so that's a real limitation, not a
// bug, if it comes up.
//
// All three libraries are imported lazily (dynamic import), not at module
// top level. Two reasons: they're only ever needed at the moment someone
// actually picks a file, no reason to pull them into the initial page
// bundle otherwise — and, more importantly, this guarantees none of their
// browser-only setup code (pdfjs-dist's worker options in particular) can
// ever run in a non-browser context, which a static top-level import
// can't guarantee in a framework that server-renders route components.
//
// pdfjs-dist's worker is loaded via Vite's dedicated `?worker` import,
// which hands back a proper Worker constructor Vite bundles correctly —
// more robust than pointing workerSrc at a raw `?url` asset path, which
// is a common source of "PDF text extraction silently does nothing"
// issues across Vite projects depending on how the dev/build pipeline
// handles worker MIME types.

async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  const PdfWorkerModule = await import("pdfjs-dist/build/pdf.worker.min.mjs?worker");
  pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorkerModule.default();

  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it: any) => ("str" in it ? it.str : "")).join(" ");
    pages.push(text);
  }
  const joined = pages.join("\n\n");
  if (!joined.trim()) {
    throw new Error("No readable text found in this PDF — it may be a scanned image rather than a real text document. Try pasting the text instead.");
  }
  return joined;
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value;
}

async function extractXlsxText(file: File): Promise<string> {
  const { default: ExcelJS } = await import("exceljs");
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const lines: string[] = [];
  wb.eachSheet((sheet) => {
    lines.push(`--- Sheet: ${sheet.name} ---`);
    sheet.eachRow((row) => {
      // row.values is 1-indexed with a leading empty slot — slice(1) drops it.
      const cells = (row.values as any[]).slice(1).map((v) => (v == null ? "" : String(v)));
      if (cells.some((c) => c.trim() !== "")) lines.push(cells.join(" | "));
    });
  });
  return lines.join("\n");
}

export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  try {
    if (file.type === "application/pdf" || name.endsWith(".pdf")) {
      return await extractPdfText(file);
    }
    if (file.type.includes("wordprocessingml") || name.endsWith(".docx")) {
      return await extractDocxText(file);
    }
    if (
      file.type.includes("spreadsheetml") ||
      file.type === "application/vnd.ms-excel" ||
      name.endsWith(".xlsx") ||
      name.endsWith(".xls")
    ) {
      return await extractXlsxText(file);
    }
  } catch (err: any) {
    // Re-throw with the file name attached — the caller shows this
    // directly in a toast, and "couldn't read agenda.pdf: <reason>" is a
    // lot more actionable than a bare library error message alone.
    throw new Error(`Couldn't read ${file.name}: ${err?.message ?? "unknown error"}`);
  }
  throw new Error(`Unsupported file type (${file.type || "unknown"}) — use a PDF, Word (.docx), or Excel (.xlsx) file, or paste the text directly.`);
}
