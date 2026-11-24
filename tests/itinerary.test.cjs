const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const compile = relative => ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const helpers = {};
new Function('exports', compile('lib/itinerary.ts'))(helpers);
const { normalizeActivities, upsertActivity, removeActivity, activityError } = helpers;
const draft = (overrides = {}) => ({ title: 'Osaka Castle', date: '2026-12-10', startTime: '09:00', endTime: '11:00', location: 'Osaka', category: 'Sightseeing', ...overrides });

test('itinerary rejects missing titles, invalid calendar dates and dates outside the trip', () => {
  assert.equal(activityError(draft(), '2026-12-10', '2026-12-12'), '');
  assert.match(activityError(draft({ title: '   ' }), '2026-12-10', '2026-12-12'), /name/);
  assert.match(activityError(draft({ date: '2026-12-09' }), '2026-12-10', '2026-12-12'), /within/);
  assert.match(activityError(draft({ date: '2026-12-13' }), '2026-12-10', '2026-12-12'), /within/);
  assert.match(activityError(draft({ date: '2026-02-30' }), '2026-02-01', '2026-03-12'), /within/);
});

test('itinerary rejects invalid or reversed time ranges and oversized fields', () => {
  for (const patch of [{ startTime: '25:00' }, { endTime: '09:00' }, { endTime: '08:00' }]) assert.match(activityError(draft(patch), '2026-12-10', '2026-12-12'), /time/);
  assert.match(activityError(draft({ location: 'x'.repeat(161) }), '2026-12-10', '2026-12-12'), /160/);
  assert.match(activityError(draft({ category: 'invalid' }), '2026-12-10', '2026-12-12'), /category/);
});

test('add, edit and delete retain activity identity and keep dates in order without mutating input', () => {
  const original = [];
  const one = upsertActivity(original, draft({ date: '2026-12-11' }), 'one', '2026-12-10', '2026-12-12');
  const two = upsertActivity(one, draft({ title: '  Lunch  ', location: '  Dotonbori  ' }), 'two', '2026-12-10', '2026-12-12');
  assert.deepEqual(original, []);
  assert.deepEqual(two.map(activity => activity.id), ['two', 'one']);
  assert.equal(two[0].title, 'Lunch');
  assert.equal(two[0].location, 'Dotonbori');
  const edited = upsertActivity(two, draft({ title: 'Museum' }), 'one', '2026-12-10', '2026-12-12');
  assert.equal(edited.length, 2);
  assert.equal(edited.find(activity => activity.id === 'one').title, 'Museum');
  assert.equal(two.find(activity => activity.id === 'one').title, 'Osaka Castle');
  assert.deepEqual(removeActivity(edited, 'one').map(activity => activity.id), ['two']);
});

test('normalization tolerates old trips and corrupted entries without inventing schedule data', () => {
  assert.deepEqual(normalizeActivities(undefined), []);
  assert.deepEqual(normalizeActivities({}), []);
  const activity = { id: 'one', ...draft() };
  assert.deepEqual(normalizeActivities([null, {}, activity, activity, { ...activity, id: 'bad', date: '2026-02-30' }]), [activity]);
  assert.throws(() => upsertActivity([], draft({ title: '' }), 'id', '2026-12-10', '2026-12-12'));
});

