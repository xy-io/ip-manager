// ============================================================
//  Release notes for the "what's new" dialog
//
//  The content comes from wiki/Whats-New.md, which is already written in
//  user-facing language and already updated with every release. Writing a
//  second, shorter set of notes for a popup would guarantee the two drift
//  apart, and the one people see would be the one nobody remembered to update.
//
//  The CHANGELOG is deliberately NOT the source: it is written for someone
//  deciding whether a bug affects them, full of parser internals and session
//  semantics. Correct, and the wrong register for a dialog that interrupts you.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');

// The wiki ships with the repository, so this resolves on a real install.
// '..' twice because this module lives in server/lib/.
const NOTES_FILE = process.env.RELEASE_NOTES_FILE
  || path.join(__dirname, '..', '..', 'wiki', 'Whats-New.md');

// A dialog is not a changelog. Past these limits it stops being a summary.
const MAX_VERSIONS = 3;
const MAX_PARAGRAPHS = 6;
const MAX_PARAGRAPH_CHARS = 400;

/**
 * Compare two version strings numerically, segment by segment.
 *
 * String comparison is wrong here in a way that only shows up later:
 * "2.9.0" > "2.13.0" alphabetically, so a user on 2.9.0 would never be told
 * about anything again.
 */
function compareVersions(a, b) {
  const parse = (v) => String(v || '')
    .replace(/^v/i, '')
    .split('.')
    .map((part) => parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

/**
 * Split the markdown into { version, title, paragraphs } sections.
 *
 * Headings look like:  ## v2.13.0 — Pi-hole can name your unrecognised devices
 */
function parseNotes(markdown) {
  const lines = String(markdown || '').split('\n');
  const sections = [];
  let current = null;

  for (const line of lines) {
    const heading = line.match(/^##\s+v?(\d+(?:\.\d+)*)\s*(?:[—–-]\s*(.*))?$/);
    if (heading) {
      if (current) sections.push(current);
      current = { version: heading[1], title: (heading[2] || '').trim(), paragraphs: [], buffer: [] };
      continue;
    }
    if (!current) continue;                       // preamble before the first release
    if (/^---\s*$/.test(line)) continue;          // section rules are not content

    if (line.trim() === '') {
      if (current.buffer.length) {
        current.paragraphs.push(current.buffer.join(' ').trim());
        current.buffer = [];
      }
      continue;
    }
    current.buffer.push(line.trim());
  }
  if (current) {
    if (current.buffer.length) current.paragraphs.push(current.buffer.join(' ').trim());
    sections.push(current);
  }

  return sections.map(({ version, title, paragraphs }) => ({
    version,
    title,
    paragraphs: paragraphs
      .filter(Boolean)
      .slice(0, MAX_PARAGRAPHS)
      .map((p) => (p.length > MAX_PARAGRAPH_CHARS ? `${p.slice(0, MAX_PARAGRAPH_CHARS - 1).trimEnd()}…` : p)),
  }));
}

/**
 * The releases worth showing to someone moving from `lastSeen` to `current`.
 *
 * Returns everything newer than `lastSeen` up to and including `current`, so a
 * user who skipped three updates gets all three rather than only the newest —
 * that is exactly the person who most needs telling.
 */
function notesSince(markdown, lastSeen, current) {
  return parseNotes(markdown)
    .filter((section) => {
      if (compareVersions(section.version, current) > 0) return false;   // unreleased
      if (!lastSeen) return compareVersions(section.version, current) === 0;
      return compareVersions(section.version, lastSeen) > 0;
    })
    .sort((a, b) => compareVersions(b.version, a.version))
    .slice(0, MAX_VERSIONS);
}

/** Read the notes file, returning '' rather than throwing when it is absent. */
function readNotesFile(file = NOTES_FILE) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    // A missing wiki directory must not break the application; it just means
    // there is nothing to show.
    return '';
  }
}

module.exports = {
  compareVersions,
  parseNotes,
  notesSince,
  readNotesFile,
  NOTES_FILE,
  LIMITS: { MAX_VERSIONS, MAX_PARAGRAPHS, MAX_PARAGRAPH_CHARS },
};
