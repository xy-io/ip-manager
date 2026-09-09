// ============================================================
//  Modal ordering
//
//  Escape is handled on document in the capture phase, so every open modal's
//  handler fires, in mount order. When Network Watch opens the edit form on
//  top of itself, that meant Escape closed the view underneath and left the
//  form up. Only the topmost modal may respond.
//
//  The stack lives outside the hook precisely so this can be checked without
//  a DOM.
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');

// The module is ESM for the browser build; exercise it through Node's ESM
// loader rather than duplicating the logic here, so the test covers the real
// code rather than a copy of it.
function run(script) {
  const file = path.join(__dirname, '..', '..', 'src', 'shared', 'common.js');
  return execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { pushModal, popModal, isTopModal, resetModalStack } from ${JSON.stringify(file)};
     ${script}`], { encoding: 'utf8' }).trim();
}

test('the most recently opened modal is the top one', () => {
  const out = run(`
    resetModalStack();
    const a = pushModal();
    const b = pushModal();
    console.log(JSON.stringify([isTopModal(a), isTopModal(b)]));
  `);
  assert.deepEqual(JSON.parse(out), [false, true],
    'the second modal opened must be the one that responds');
});

test('closing the top modal returns control to the one beneath', () => {
  const out = run(`
    resetModalStack();
    const view = pushModal();
    const form = pushModal();
    popModal(form);
    console.log(JSON.stringify(isTopModal(view)));
  `);
  assert.equal(JSON.parse(out), true);
});

test('a single modal is always the top one', () => {
  const out = run(`
    resetModalStack();
    const only = pushModal();
    console.log(JSON.stringify(isTopModal(only)));
  `);
  assert.equal(JSON.parse(out), true);
});

test('nothing is top once every modal has closed', () => {
  const out = run(`
    resetModalStack();
    const a = pushModal();
    popModal(a);
    console.log(JSON.stringify([isTopModal(a), isTopModal(999)]));
  `);
  assert.deepEqual(JSON.parse(out), [false, false]);
});

test('closing out of order does not strand the stack', () => {
  // React unmount order is not guaranteed to mirror mount order.
  const out = run(`
    resetModalStack();
    const a = pushModal();
    const b = pushModal();
    const c = pushModal();
    popModal(b);
    console.log(JSON.stringify([isTopModal(c), isTopModal(a)]));
    popModal(c);
    console.log(JSON.stringify(isTopModal(a)));
  `);
  const [first, second] = out.split('\n');
  assert.deepEqual(JSON.parse(first), [true, false]);
  assert.equal(JSON.parse(second), true, 'the remaining modal should regain control');
});
