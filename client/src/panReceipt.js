// Reads the details from a UTIITSL PAN acknowledgment receipt. Works on the text
// lines of the PDF, so it needs no network and the file never leaves the browser.
const after = (lines, label, pattern) => {
  const at = lines.findIndex(l => label.test(l));
  if (at < 0) return '';
  // The value is on the same line, or on one of the next, depending on the receipt.
  for (const line of [lines[at].replace(label, ''), ...lines.slice(at + 1, at + 3)]) {
    const found = line.match(pattern);
    if (found) return found[1] ?? found[0];
  }
  return '';
};

export function parsePanReceipt(lines) {
  const text = lines.join('\n');
  if (!/PAN Application Acknowledgment Receipt/i.test(text)) return null;
  const applicationNo = (text.match(/\bU-([A-Z][0-9]{6,12})\b/) || [])[1]; // without the U-
  if (!applicationNo) return null;
  const date = /\b\d{2}\/\d{2}\/\d{4}\b/;
  const nameLine = lines.find(l => /Name as per Aadhaar/i.test(l)) || '';
  // The applicant's number comes before their email. The centre's comes after its email.
  const mobile = (text.match(/\b([6-9][0-9]{9})\s*\/\s*\S+@/) || [])[1] || '';
  return {
    panKind: /Changes Or Correction/i.test(text) ? 'Correction' : 'New',
    name: nameLine.replace(/.*Name as per Aadhaar\s*:?/i, '').trim(),
    birthDate: after(lines, /Date of Birth\s*:?/i, date),
    whatsapp: mobile,
    applicationNo,
    appliedOn: after(lines, /Date of (?:Receipt|Application)\s*:?/i, date),
  };
}

// Turns a PDF into lines of text, top to bottom, left to right.
export async function pdfLines(file) {
  const [{ getDocument, GlobalWorkerOptions }, { default: worker }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc = worker;
  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1);
  const { items } = await page.getTextContent();
  const rows = [];
  for (const item of items.filter(i => i.str.trim())) {
    const [x, y] = [item.transform[4], item.transform[5]];
    let row = rows.find(r => Math.abs(r.y - y) < 4);
    if (!row) rows.push(row = { y, parts: [] });
    row.parts.push({ x, text: item.str });
  }
  return rows.sort((a, b) => b.y - a.y).map(r => r.parts.sort((a, b) => a.x - b.x).map(p => p.text).join(' ').replace(/\s+/g, ' ').trim());
}
