// Zemax OpticStudio ZMX import (minimal subset)
// - Accepts UTF-16LE/BE (BOM) and UTF-8
// - Supports: STANDARD-like, EVENASPH (TYPE EVENASPH + CONI + PARM)
// - Detects unsupported: Aspheric odd, Coord Break

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

function parseNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (s === '') return null;
  if (/^inf(inity)?$/i.test(s)) return Infinity;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function decodeZmxArrayBuffer(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length >= 2) {
    // UTF-16LE BOM
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      try {
        return new TextDecoder('utf-16le').decode(bytes);
      } catch (_) {
        // Fallback: manual decode
      }
    }
    // UTF-16BE BOM
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      try {
        return new TextDecoder('utf-16be').decode(bytes);
      } catch (_) {
        // Fallback below
      }
    }
  }

  // Heuristic (no BOM): detect UTF-16 by NUL bytes pattern.
  const sampleLen = Math.min(bytes.length, 4096);
  let zerosEven = 0;
  let zerosOdd = 0;
  for (let i = 0; i < sampleLen; i++) {
    if (bytes[i] === 0) {
      if (i % 2 === 0) zerosEven++;
      else zerosOdd++;
    }
  }
  const zeroRatio = (zerosEven + zerosOdd) / Math.max(1, sampleLen);
  if (zeroRatio > 0.2 && sampleLen >= 8) {
    // Many NULs: likely UTF-16.
    if (zerosOdd > zerosEven) {
      try {
        return new TextDecoder('utf-16le').decode(bytes);
      } catch (_) {}
    } else {
      try {
        return new TextDecoder('utf-16be').decode(bytes);
      } catch (_) {}
    }
  }

  // Default: UTF-8
  try {
    return new TextDecoder('utf-8').decode(bytes);
  } catch (_) {
    // Very old environments: fallback via latin1-ish mapping
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }
}

function tokenizeZmxLine(line) {
  // Split by whitespace, but keep "..." as one token.
  const out = [];
  let i = 0;
  const s = String(line);
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;

    if (s[i] === '"') {
      i++;
      let start = i;
      while (i < s.length && s[i] !== '"') i++;
      out.push(s.slice(start, i));
      if (i < s.length && s[i] === '"') i++;
      continue;
    }

    let start = i;
    while (i < s.length && !/\s/.test(s[i])) i++;
    out.push(s.slice(start, i));
  }
  return out;
}

function makeEmptyRow(id) {
  const row = {
    id,
    'object type': '',
    comment: '',
    surfType: 'Spherical',
    radius: '',
    thickness: '',
    semidia: '',
    material: '',
    conic: 0
  };
  for (let j = 1; j <= 10; j++) row[`coef${j}`] = 0;
  return row;
}

function ensureRow(rows, idx) {
  while (rows.length <= idx) rows.push(makeEmptyRow(rows.length));
  if (!rows[idx]) rows[idx] = makeEmptyRow(idx);
  rows[idx].id = idx;
  return rows[idx];
}

function markDefaultsForObjectAndImage(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  if (!rows[0]) rows[0] = makeEmptyRow(0);
  rows[0].id = 0;
  if (!rows[0]['object type']) rows[0]['object type'] = 'Object';

  const last = rows.length - 1;
  if (!rows[last]) rows[last] = makeEmptyRow(last);
  rows[last].id = last;
  if (!rows[last]['object type']) rows[last]['object type'] = 'Image';
}

