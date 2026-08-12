// Minimal pure-JS PDF writer (text + tables + embedded PNG logo) — no external deps.
// Good enough for invoices, brochures, reports and reminders.
import { inflateSync, deflateSync } from 'node:zlib';

const W = 595; // A4 width pt
const H = 842; // A4 height pt

// ---- PNG parsing (for logo embedding) ---------------------------------------
// Returns { data, width, height } of a truecolor RGB image (alpha dropped),
// or null if the PNG is unsupported (interlaced, >8-bit, palette, etc).
export function decodePng(buf) {
  if (!buf || buf.length < 24) return null;
  const sig = buf.slice(0, 8);
  if (!sig.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    off += 12 + len;
    if (type === 'IEND') break;
  }
  if (!width || !height || !idat.length) return null;
  if (interlace !== 0 || bitDepth !== 8 || colorType === 3) return null;
  const ch = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!ch) return null;
  let raw;
  try { raw = inflateSync(Buffer.concat(idat)); } catch { return null; }
  const stride = width * ch;
  const bpp = ch;
  const out = Buffer.alloc(width * height * 3);
  const rowBytes = stride;
  let prev = Buffer.alloc(rowBytes);
  for (let r = 0; r < height; r++) {
    const f = raw[r * (rowBytes + 1)];
    const src = raw.slice(r * (rowBytes + 1) + 1, (r + 1) * (rowBytes + 1));
    const dst = Buffer.alloc(rowBytes);
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? dst[i - bpp] : 0;
      const b = r > 0 ? prev[i] : 0;
      const c = r > 0 && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      dst[i] = v & 0xff;
    }
    prev = dst;
    const rowOut = out.slice(r * width * 3, (r + 1) * width * 3);
    if (ch === 1) {
      for (let x = 0; x < width; x++) { rowOut[x * 3] = rowOut[x * 3 + 1] = rowOut[x * 3 + 2] = dst[x]; }
    } else if (ch === 2) {
      for (let x = 0; x < width; x++) { rowOut[x * 3] = rowOut[x * 3 + 1] = rowOut[x * 3 + 2] = dst[x * 2]; }
    } else if (ch === 3) {
      dst.copy(rowOut);
    } else {
      for (let x = 0; x < width; x++) {
        rowOut[x * 3] = dst[x * 4];
        rowOut[x * 3 + 1] = dst[x * 4 + 1];
        rowOut[x * 3 + 2] = dst[x * 4 + 2];
      }
    }
  }
  return { data: out, width, height };
}

// Wrap text into lines that fit maxw (rough width estimate, pt).
function wrapLines(s, maxw, scale = 4.2) {
  const out = [];
  let cur = '';
  for (const word of String(s ?? '').split(' ')) {
    const test = cur ? cur + ' ' + word : word;
    if (test.length * scale > maxw && cur) { out.push(cur); cur = word; }
    else cur = test;
  }
  if (cur) out.push(cur);
  return out;
}

