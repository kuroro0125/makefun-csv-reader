// A fast drop-in replacement for csv-reader 1.0.0.
//
// run(input) answers exactly what csv-reader's readCsv answers for the
// input {text, header}: the value {columns, rows, errors}. The reading
// policy is the reference's own (a BOM at the very start is dropped,
// records end at LF or CRLF, empty lines are no records, a lone CR
// outside quotes is dropped as stray_cr, quoted fields follow the
// doubled-quote rule with line breaks inside them read as LF, junk
// after a closing quote is appended and noted as quote_junk, a quote
// that never closes turns literal and the rest of the field is read
// again as unquoted text, rows are padded or cut to the first record's
// width with short_row / long_row notes, and every error is
// {code, line, row} in the order met).
//
// Where the reference walks one character at a time and grows each
// field a character at a time, this reader walks code units only as
// far as the next special character (a comma, a quote or a line
// break), copies each plain run in a single slice, and hands the
// finished field back through shared variables instead of a fresh
// result object per field, so the common case is one slice and a
// push per field. The slow paths (a lone CR inside an unquoted
// field, a quoted field full of escapes) assemble the field from
// parts, still run by run.

const COMMA_END = 0;
const BREAK_END = 1;
const TEXT_END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on, and the index it
  // takes in rows (null while the header is still to come).
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, and how many characters the last
  // readUnquoted call kept (quote_junk is noted only when it kept
  // at least one).
  let fieldValue = "";
  let fieldKept = 0;

  function fail(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or
  // line break; a CR not followed by LF is dropped (stray_cr).
  // Sets fieldValue and fieldKept; returns how the field ended.
  function readUnquoted(value) {
    // The plain run: walk code units to the next special character.
    // Most fields are short, so the walk is brief, and the run is
    // still copied with a single slice.
    let at = pos;
    for (;;) {
      if (at >= n) {
        fieldKept = at - pos;
        fieldValue = value + text.slice(pos, at);
        pos = at;
        return TEXT_END;
      }
      const c = text.charCodeAt(at);
      if (c === 44 || c === 10) {
        fieldKept = at - pos;
        fieldValue = value + text.slice(pos, at);
        pos = at + 1;
        if (c === 10) line += 1;
        return c === 44 ? COMMA_END : BREAK_END;
      }
      if (c === 13) {
        if (text.charCodeAt(at + 1) === 10) {
          fieldKept = at - pos;
          fieldValue = value + text.slice(pos, at);
          pos = at + 2;
          line += 1;
          return BREAK_END;
        }
        break; // a lone CR: the slow path below
      }
      at += 1;
    }
    // A lone CR: dropped, noted, and the field goes on from parts.
    const parts = [value, text.slice(pos, at)];
    let kept = at - pos;
    let from = at + 1;
    fail("stray_cr");
    for (;;) {
      let j = from;
      for (;;) {
        if (j >= n) {
          parts.push(text.slice(from, j));
          kept += j - from;
          pos = j;
          fieldValue = parts.join("");
          fieldKept = kept;
          return TEXT_END;
        }
        const c = text.charCodeAt(j);
        if (c === 44 || c === 10) {
          parts.push(text.slice(from, j));
          kept += j - from;
          fieldValue = parts.join("");
          fieldKept = kept;
          pos = j + 1;
          if (c === 10) line += 1;
          return c === 44 ? COMMA_END : BREAK_END;
        }
        if (c === 13) {
          if (text.charCodeAt(j + 1) === 10) {
            parts.push(text.slice(from, j));
            kept += j - from;
            fieldValue = parts.join("");
            fieldKept = kept;
            pos = j + 2;
            line += 1;
            return BREAK_END;
          }
          parts.push(text.slice(from, j));
          kept += j - from;
          fail("stray_cr");
          from = j + 1;
          break;
        }
        j += 1;
      }
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  // Sets fieldValue; returns how the field ended.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    const parts = [];
    let closed = false;
    for (;;) {
      // Walk code units to the next character that matters in here:
      // a quote, or a line break. Plain runs are copied whole.
      let at = pos;
      let c = -1;
      while (at < n) {
        c = text.charCodeAt(at);
        if (c === 34 || c === 10 || c === 13) break;
        at += 1;
      }
      if (at >= n) {
        parts.push(text.slice(pos));
        pos = n;
        break;
      }
      if (at > pos) parts.push(text.slice(pos, at));
      if (c === 34) {
        if (text.charCodeAt(at + 1) === 34) {
          parts.push('"');
          pos = at + 2;
          continue;
        }
        pos = at + 1;
        closed = true;
        break;
      }
      // A line break inside quotes is read as one LF and one line.
      parts.push("\n");
      line += 1;
      pos = c === 10 ? at + 1 : at + (text.charCodeAt(at + 1) === 10 ? 2 : 1);
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the
      // text after it is read again as an unquoted field. Any lines
      // counted on the way are given back.
      pos = open + 1;
      line = openLine;
      fail("unterminated_quote");
      return readUnquoted('"');
    }
    const value = parts.length === 1 ? parts[0] : parts.join("");
    if (pos >= n) {
      fieldValue = value;
      return TEXT_END;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fieldValue = value;
      return COMMA_END;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fieldValue = value;
      return BREAK_END;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fieldValue = value;
      return BREAK_END;
    }
    // What follows the closing quote is appended as it stands, up to
    // the next comma or line break.
    const ended = readUnquoted(value);
    if (fieldKept > 0) fail("quote_junk");
    return ended;
  }

  for (;;) {
    // Lines with no characters in them are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      ended = quoted ? readQuoted() : readUnquoted("");
      fields.push(fieldValue);
    } while (ended === COMMA_END);

    // A line that held only stray CRs is left with no characters:
    // no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === "" && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: "short_row", line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push("");
    } else if (fields.length > width) {
      errors.push({ code: "long_row", line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? columns ?? [] : null, rows, errors };
}
