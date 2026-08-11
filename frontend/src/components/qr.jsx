// Minimal QR Code generator — byte mode, ECC M. Pure JS, no dependencies.
// Implements Reed-Solomon ECC and standard matrix construction with masking.

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function mul(a, b) { return a === 0 || b === 0 ? 0 : GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255]; }

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= mul(poly[j], GF_EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, eccCount) {
  const gen = rsGeneratorPoly(eccCount);
  const res = new Array(data.length + eccCount).fill(0);
  data.forEach((d, i) => res[i] = d);
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= mul(gen[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

const VERSIONS = [
  null,
  { size: 21, ec: [7, 10, 13, 17], dc: [19, 16, 13, 9] },
  { size: 25, ec: [10, 16, 22, 28], dc: [34, 28, 22, 16] },
  { size: 29, ec: [15, 26, 36, 44], dc: [55, 44, 34, 26] },
  { size: 33, ec: [20, 36, 52, 64], dc: [80, 64, 48, 36] },
  { size: 37, ec: [26, 48, 72, 88], dc: [108, 86, 62, 46] },
  { size: 41, ec: [36, 64, 96, 112], dc: [136, 108, 76, 60] },
  { size: 45, ec: [40, 72, 108, 130], dc: [156, 124, 88, 66] },
  { size: 49, ec: [48, 88, 132, 156], dc: [194, 154, 110, 86] },
  { size: 53, ec: [60, 110, 160, 192], dc: [232, 182, 132, 100] },
  { size: 57, ec: [72, 130, 192, 224], dc: [274, 216, 154, 122] }
];

const EC_INDEX = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_TABLE = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
  0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
  0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b,
  0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed
];

function chooseVersion(dataLen, ecLevel) {
  const ei = EC_INDEX[ecLevel] ?? 1;
  for (let v = 1; v <= 10; v++) {
    const V = VERSIONS[v];
    const cap = (v <= 9 ? v : 0) * 0;
    const dataCap = V.dc[ei]; // number of data codewords for ECC level
    if (dataLen <= dataCap) return v;
  }
  return 10;
}

export function makeQR(text, opts = {}) {
  const ecLevel = opts.ecLevel || 'M';
  const ei = EC_INDEX[ecLevel] ?? 1;

  // --- encode data bytes (byte mode) ---
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = chooseVersion(bytes.length, ecLevel);
  const V = VERSIONS[version];
  const eccCount = V.ec[ei];
  const dataCount = V.dc[ei];

  const modeBits = 0b0100; // byte
  let bitBuf = 0, bitLen = 0;
  const codewords = [];
  function pushBits(val, len) {
    for (let i = len - 1; i >= 0; i--) {
      bitBuf = (bitBuf << 1) | ((val >> i) & 1);
      bitLen++;
      if (bitLen === 8) { codewords.push(bitBuf); bitBuf = 0; bitLen = 0; }
    }
  }
  pushBits(modeBits, 4);
  const charCountBits = version <= 9 ? 8 : 16;
  pushBits(bytes.length, charCountBits);
  for (const b of bytes) pushBits(b, 8);

  // terminator + padding
  pushBits(0, Math.min(4, (dataCount * 8) - codewords.length * 8));
  while (codewords.length < dataCount) {
    if (bitLen > 0) { pushBits(0, 8 - bitLen); }
    codewords.push(0xec, 0x11);
  }
  codewords.length = dataCount;

  // --- ECC ---
  const blocks = 1;
  const ecc = rsEncode(codewords, eccCount);
  const allCodewords = [...codewords, ...ecc];

  // --- build matrix ---
  const size = V.size;
  const m = Array.from({ length: size }, () => new Uint8Array(size));

  function setModule(r, c, v) { m[r][c] = v ? 1 : 0; }
  function isFunc(r, c) {
    // finder + separator + alignment + timing + format/dark
    const inFinder = (r <= 8 && c <= 8) || (r >= size - 9 && c <= 8) || (r <= 8 && c >= size - 9);
    if (inFinder) return true;
    if (r === 6 || c === 6) return true; // timing + format row/col
    return false;
  }

  // finder patterns
  function drawFinder(r0, c0) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const dark = (r === 0 || r === 6 || c === 0 || c === 6) || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      setModule(rr, cc, inRing && dark);
    }
  }
  drawFinder(0, 0); drawFinder(0, size - 7); drawFinder(size - 7, 0);

  // timing
  for (let i = 8; i < size - 8; i++) { setModule(6, i, i % 2 === 0); setModule(i, 6, i % 2 === 0); }

  // alignment pattern (center at bottom-right region for v>=2)
  if (version >= 2) {
    const centers = [[size - 7, size - 7]];
    if (version >= 7) centers.push([6, size - 7], [size - 7, 6]);
    for (const [r, c] of centers) {
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
        setModule(r + dr, c + dc, dark);
      }
    }
  }

  // --- place codewords ---
  let bitIdx = 0;
  const bits = [];
  for (const cw of allCodewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);

  function nextBit() { return bits[bitIdx++] ?? 0; }

  let col = size - 1, upward = true;
  while (col >= 1) {
    if (col === 6) col--; // skip timing column
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let k = 0; k < 2; k++) {
        const c = col - k;
        if (!isFunc(row, c)) setModule(row, c, nextBit());
      }
    }
    upward = !upward;
    col -= 2;
  }

  // --- format info + dark module ---
  const format = FORMAT_TABLE[(ei << 3) | (opts.mask ?? 0)] ?? FORMAT_TABLE[0];
  // (default mask 0 handled below; we compute best mask after)
  setModule(size - 8, 8, 1); // dark module

  // --- masking + penalty ---
  const masks = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];

  function applyFormat(formatBits, matrix) {
    for (let i = 0; i < 15; i++) {
      const bit = (formatBits >> i) & 1;
      // horizontal copy (around top-left)
      let r1, c1;
      if (i < 6) { r1 = i; c1 = 8; }
      else if (i < 8) { r1 = i + 1; c1 = 8; }
      else { r1 = 8; c1 = 14 - i; }
      if (!isFunc(r1, c1)) matrix[r1][c1] = bit;
      // vertical copy
      let r2, c2;
      if (i < 8) { r2 = 8; c2 = size - 1 - i; }
      else { r2 = 8; c2 = size - 15 + i; }
      if (!isFunc(r2, c2)) matrix[r2][c2] = bit;
    }
    matrix[size - 8][8] = 1; // dark module
  }

  function penalty(maskIdx) {
    const mm = m.map((row) => row.slice());
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (!isFunc(r, c)) mm[r][c] = mm[r][c] ^ (masks[maskIdx](r, c) ? 1 : 0);
    }
    applyFormat(FORMAT_TABLE[(ei << 3) | maskIdx], mm);
    // penalty: adjacent same color runs
    let score = 0;
    for (let r = 0; r < size; r++) {
      let run = 1;
      for (let c = 1; c < size; c++) {
        if (mm[r][c] === mm[r][c - 1]) { run++; }
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (let c = 0; c < size; c++) {
      let run = 1;
      for (let r = 1; r < size; r++) {
        if (mm[r][c] === mm[r - 1][c]) { run++; }
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    // blocks of 2x2 same color
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = mm[r][c];
      if (mm[r][c + 1] === v && mm[r + 1][c] === v && mm[r + 1][c + 1] === v) score += 3;
    }
    return score;
  }

  let best = 0, bestScore = Infinity;
  for (let i = 0; i < 8; i++) {
    const s = penalty(i);
    if (s < bestScore) { bestScore = s; best = i; }
  }

  const final = m.map((row) => row.slice());
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (!isFunc(r, c)) final[r][c] = final[r][c] ^ (masks[best](r, c) ? 1 : 0);
  }
  applyFormat(FORMAT_TABLE[(ei << 3) | best], final);

  return final;
}

export function QRCode({ value, size = 120, quiet = 2 }) {
  const matrix = makeQR(value || 'propease');
  const n = matrix.length;
  const cell = size / (n + quiet * 2);
  const rects = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        rects.push(<rect key={`${r}-${c}`} x={(c + quiet) * cell} y={(r + quiet) * cell} width={cell + 0.4} height={cell + 0.4} fill="#000" />);
      }
    }
  }
  return (
    <svg className="qr" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {rects}
    </svg>
  );
}
