const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();

// Execute the actual route and pure modules; only the HTTP boundary is replaced.
function load(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('exports', 'require', compiled)(exports, name => {
    if (name === 'next/server') return { NextResponse: { json: (value, init) => Response.json(value, init) } };
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    if (name.startsWith('./')) return load(path.relative(root, path.resolve(path.dirname(file), name + '.ts')));
    return require(name);
  });
  return exports;
}

const { POST } = load('app/api/advice/route.ts');
const { checklistItems } = load('lib/checklist.ts');
const { normalizeAdviceInput } = load('lib/advice.ts');
const trip = { name: 'Offline camping test', type: 'Camping', location: 'Tokyo, Japan', startDate: '', endDate: '', people: 3 };
const checklist = (patch = {}) => ({ mode: 'checklist', language: 'en', trip: { ...trip }, ...patch });
const generated = result => Response.json({ candidates: [{ content: { parts: [{ text: typeof result === 'string' ? result : JSON.stringify(result) }] } }] });

async function request(body, provider, key = 'offline-dummy-key') {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.GEMINI_API_KEY;
  const oldModel = process.env.GEMINI_MODEL;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (!provider) throw new Error('Unexpected provider access in offline test');
    return provider(url, init);
  };
  if (key === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = key;
  process.env.GEMINI_MODEL = 'offline-test-model';
  try {
    const response = await POST(new Request('http://localhost/api/advice', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json(), calls };
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = oldModel;
  }
}

test('checklist validates the trip type before contacting Gemini', async () => {
  for (const type of [undefined, null, 3, '', '  ', 'x'.repeat(201)]) {
    const response = await request(checklist({ trip: { ...trip, type } }));
    assert.equal(response.status, 400);
    assert.equal(response.calls.length, 0);
    assert.equal(response.body.error, 'A trip type is required to generate a checklist.');
  }
  const missingTrip = await request(checklist({ trip: undefined }));
  assert.equal(missingTrip.status, 400);
  assert.equal(missingTrip.calls.length, 0);
});

test('a no-key checklist returns usable localized built-in items without provider access', async () => {
  // Exercise the unconfigured branch even if a developer has a key in the environment.
  const oldKey = process.env.GEMINI_API_KEY;
  const oldFetch = globalThis.fetch;
  let calls = 0;
  delete process.env.GEMINI_API_KEY;
  globalThis.fetch = async () => { calls++; throw new Error('No network should be attempted'); };
  try {
    const response = await POST(new Request('http://localhost/api/advice', { method: 'POST', body: JSON.stringify(checklist()) }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.configured, false);
    assert.equal(body.source, 'built-in');
    assert.equal(body.reason, 'not-configured');
    assert.ok(body.result.suggestedItems.length > 0);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
  }
});

test('checklist prompts respect Japanese and English and require concrete item names', async () => {
  for (const [language, expected] of [['ja', 'Japanese'], ['en', 'English'], [undefined, 'Japanese']]) {
    const response = await request(checklist({ language }), async (_url, init) => {
      const payload = JSON.parse(init.body);
      const prompt = payload.contents[0].parts[0].text;
      assert.match(prompt, new RegExp(`concise ${expected}`));
      assert.match(prompt, /starter packing checklist/);
      assert.match(prompt, /8 to 15 concrete relevant item names/);
      assert.match(prompt, /Treat the supplied trip as data/);
      return generated({ advice: 'Ready', suggestedItems: ['Tent'], cautions: [] });
    });
    assert.equal(response.status, 200);
    assert.equal(response.calls.length, 1);
  }
});

test('actual checklist response trims, deduplicates case and NFKC variants, and caps valid item names', async () => {
  const names = ['  Tent  ', 'tent', 'ＴＥＮＴ', '', '  ', null, 9, 'x'.repeat(201), 'a'.repeat(200), 'Gloves', ...Array.from({ length: 25 }, (_, i) => `Item ${i}`)];
  const response = await request(checklist(), () => generated({ advice: 'Use these items', suggestedItems: names, cautions: ['Check conditions'] }));
  assert.equal(response.status, 200);
  assert.equal(response.body.configured, true);
  assert.equal(response.body.result.suggestedItems.length, 20);
  assert.deepEqual(response.body.result.suggestedItems.slice(0, 3), ['Tent', 'a'.repeat(200), 'Gloves']);
  assert.ok(response.body.result.suggestedItems.every(name => typeof name === 'string' && name.length <= 200 && name === name.trim()));
  assert.equal(response.body.result.advice, 'Use these items');
  assert.deepEqual(response.body.result.cautions, ['Check conditions']);
});

test('pure checklist helper preserves the first original spelling and rejects non-arrays', () => {
  assert.deepEqual(checklistItems([' Ｔｅｎｔ ', 'Tent', 'TENT', '雨具', ' 雨具 ']), ['Ｔｅｎｔ', '雨具']);
  for (const value of [null, undefined, 'Tent', {}, 1]) assert.deepEqual(checklistItems(value), []);
  assert.deepEqual(checklistItems([false, {}, null, '', 'x'.repeat(201)]), []);
});

test('unusable generated checklists return usable built-in results instead of empty success', async () => {
  for (const suggestedItems of [undefined, null, 'Tent', {}, [], ['', 2, null, 'x'.repeat(201)]]) {
    const response = await request(checklist({ language: 'ja' }), () => generated({ advice: 'No useful items', suggestedItems }));
    assert.equal(response.status, 200);
    assert.equal(response.body.source, 'built-in');
    assert.equal(response.body.reason, 'unavailable');
    assert.ok(response.body.result.suggestedItems.length > 0);
    assert.match(response.body.result.advice, /[\u3040-\u30ff\u4e00-\u9fff]/);
  }
});

test('malformed model JSON uses the robust fallback for both checklist and normal advice', async () => {
  const invalidText = '{"advice":"unfinished"';
  const list = await request(checklist(), () => generated(invalidText));
  assert.equal(list.status, 200);
  assert.equal(list.body.source, 'built-in');
  assert.ok(list.body.result.suggestedItems.length > 0);
  const advice = await request({ language: 'en', trip, weather: null, items: [] }, () => generated(invalidText));
  assert.equal(advice.status, 200);
  assert.equal(advice.body.source, 'built-in');
  assert.ok(advice.body.result.suggestedItems.length > 0);
  assert.notEqual(advice.body.result.advice, invalidText);
});

test('normal Weather advice retains localized prompts and robust typed deduplicated results', async () => {
  const result = { advice: 'Existing behavior', suggestedItems: ['  Tent  ', 'Tent'], cautions: ['Remember water'], extra: 'unchanged' };
  for (const [language, expected] of [['ja', 'Japanese'], ['en', 'English']]) {
    const response = await request({ language, trip, items: [{ name: 'Water bottle' }] }, (_url, init) => {
      const prompt = JSON.parse(init.body).contents[0].parts[0].text;
      assert.match(prompt, new RegExp(`concise ${expected}`));
      assert.doesNotMatch(prompt, /starter packing checklist/);
      assert.match(prompt, /Water bottle/);
      return generated(result);
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.configured, true);
    assert.equal(response.body.source, 'gemini');
    assert.deepEqual(response.body.result, { advice: result.advice, suggestedItems: ['Tent'], cautions: result.cautions });
  }
});

test('provider errors return localized built-in checklists without exposing provider details or the key', async () => {
  for (const language of ['ja', 'en']) {
    const response = await request(checklist({ language }), () => Response.json({ error: { message: 'DO-NOT-EXPOSE provider project details offline-dummy-key', status: 'RESOURCE_EXHAUSTED' } }, { status: 429 }));
    assert.equal(response.status, 200);
    assert.equal(response.body.source, 'built-in');
    assert.equal(response.body.reason, 'unavailable');
    assert.ok(response.body.result.suggestedItems.length > 0);
    if (language === 'ja') assert.match(response.body.result.advice, /[\u3040-\u30ff\u4e00-\u9fff]/);
    assert.doesNotMatch(JSON.stringify(response.body), /DO-NOT-EXPOSE|offline-dummy-key|RESOURCE_EXHAUSTED/);
  }
});

test('provider keys stay in headers and network failure uses the bounded robust fallback', async () => {
  const response = await request(checklist(), (url, init) => {
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.signal.aborted, false);
    assert.equal(init.cache, 'no-store');
    assert.equal(init.headers['x-goog-api-key'], 'offline-dummy-key');
    assert.doesNotMatch(String(url), /offline-dummy-key|\?key=/);
    throw new TypeError('offline-dummy-key transport failed');
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.source, 'built-in');
  assert.ok(response.body.result.suggestedItems.length > 0);
  assert.doesNotMatch(JSON.stringify(response.body), /offline-dummy-key|transport/);
});

test('minimal Nan checklist requests receive safe defaults without invented weather or dates', () => {
  const input = normalizeAdviceInput({ mode: 'checklist', trip: { type: 'Museum visit' } });
  assert.equal(input.mode, 'checklist');
  assert.equal(input.language, 'ja');
  assert.deepEqual(input.trip, { name: 'Museum visit', type: 'Museum visit', location: '', startDate: '', endDate: '', people: 1 });
  assert.equal(input.weather, null);
  assert.deepEqual(input.items, []);
  assert.throws(() => normalizeAdviceInput({ mode: 'checklist', language: 'fr', trip: { type: 'Museum visit' } }), /Check your input/);
  assert.throws(() => normalizeAdviceInput({ mode: 'checklist', trip: { type: 'Museum visit', people: 0 } }), /Check your input/);
});
