const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { plan, publish, finalize } = require('../.github/scripts/weekly-merge.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'motteku-weekly-test-'));
  const repo = path.join(root, 'repo'), out = path.join(root, 'report');
  fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${repo.replaceAll('\\', '/')}`, ...args], { cwd: repo, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test');
  const write = (name, text) => { const file = path.join(repo, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  write('shared.txt', 'base\n'); git('add', '.'); git('commit', '-m', 'baseline');
  const base = git('rev-parse', 'HEAD'); git('update-ref', 'refs/remotes/origin/main', base);
  const prior = { ...process.env };
  process.env.GIT_CONFIG_COUNT = '1'; process.env.GIT_CONFIG_KEY_0 = 'safe.directory'; process.env.GIT_CONFIG_VALUE_0 = repo.replaceAll('\\', '/');
  delete process.env.GITHUB_STEP_SUMMARY; delete process.env.GITHUB_OUTPUT;
  process.env.GITHUB_REPOSITORY = 'Jack13-Han/motteku';
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
    Object.assign(process.env, prior);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const branch = (name, files) => {
    git('checkout', '-B', name, base);
    for (const [file, text] of Object.entries(files)) write(file, text);
    git('add', '.'); git('commit', '-m', `Update ${name}`);
    const head = git('rev-parse', 'HEAD'); git('update-ref', `refs/remotes/origin/${name}`, head); git('checkout', 'main'); return head;
  };
  return { root, repo, out, git, base, branch };
}

test('weekly planner combines independent branches, preserves parents and excludes integration branches', t => {
  const f = fixture(t);
  const first = f.branch('alice', { 'alice.txt': 'first' });
  const second = f.branch('bob', { 'bob.txt': 'second' });
  f.branch('codex/old-review', { 'ignore.txt': 'not a source branch' });
  f.branch('automation/weekly-old', { 'ignore-too.txt': 'not a source branch' });
  const report = plan(f.repo, f.out);
  assert.deepEqual(report.included.map(row => row.name), ['alice', 'bob']);
  assert.equal(report.blocked, false);
  assert.deepEqual(f.git('show', '-s', '--format=%P', report.candidate).split(' '), [f.base, first, second]);
  assert.equal(f.git('show', `${report.candidate}:alice.txt`), 'first');
  assert.equal(f.git('show', `${report.candidate}:bob.txt`), 'second');
  assert.ok(fs.existsSync(path.join(f.out, 'candidate.bundle')));
  assert.equal(f.git('rev-parse', 'refs/remotes/origin/main'), f.base);
});

test('any branch conflict blocks the entire batch even when another branch merged cleanly', t => {
  const f = fixture(t);
  f.branch('alice', { 'shared.txt': 'alice\n' }); f.branch('bob', { 'shared.txt': 'bob\n' });
  assert.throws(() => plan(f.repo, f.out), /Weekly integration stopped/);
  const report = JSON.parse(fs.readFileSync(path.join(f.out, 'report.json')));
  assert.equal(report.blocked, true); assert.equal(report.candidate, undefined);
  assert.equal(report.branches.find(row => row.name === 'bob').result, 'Conflict; manual resolution required');
  assert.equal(fs.existsSync(path.join(f.out, 'candidate.bundle')), false);
  assert.equal(f.git('rev-parse', 'main'), f.base);
});

test('changes to automation files require manual review and cannot enter an automatic candidate', t => {
  const f = fixture(t);
  f.branch('alice', { '.github/workflows/unsafe.yml': 'unreviewed workflow' });
  assert.throws(() => plan(f.repo, f.out), /Weekly integration stopped/);
  const report = JSON.parse(fs.readFileSync(path.join(f.out, 'report.json')));
  assert.equal(report.blocked, true);
  assert.deepEqual(report.branches[0].files, ['.github/workflows/unsafe.yml']);
  assert.equal(report.candidate, undefined);
});

test('already included and history-only branches produce a report without a publication', t => {
  const f = fixture(t);
  f.git('update-ref', 'refs/remotes/origin/alice', f.base);
  f.git('commit', '--allow-empty', '-m', 'history only');
  f.git('update-ref', 'refs/remotes/origin/bob', f.git('rev-parse', 'HEAD'));
  f.git('reset', '--hard', f.base);
  const report = plan(f.repo, f.out);
  assert.equal(report.candidate, undefined);
  assert.deepEqual(report.branches.map(row => row.result), ['Already included', 'History only; no new file changes']);
});

test('publishing without the protected credential stops before any network request', async t => {
  fixture(t); delete process.env.WEEKLY_MERGE_TOKEN;
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw Error('Unexpected request'); });
  await assert.rejects(publish(), /weekly-main-merge.*MOTTEKU_MERGE_TOKEN/);
  assert.equal(calls, 0);
});

function finalizer(t, changes = {}) {
  const f = fixture(t), head = 'a'.repeat(40), base = 'b'.repeat(40);
  const pr = { number: 5, state: 'open', draft: false, base: { ref: 'main' }, head: { ref: 'automation/weekly-123-1', sha: head, repo: { full_name: 'Jack13-Han/motteku' } }, user: { login: 'Jack13-Han' }, body: '<!-- motteku-weekly-integration -->', html_url: 'https://github.com/Jack13-Han/motteku/pull/5' };
  const run = { id: 123, workflow_id: 456, path: '.github/workflows/ci.yml', event: 'pull_request', conclusion: 'success', head_sha: head, head_branch: pr.head.ref, head_repository: { full_name: 'Jack13-Han/motteku' }, ...changes.run };
  const eventFile = path.join(f.root, 'event.json'); fs.writeFileSync(eventFile, JSON.stringify({ workflow_run: run }));
  process.env.GITHUB_EVENT_PATH = eventFile; process.env.WEEKLY_MERGE_TOKEN = 'fixture-token-not-real';
  let updated = false;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const route = new URL(url).pathname, method = options.method; requests.push({ route, method, body: options.body && JSON.parse(options.body) });
    let result;
    if (route.endsWith('/actions/workflows/ci.yml')) result = { id: 456 };
    else if (route === '/user') result = { login: 'Jack13-Han' };
    else if (route.endsWith(`/commits/${head}/pulls`)) result = [{ ...pr, ...changes.pr }];
    else if (route.endsWith('/jobs')) result = { jobs: changes.jobs || [{ name: 'build', conclusion: 'success' }, { name: 'trip workflow and rules', conclusion: 'success' }] };
    else if (route.endsWith('/files')) result = changes.files || [{ filename: 'components/Example.tsx' }];
    else if (route.endsWith(`/git/commits/${head}`)) result = { parents: [{ sha: base }] };
    else if (route.endsWith('/git/ref/heads/main')) result = { object: { sha: updated ? head : changes.main || base } };
    else if (route.endsWith('/git/refs/heads/main') && method === 'PATCH') { updated = true; result = { object: { sha: head } }; }
    else throw Error(`Unexpected request ${method} ${route}`);
    return { ok: true, status: 200, json: async () => result };
  });
  return { head, requests, published: () => updated };
}

test('finalizer publishes only the exact head that passed both required CI jobs with a non-force update', async t => {
  const f = finalizer(t); await finalize();
  assert.equal(f.published(), true);
  assert.deepEqual(f.requests.filter(row => row.method === 'PATCH').map(row => row.body), [{ sha: f.head, force: false }]);
});

test('finalizer refuses a moved main rather than merging an untested result', async t => {
  const f = finalizer(t, { main: 'c'.repeat(40) });
  await assert.rejects(finalize(), /Main or the candidate changed/); assert.equal(f.published(), false);
});

test('finalizer refuses missing CI jobs, changed workflow files and a forged workflow identity', async t => {
  for (const [changes, expected] of [
    [{ jobs: [{ name: 'build', conclusion: 'success' }] }, /Required CI job/],
    [{ files: [{ filename: 'renamed.yml', previous_filename: '.github/workflows/ci.yml' }] }, /requires manual review/],
    [{ run: { workflow_id: 999 } }, /trusted CI workflow/],
  ]) {
    await t.test(expected.source, async sub => { const f = finalizer(sub, changes); await assert.rejects(finalize(), expected); assert.equal(f.published(), false); });
  }
});

test('unrelated, external or modified candidate PRs cannot publish main', async t => {
  for (const changes of [{ run: { head_repository: { full_name: 'someone/else' } } }, { pr: { user: { login: 'someone-else' } } }, { pr: { head: { ref: 'automation/weekly-123-1', sha: 'd'.repeat(40), repo: { full_name: 'Jack13-Han/motteku' } } } }]) {
    await t.test(JSON.stringify(changes), async sub => { const f = finalizer(sub, changes); await finalize(); assert.equal(f.published(), false); });
  }
});