function harness(tripOverrides = {}) {
  let props = { trip: { id: 'trip-one', startDate: '2026-12-10', endDate: '2026-12-12', activities: [], ...tripOverrides }, onChange(activities) { props.trip = { ...props.trip, activities }; dirty = true; } };
  let index = 0, dirty = false, tree;
  const slots = [], effects = [];
  const react = {
    useState(initial) { const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], value => { slots[at] = typeof value === 'function' ? value(slots[at]) : value; dirty = true; }]; },
    useRef(initial) { const at = index++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; },
    useEffect(effect, deps) { const at = index++, old = slots[at]; if (!old || deps.some((value, position) => !Object.is(value, old[position]))) effects.push(() => { slots[at] = deps; effect(); }); },
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const module = { exports: {} };
  new Function('exports', 'require', compile('components/TripItinerary.tsx'))(module.exports, name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => key });
    if (name === '@/lib/i18n') return { useLanguage: () => ({ t: (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? ''), date: value => value }) };
    if (name === '@/lib/itinerary') return helpers;
    throw new Error(name);
  });
  function walk(node, predicate) {
    if (!node || typeof node !== 'object') return undefined;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const found = walk(child, predicate); if (found) return found; }
  }
  function render() { for (let pass = 0; pass < 8; pass++) { index = 0; dirty = false; tree = module.exports.default(props); while (effects.length) effects.shift()(); if (!dirty) break; } return tree; }
  function field(label) { const node = walk(tree, node => node.type === 'label' && [node.props.children].flat()[0] === label); return walk(node, node => node.type === 'input' || node.type === 'select'); }
  render();
  return {
    fill(label, value) { field(label).props.onChange({ target: { value } }); render(); },
    submit() { walk(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); render(); },
    button(label) { return walk(tree, node => node.type === 'button' && node.props['aria-label'] === label); },
    click(label) { this.button(label).props.onClick(); render(); },
    status(role) { return walk(tree, node => node.props?.role === role)?.props.children; },
    hasForm() { return Boolean(walk(tree, node => node.type === 'form')); },
    title(title) { return walk(tree, node => node.type === 'h4' && node.props.children === title); },
    activities() { return props.trip.activities; },
    fieldValue(label) { return field(label).props.value; },
    switchTrip() { props = { ...props, trip: { id: 'trip-two', startDate: '2026-12-20', endDate: '2026-12-21' } }; render(); },
  };
}

test('real itinerary form adds, edits and removes workspace activities', () => {
  const ui = harness();
  ui.fill('Activity name', 'Lunch'); ui.fill('Activity location', 'Dotonbori'); ui.submit();
  assert.equal(ui.activities().length, 1);
  assert.equal(ui.activities()[0].title, 'Lunch');
  const id = ui.activities()[0].id;
  assert.equal(ui.status('status'), 'Activity added.');
  ui.click('Edit Lunch'); ui.fill('Activity name', 'Dinner'); ui.submit();
  assert.equal(ui.activities().length, 1);
  assert.equal(ui.activities()[0].id, id);
  assert.equal(ui.activities()[0].title, 'Dinner');
  ui.click('Delete Dinner');
  assert.equal(ui.activities().length, 0);
  assert.equal(ui.status('status'), 'Activity removed.');
});

test('invalid form keeps its draft and trip switching clears the previous draft', () => {
  const ui = harness();
  ui.fill('Activity name', 'Museum'); ui.fill('Activity date', '2026-12-13'); ui.submit();
  assert.equal(ui.activities().length, 0);
  assert.match(ui.status('alert'), /within/);
  assert.equal(ui.fieldValue('Activity name'), 'Museum');
  ui.switchTrip();
  assert.equal(ui.fieldValue('Activity name'), '');
  assert.equal(ui.fieldValue('Activity date'), '2026-12-20');
});

test('joined trips without valid date ranges keep existing activities and explain why the form is unavailable', () => {
  for (const dates of [{ startDate: '', endDate: '' }, { startDate: '2026-02-30' }, { startDate: '2026-12-13', endDate: '2026-12-10' }]) {
    const ui = harness({ ...dates, activities: [{ id: 'old', ...draft() }] });
    assert.equal(ui.hasForm(), false);
    assert.equal(ui.status('status'), 'Create a trip with valid travel dates to plan activities.');
    assert.ok(ui.title('Osaka Castle'));
    assert.equal(ui.button('Edit Osaka Castle').props.disabled, true);
    assert.equal(ui.activities().length, 1);
  }
});