export function parseZMXTextToOpticalSystemRows(zmxText, options = {}) {
  const text = String(zmxText ?? '');
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const rows = [];
  const issues = [];

  let currentSurf = null;

  const addIssue = (severity, message) => {
    issues.push({ severity, message });
  };

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const raw = lines[lineNo];
    const line = String(raw ?? '').trim();
    if (line === '') continue;

    const tokens = tokenizeZmxLine(line);
    if (tokens.length === 0) continue;

    const key = String(tokens[0] ?? '').toUpperCase();

    if (key === 'SURF') {
      const idx = parseNumberOrNull(tokens[1]);
      if (idx === null || !Number.isFinite(idx) || idx < 0) {
        addIssue('warning', `Invalid SURF index at line ${lineNo + 1}: ${line}`);
        currentSurf = null;
        continue;
      }
      currentSurf = Math.trunc(idx);
      ensureRow(rows, currentSurf);
      continue;
    }

    // Most records apply to a surface, but some are global (UNIT/NAME/NOTE/etc).
    // If we see a surface record without a SURF header, we treat it as a warning.
    const needsSurf = new Set(['STOP', 'CURV', 'DISZ', 'GLAS', 'DIAM', 'TYPE', 'CONI', 'PARM', 'COMM']);
    if (needsSurf.has(key) && (currentSurf === null || currentSurf === undefined)) {
      addIssue('warning', `Record without SURF context at line ${lineNo + 1}: ${line}`);
      continue;
    }

    if (key === 'STOP') {
      const row = ensureRow(rows, currentSurf);
      row['object type'] = 'Stop';
      continue;
    }

    if (key === 'CURV') {
      const row = ensureRow(rows, currentSurf);
      const curv = parseNumberOrNull(tokens[1]);
      if (curv === null) continue;
      if (curv === 0) {
        row.radius = 'INF';
      } else if (!Number.isFinite(curv)) {
        row.radius = 'INF';
      } else {
        row.radius = 1 / curv;
      }
      continue;
    }

    if (key === 'DISZ') {
      const row = ensureRow(rows, currentSurf);
      const disz = parseNumberOrNull(tokens[1]);
      if (disz === null) continue;
      // If a very large placeholder is used, treat it as INF for co-opt.
      if (disz === Infinity || (Number.isFinite(disz) && Math.abs(disz) >= 1e9)) {
        row.thickness = 'INF';
        addIssue('warning', `DISZ treated as INF at surface ${currentSurf} (value=${tokens[1]}).`);
      } else {
        row.thickness = disz;
      }
      continue;
    }

    if (key === 'GLAS') {
      const row = ensureRow(rows, currentSurf);
      const name = String(tokens[1] ?? '').trim();
      if (!isBlank(name)) row.material = name;
      continue;
    }

    if (key === 'DIAM') {
      const row = ensureRow(rows, currentSurf);
      const semidia = parseNumberOrNull(tokens[1]);
      if (semidia === null) continue;
      row.semidia = semidia;
      continue;
    }

    if (key === 'TYPE') {
      const row = ensureRow(rows, currentSurf);
      const typeName = String(tokens[1] ?? '').trim().toUpperCase();
      if (typeName === 'EVENASPH') {
        row.surfType = 'Aspheric even';
      } else if (typeName === 'COORDBRK' || typeName === 'COORD' || typeName === 'COORDINATEBREAK') {
        const err = new Error(`Zemax import: Coord Break surfaces are not supported yet (surface ${currentSurf}).`);
        err.code = 'ZMX_UNSUPPORTED_COORDBRK';
        throw err;
      } else if (typeName.includes('ODD')) {
        const err = new Error(`Zemax import: Aspheric odd surfaces are not supported yet (surface ${currentSurf}).`);
        err.code = 'ZMX_UNSUPPORTED_ODD';
        throw err;
      } else {
        // Default: treat as spherical/standard.
        row.surfType = 'Spherical';
      }
      continue;
    }

    if (key === 'CONI') {
      const row = ensureRow(rows, currentSurf);
      const coni = parseNumberOrNull(tokens[1]);
      if (coni === null) continue;
      row.conic = coni;
      continue;
    }

    if (key === 'PARM') {
      const row = ensureRow(rows, currentSurf);
      const idx = parseNumberOrNull(tokens[1]);
      const val = parseNumberOrNull(tokens[2]);
      if (idx === null || val === null) continue;
      const j = Math.trunc(idx);
      if (j >= 1 && j <= 10) {
        row[`coef${j}`] = val;
      } else {
        addIssue('warning', `PARM index out of range (1..10) at surface ${currentSurf}: ${j}`);
      }
      continue;
    }

    if (key === 'COMM') {
      const row = ensureRow(rows, currentSurf);
      // COMM "..." or COMM token...
      const comment = tokens.length >= 2 ? String(tokens.slice(1).join(' ')).trim() : '';
      if (comment) row.comment = comment.replace(/^"|"$/g, '');
      continue;
    }

    // Soft-detect unsupported surface types even without TYPE.
    if (key === 'COORDBRK' || key === 'COORD' || key === 'COORDINATEBREAK') {
      const err = new Error(`Zemax import: Coord Break surfaces are not supported yet (surface ${currentSurf}).`);
      err.code = 'ZMX_UNSUPPORTED_COORDBRK';
      throw err;
    }
  }

  if (Array.isArray(rows)) {
    markDefaultsForObjectAndImage(rows);
  }

  // Ensure ids are contiguous and consistent
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i] || typeof rows[i] !== 'object') rows[i] = makeEmptyRow(i);
    rows[i].id = i;
  }

  // Basic guard: avoid empty import
  if (rows.length === 0) {
    const err = new Error('Zemax import: no SURF records found.');
    err.code = 'ZMX_EMPTY';
    throw err;
  }

  return { rows, issues };
}

export function parseZMXArrayBufferToOpticalSystemRows(arrayBuffer, options = {}) {
  const text = decodeZmxArrayBuffer(arrayBuffer);
  return parseZMXTextToOpticalSystemRows(text, options);
}
