const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
// Execute pure TypeScript message modules without bundling the client provider or Firebase.
function load(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', compiled)(exports, name => load(path.relative(root, path.resolve(path.dirname(file), name + '.ts'))));
  cache.set(file, exports);
  return exports;
}
const { translate, resolveLanguage, formatDate, japaneseMessages, errorKey } = load('lib/messages.ts');

test('saved preference takes priority, then supported browser preferences, then Japanese', () => {
  assert.equal(resolveLanguage('ja', ['en-US']), 'ja');
  assert.equal(resolveLanguage('en', ['ja-JP']), 'en');
  assert.equal(resolveLanguage(null, ['en-GB']), 'en');
  assert.equal(resolveLanguage('invalid', ['fr-FR', 'ja-JP']), 'ja');
  assert.equal(resolveLanguage(null, ['fr-FR']), 'ja');
  assert.equal(resolveLanguage(null, []), 'ja');
});

test('both languages format member counts and unit counts', () => {
  assert.equal(translate('ja', 'Members: {count}', { count: 5 }), '対象人数：5人');
  assert.equal(translate('en', 'Members: {count}', { count: 5 }), 'Members: 5');
  assert.equal(translate('ja', 'Ready: {ready} of {total}', { ready: 3, total: 5 }), '準備完了：3 / 5人');
  assert.equal(translate('en', 'Ready: {ready} of {total}', { ready: 3, total: 5 }), 'Ready: 3 of 5');
  assert.equal(translate('ja', 'Required: {count}', { count: 2 }), '必要数：2個');
  assert.equal(translate('en', 'Required: {count}', { count: 2 }), 'Required: 2');
});

test('status labels and errors can switch language without changing stored codes', () => {
  const codes = { not_ready: 'Not ready', ready: 'Ready', packed: 'Packed' };
  assert.deepEqual(Object.values(codes).map(key => translate('ja', key)), ['未準備', '準備済み', 'バッグに入れた']);
  assert.deepEqual(Object.values(codes).map(key => translate('en', key)), ['Not ready', 'Ready', 'Packed']);
  assert.equal(errorKey(new Error('Failed to fetch'), 'Weather could not be loaded.'), 'Weather could not be loaded.');
  assert.equal(translate('ja', errorKey(new Error('Check your input.'), 'Could not save changes.')), '入力内容を確認してください。');
});

test('user-provided strings remain unchanged when inserted into translated messages', () => {
  const name = 'Packed バッグ {count} / Aung';
  assert.equal(translate('ja', 'Delete {name}', { name }), `${name}を削除`);
  assert.equal(translate('en', 'Delete {name}', { name }), `Delete ${name}`);
});

test('dates use the selected locale and preserve calendar dates', () => {
  assert.equal(formatDate('ja', '2026-10-30'), '2026年10月30日');
  assert.equal(formatDate('en', '2026-10-30'), 'October 30, 2026');
  assert.equal(formatDate('ja', ''), '');
});

test('template unit keys localize without changing user-entered names', () => {
  assert.equal(translate('ja', 'Required quantity: {count} {unit}', { count: 5, unit: translate('ja', 'unit.pairs') }), '必要数：5足');
  assert.equal(translate('en', 'Required quantity: {count} {unit}', { count: 10, unit: translate('en', 'unit.sheets') }), 'Required quantity: 10 towels');
  assert.equal(translate('ja', 'Ready: {ready} of {total} {unit}', { ready: 1, total: 2, unit: translate('ja', 'unit.sets') }), '準備済み：1 / 2セット');
  const { packingTemplates } = load('lib/packingTemplates.ts');
  for (const template of Object.values(packingTemplates).flat()) {
    assert.ok(Object.hasOwn(japaneseMessages, template.nameKey), template.nameKey);
    assert.notEqual(translate('en', template.unitKey), template.unitKey);
    assert.notEqual(translate('ja', template.unitKey), template.unitKey);
  }
});

test('translation placeholders match between languages', () => {
  const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [key, value] of Object.entries(japaneseMessages)) assert.deepEqual(placeholders(value), placeholders(key), key);
});

test('UI text and notification literals have Japanese translations', () => {
  const files = ['app/page.tsx', ...fs.readdirSync(path.join(root, 'components')).filter(file => file.endsWith('.tsx')).map(file => `components/${file}`)];
  for (const file of files) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function checkLiteral(node) {
      if (!node) return;
      if (ts.isStringLiteral(node) && node.text) assert.ok(Object.hasOwn(japaneseMessages, node.text), `${file}: missing translation for ${node.text}`);
      if (ts.isConditionalExpression(node)) { checkLiteral(node.whenTrue); checkLiteral(node.whenFalse); }
    }
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['t', 'tr', 'setNotice', 'onNotice', 'setError', 'setDraftError'].includes(node.expression.text)) checkLiteral(node.arguments[0]);
      if (ts.isJsxText(node) && /[A-Za-zぁ-ん一-龠]/.test(node.text.trim())) assert.ok(['Motteku', 'M', 'kg'].includes(node.text.trim()), `${file}: untranslated UI text ${node.text}`);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});
