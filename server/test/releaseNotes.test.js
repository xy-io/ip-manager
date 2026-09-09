// ============================================================
//  Release-notes tests
//
//  The version comparison matters more than it looks. Compared as strings,
//  "2.9.0" sorts after "2.13.0" — so a user on 2.9.0 would silently never be
//  shown anything again, and nobody would ever report it as a bug.
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { compareVersions, parseNotes, notesSince, readNotesFile } = require('../lib/releaseNotes');

const SAMPLE = `# What's New

For the full release history see the CHANGELOG.

---

## v2.13.0 — Pi-hole can name your unrecognised devices

If Pi-hole hands out your DHCP leases, it already knows what every device
calls itself.

**Leave it off if your router does DHCP.**

---

## v2.12.0 — Faster first load

Eight screens you only open occasionally are no longer downloaded before the
app appears.

---

## v2.9.1 — Hypervisor links that actually appear

Matching is now forgiving.
`;

// ── Version comparison ──────────────────────────────────────────────────────

test('versions compare numerically, not as strings', () => {
  // The trap: "2.9.0" > "2.13.0" alphabetically.
  assert.equal(compareVersions('2.13.0', '2.9.0'), 1);
  assert.equal(compareVersions('2.9.0', '2.13.0'), -1);
  assert.equal(compareVersions('2.13.0', '2.13.0'), 0);
});

test('a leading v is ignored and missing segments count as zero', () => {
  assert.equal(compareVersions('v2.13.0', '2.13.0'), 0);
  assert.equal(compareVersions('2.13', '2.13.0'), 0);
  assert.equal(compareVersions('2.13.1', '2.13'), 1);
  assert.equal(compareVersions('3', '2.99.99'), 1);
});

test('a missing or malformed version does not throw', () => {
  for (const v of [null, undefined, '', 'not-a-version']) {
    assert.equal(typeof compareVersions(v, '1.0.0'), 'number');
  }
});

// ── Parsing ─────────────────────────────────────────────────────────────────

test('sections are parsed with a version, a title and paragraphs', () => {
  const sections = parseNotes(SAMPLE);
  assert.equal(sections.length, 3);
  assert.equal(sections[0].version, '2.13.0');
  assert.equal(sections[0].title, 'Pi-hole can name your unrecognised devices');
  assert.ok(sections[0].paragraphs[0].startsWith('If Pi-hole hands out'));
});

test('wrapped lines are rejoined into one paragraph', () => {
  const [first] = parseNotes(SAMPLE);
  assert.ok(first.paragraphs[0].includes('calls itself'), 'the wrapped line should be joined');
  assert.ok(!first.paragraphs[0].includes('\n'));
});

test('horizontal rules and the preamble are not treated as content', () => {
  const sections = parseNotes(SAMPLE);
  for (const s of sections) {
    for (const p of s.paragraphs) assert.ok(!/^-+$/.test(p), 'a rule leaked into the content');
  }
  assert.ok(!sections.some((s) => s.paragraphs.some((p) => p.includes('full release history'))),
    'the preamble belongs to no release');
});

test('malformed markdown yields no sections rather than throwing', () => {
  assert.deepEqual(parseNotes(''), []);
  assert.deepEqual(parseNotes(null), []);
  assert.deepEqual(parseNotes('just some text with no headings'), []);
});

test('a very long paragraph is truncated', () => {
  const long = `## v1.0.0 — Title\n\n${'word '.repeat(400)}`;
  const [section] = parseNotes(long);
  assert.ok(section.paragraphs[0].length <= 400);
  assert.ok(section.paragraphs[0].endsWith('…'));
});

// ── Choosing what to show ───────────────────────────────────────────────────

test('a user who skipped releases is shown all of them', () => {
  // This is the person who most needs telling, so showing only the newest
  // would be the wrong call.
  const notes = notesSince(SAMPLE, '2.9.1', '2.13.0');
  assert.deepEqual(notes.map((n) => n.version), ['2.13.0', '2.12.0']);
});

test('nothing is shown when the user is already current', () => {
  assert.deepEqual(notesSince(SAMPLE, '2.13.0', '2.13.0'), []);
});

test('a fresh install sees only the current release, not the whole history', () => {
  const notes = notesSince(SAMPLE, null, '2.13.0');
  assert.deepEqual(notes.map((n) => n.version), ['2.13.0']);
});

test('releases newer than the running version are never shown', () => {
  // The wiki is written ahead of a deploy; a user must not be told about a
  // feature their server does not have.
  const notes = notesSince(SAMPLE, '2.9.1', '2.12.0');
  assert.deepEqual(notes.map((n) => n.version), ['2.12.0']);
  assert.ok(!notes.some((n) => n.version === '2.13.0'), 'an unreleased entry leaked');
});

test('the list is capped and ordered newest first', () => {
  const many = Array.from({ length: 10 }, (_, i) => `## v1.0.${i} — Release ${i}\n\nSomething.\n`).join('\n---\n');
  const notes = notesSince(many, '1.0.0', '1.0.9');
  assert.ok(notes.length <= 3, 'a dialog is not a changelog');
  assert.equal(notes[0].version, '1.0.9', 'newest first');
});

test('a missing notes file is not an error', () => {
  assert.equal(readNotesFile('/nonexistent/path/Whats-New.md'), '');
});

// ── Against the real file ───────────────────────────────────────────────────

test('the shipped wiki file parses into real releases', () => {
  // Guards the format drifting away from what the parser expects — the notes
  // are hand-written, so this is a genuine risk.
  const sections = parseNotes(readNotesFile());
  assert.ok(sections.length > 3, `expected several releases, parsed ${sections.length}`);
  for (const s of sections.slice(0, 5)) {
    assert.match(s.version, /^\d+\.\d+/, `"${s.version}" is not a version`);
    assert.ok(s.title.length > 0, `v${s.version} has no title`);
    assert.ok(s.paragraphs.length > 0, `v${s.version} has no body`);
  }
});

test('the running version has release notes written for it', () => {
  // This exists because it already happened: two releases shipped with no
  // entry in Whats-New.md, because a find-and-replace targeted an anchor that
  // did not exist and did nothing without complaining. The dialog would have
  // had nothing to show for the very release that triggered it.
  const pkg = require('../../package.json');
  const versions = parseNotes(readNotesFile()).map((s) => s.version);
  assert.ok(versions.includes(pkg.version),
    `package.json is v${pkg.version} but wiki/Whats-New.md has no entry for it — add one before releasing`);
});