// ---- PDF builder ------------------------------------------------------------
// opts: { title, subtitle, company, billTo, meta, rows, bank, footer, note }
//   company: { name, tagline, logo (Buffer), address, gst, rera, phone, email, website }
//   billTo:  { name, phone, email, address, gstin }
export function pdf({ title = '', subtitle = '', company = null, billTo = null, meta = [], rows = [], tables = null, bank = null, footer = '', note = '' } = {}) {
  // Map common non-Latin-1 symbols to Latin-1-safe equivalents (Helvetica can't encode ₹/—/etc).
  const ascii = (s) => String(s ?? '').replace(/₹/g, 'Rs. ').replace(/—|–|‐/g, '-').replace(/['']/g, "'").replace(/[""]/g, '"').replace(/…/g, '...').replace(/[\u0080-\uFFFF]/g, '');
  const esc = (s) => ascii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const chunks = [];
  let y = H - 74;

  const textAt = (s, size, x, yy, color = '0 0 0 rg') => {
    chunks.push(color, 'BT', `/F1 ${size} Tf`, `${x} ${yy} Td`, `(${esc(s)}) Tj`, 'ET');
  };

  const hline = (x1, x2, yy) => {
    chunks.push('0.75 0.8 0.85 RG', '0.6 w', `${x1} ${yy} m`, `${x2} ${yy} l`, 'S');
  };

  // ---------- logo decode ----------
  let png = null;
  if (company?.logo && company.logo.length > 8 && company.logo[0] === 0x89) png = decodePng(company.logo);
  const logoMax = 46;
  let logoW = 0, logoH = 0;
  if (png) {
    const scale = Math.min(logoMax / png.width, logoMax / png.height, 1);
    logoW = Math.round(png.width * scale);
    logoH = Math.round(png.height * scale);
  }

  // ---------- header band ----------
  chunks.push('0.145 0.263 0.851 rg', `0 ${H - 46} ${W} 46 re f`);
  if (title) textAt(title, 15, 40, H - 20, '1 1 1 rg');
  if (subtitle) textAt(subtitle, 9.5, 40, H - 36, '0.85 0.88 0.95 rg');
  y = H - 74;

  // ---------- company block ----------
  const cx = 40;
  let nx = cx;
  if (png) {
    chunks.push('q', `${logoW} 0 0 ${logoH} ${cx} ${y - logoH} cm`, '/Im6 Do', 'Q');
    nx = cx + logoW + 12;
    y -= logoH;
  }
  let yy = y;
  if (company?.name) { textAt(company.name, 14, nx, yy, '0.09 0.17 0.45 rg'); yy -= 15; }
  if (company?.tagline) { textAt(company.tagline, 8.5, nx, yy, '0.45 0.47 0.55 rg'); yy -= 11; }
  if (png) y = Math.min(y - logoH, yy); else y = yy;

  // company contact lines (right-aligned, top of page band)
  const companyLines = [];
  if (company?.address) companyLines.push(...wrapLines(company.address, 150, 4.4));
  if (company?.phone) companyLines.push(`Phone: ${company.phone}`);
  if (company?.email) companyLines.push(`Email: ${company.email}`);
  if (company?.website) companyLines.push(`Web: ${company.website}`);
  if (company?.gst) companyLines.push(`GSTIN: ${company.gst}`);
  if (company?.rera) companyLines.push(`RERA: ${company.rera}`);
  let rtop = H - 50;
  for (const l of companyLines) {
    textAt(l, 8.5, W - 40 - Math.min(ascii(l).length * 4.1, 150), rtop, '0.25 0.28 0.35 rg');
    rtop -= 11.5;
  }
  y = Math.max(y, H - 50 - companyLines.length * 11.5);
  hline(40, W - 40, y - 6);
  y -= 16;

  // ---------- bill-to + meta ----------
  if (billTo?.name || meta.length) {
    let byy = y - 2;
    if (billTo?.name) {
      textAt('BILL TO', 8.5, 40, byy, '0.45 0.47 0.55 rg');
      byy -= 14;
      textAt(billTo.name, 11, 40, byy, '0 0 0 rg'); byy -= 13;
      if (billTo.address) for (const l of wrapLines(billTo.address, 200, 4.3)) { textAt(l, 9, 40, byy, '0.3 0.33 0.4 rg'); byy -= 11; }
      if (billTo.phone) { textAt(`Phone: ${billTo.phone}`, 9, 40, byy, '0.3 0.33 0.4 rg'); byy -= 11; }
      if (billTo.email) { textAt(billTo.email, 9, 40, byy, '0.3 0.33 0.4 rg'); byy -= 11; }
      if (billTo.gstin) { textAt(`GSTIN: ${billTo.gstin}`, 9, 40, byy, '0.3 0.33 0.4 rg'); byy -= 11; }
    }
    if (meta.length) {
      let myy = y - 2;
      for (const [k, v] of meta) {
        textAt(k, 9, W - 40 - 155, myy, '0.45 0.47 0.55 rg');
        textAt(v, 9, W - 40 - 155 + Math.min(ascii(k).length * 4.6 + 10, 60), myy, '0 0 0 rg');
        myy -= 13;
      }
    }
    y = Math.min(byy, y - 2 - meta.length * 13);
    hline(40, W - 40, y - 6);
    y -= 16;
  }

  // ---------- table(s) ----------
  const renderTable = (tableRows) => {
    if (!tableRows.length) return;
    const cols = Object.keys(tableRows[0]);
    const colW = Math.min(160, Math.floor(515 / Math.max(1, cols.length)));
    const hx = 40;
    chunks.push('0.145 0.263 0.851 rg', `${hx} ${y - 14} 515 16 re f`);
    cols.forEach((c, i) => {
      chunks.push('1 1 1 rg', 'BT', `/F1 9 Tf`, `${hx + i * colW + 4} ${y - 3} Td`, `(${esc(c.toUpperCase())}) Tj`, 'ET');
    });
    y -= 24;
    for (const r of tableRows.slice(0, 60)) {
      if (y < 60) break;
      cols.forEach((c, i) => {
        chunks.push('0 0 0 rg', 'BT', `/F1 9 Tf`, `${hx + i * colW + 4} ${y} Td`, `(${esc(String(r[c] ?? '')).slice(0, 32)}) Tj`, 'ET');
      });
      y -= 15;
    }
    hline(hx, W - 40, y - 2);
    y -= 12;
  };

  if (Array.isArray(tables) && tables.length) {
    for (const t of tables) renderTable(t.rows || t);
  } else if (rows.length) {
    renderTable(rows);
  }

  // ---------- bank details ----------
  if (bank) {
    const bankLines = [];
    if (bank.bank) bankLines.push(`Bank: ${bank.bank}`);
    if (bank.account) bankLines.push(`A/c No: ${bank.account}`);
    if (bank.ifsc) bankLines.push(`IFSC: ${bank.ifsc}`);
    if (bank.branch) bankLines.push(`Branch: ${bank.branch}`);
    if (bankLines.length) {
      if (y - bankLines.length * 13 < 44) y = 44 + bankLines.length * 13;
      textAt('PAYMENT DETAILS', 8.5, 40, y, '0.45 0.47 0.55 rg');
      y -= 14;
      for (const l of bankLines) { textAt(l, 9, 40, y, '0.25 0.28 0.35 rg'); y -= 12; }
      y -= 6;
    }
  }

  // ---------- note ----------
  if (note) {
    if (y < 50) y = 50;
    textAt(note, 8.5, 40, y, '0.45 0.47 0.55 rg');
  }

  // ---------- footer ----------
  if (footer) {
    textAt(footer, 8, 40, 30, '0.45 0.47 0.55 rg');
  }
  chunks.push('0 0 0 RG', 'S');
  const content = chunks.join('\n');

  // Build the file with correct byte offsets for every object (proper xref table).
  const procSet = png ? '[/PDF/Text/ImageC]' : '[/PDF/Text]';
  const xobj = png ? '/XObject<</Im6 6 0 R>>' : '';
  const objects = [
    `<</Type/Catalog/Pages 2 0 R>>`,
    `<</Type/Pages/Kids[3 0 R]/Count 1>>`,
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W} ${H}]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>/ProcSet${procSet}${xobj}>>>>`
  ];
  if (png) {
    const raw = deflateSync(png.data);
    objects.push(
      `<</Length ${Buffer.byteLength(content, 'latin1')}>>stream\n${content}\nendstream`,
      `<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>`,
      `<</Type/XObject/Subtype/Image/Width ${png.width}/Height ${png.height}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/FlateDecode/Length ${raw.length}>>stream\n${raw.toString('latin1')}\nendstream`
    );
  } else {
    objects.push(
      `<</Length ${Buffer.byteLength(content, 'latin1')}>>stream\n${content}\nendstream`,
      `<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>`
    );
  }
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj${obj}endobj\n`;
  });
  const xrefPos = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((off) => {
    body += `${String(off).padStart(10, '0')} 00000 n \n`;
  });
  body += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

export function excelCsv(rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const head = cols.map(esc).join(',');
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\n');
  return head + '\n' + body;
}
