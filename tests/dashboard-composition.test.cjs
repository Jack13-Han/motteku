const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');

// The optional source override lets the same checks reproduce a known bad revision.
const pagePath = process.env.MOTTEKU_DASHBOARD_PAGE || path.join(__dirname, '../app/page.tsx');
const source = ts.createSourceFile('page.tsx', fs.readFileSync(pagePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const home = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Home');
assert.ok(home, 'Actual Home component exists');
let content;
function findContent(node) {
  if (ts.isJsxFragment(node) && node.children.some(child => ts.isJsxExpression(child)
    && child.expression && /tab\s*===\s*['"]Overview['"]/.test(child.expression.getText(source))
    && child.expression.getText(source).includes('<TravelDashboard'))) content = node;
  ts.forEachChild(node, findContent);
}
findContent(home);
assert.ok(content, 'Actual active-trip content fragment exists');
const compiled = ts.transpileModule('module.exports = ' + content.getText(source), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

// Evaluate the real page composition; child components stay inert so no Firebase
// account, browser globals or side effects are needed to inspect their identities.
function TravelDashboard() { return null; }
function NextCheckCard() { return null; }
function overview(trip, stats = { packed: 0, total: 0, spent: 0 }) {
  const context = {
    Fragment: React.Fragment, TravelDashboard, NextCheckCard, tab: 'Overview', active: trip, stats,
    setTab() {}, deleteActiveTrip() {}, updateTripCover() {}, remoteError: false,
    user: { uid: 'viewer' }, itemChecks: {}, packing: { data: null }, snapshotPackedAssignments: () => [],
  };
  const module = { exports: {} };
  new Function('module', 'exports', 'require', ...Object.keys(context), compiled)(module, module.exports, require, ...Object.values(context));
  return module.exports;
}
function children(value) {
  return (Array.isArray(value) ? value.flat(Infinity) : [value]).filter(React.isValidElement);
}
function assertUniqueSiblingKeys(element, location = 'Home active-trip content') {
  const siblings = children(element.props.children), seen = new Set();
  for (const child of siblings) {
    if (child.key !== null) {
      assert.equal(seen.has(child.key), false, `${location}: duplicate sibling key ${child.key}`);
      seen.add(child.key);
    }
    assertUniqueSiblingKeys(child, `${location}/${child.type === React.Fragment ? 'Fragment' : child.type.name || child.type}`);
  }
}
function componentIdentities(tree, component) {
  const identities = [];
  function visit(element, ancestry = [], position = 0) {
    const identity = [...ancestry, { type: element.type, key: element.key, position: element.key === null ? position : null }];
    if (element.type === component) identities.push(identity);
    children(element.props.children).forEach((child, index) => visit(child, identity, index));
  }
  visit(tree);
  return identities;
}

test('Overview composes one dashboard and one next-check card without duplicate sibling keys', () => {
  const trip = { id: 'thkvr7c3', name: 'User trip' }, tree = overview(trip);
  assertUniqueSiblingKeys(tree);
  assert.equal(componentIdentities(tree, TravelDashboard).length, 1);
  assert.equal(componentIdentities(tree, NextCheckCard).length, 1);
});

test('same-trip updates preserve both React identities while switching trips resets both', () => {
  const original = overview({ id: 'first-trip', name: 'First trip' });
  const updated = overview({ id: 'first-trip', name: 'Edited trip' }, { packed: 3, total: 5, spent: 1000 });
  const switched = overview({ id: 'second-trip', name: 'Other trip' });
  for (const component of [TravelDashboard, NextCheckCard]) {
    const identity = componentIdentities(original, component);
    assert.equal(identity.length, 1);
    assert.deepEqual(componentIdentities(updated, component), identity, `${component.name} keeps the same type/key boundary for data updates`);
    assert.notDeepEqual(componentIdentities(switched, component), identity, `${component.name} resets its type/key boundary on a trip switch`);
  }
});
