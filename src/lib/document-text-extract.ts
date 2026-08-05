// Extracts plain text from an uploaded race-calendar document, client-side,
// so the server-side AI parsing step (parseRaceScheduleText in
// race-schedule.functions.ts) only ever has to deal with a plain string —
// same reasoning as sending a rendered image rather than a raw file
// upload through a server function boundary, just simpler to get right
// for documents than for images. A scanned/image-only PDF (no real text
// layer) won't extract anything useful here — there's no OCR step, so
// that's a real limitation, not a bug, if it comes up.
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import * as mammoth from "mammoth";
import ExcelJS from "exceljs";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it: any) => ("str" in it ? it.str : "")).join(" ");
    pages.push(text);
  }
  return pages.join("\n\n");
}

async function extractDocxText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value;
}

async function extractXlsxText(file: File): Promise<string> {
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
  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    return extractPdfText(file);
  }
  if (file.type.includes("wordprocessingml") || name.endsWith(".docx")) {
    return extractDocxText(file);
  }
  if (
    file.type.includes("spreadsheetml") ||
    file.type === "application/vnd.ms-excel" ||
    name.endsWith(".xlsx") ||
    name.endsWith(".xls")
  ) {
    return extractXlsxText(file);
  }
  throw new Error("Unsupported file type — use a PDF, Word (.docx), or Excel (.xlsx) file, or paste the text directly.");
}
