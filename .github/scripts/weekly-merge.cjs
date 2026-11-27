'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const marker = '<!-- motteku-weekly-integration -->';
const branchPrefix = 'automation/weekly-';
const shaPattern = /^[a-f0-9]{40}$/;
const protectedPath = name => /^\.github(?:\/|$)/i.test(name);
const markdown = value => String(value).replace(/[\r\n]/g, ' ').replace(/[|`<>]/g, char => `\\${char}`);
const artifactDirectory = () => path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'motteku-weekly');
function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
}
function output(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
function git(args, directory = process.cwd(), input, environment = {}) {
  return execFileSync('git', args, {
    cwd: directory, input, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...environment },
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}
function isAncestor(older, newer, directory) {
  try { git(['merge-base', '--is-ancestor', older, newer], directory); return true; }
  catch (error) { if (error.status === 1) return false; throw error; }
}
function pathsChanged(base, head, directory) {
  return git(['diff', '--name-only', '-z', base, head], directory).split('\0').filter(Boolean);
}
function reportMarkdown(report) {
  const lines = ['# Motteku weekly branch report', '', `Main snapshot: \`${report.base}\``, '', '| Branch | Result | Missing commits |', '|---|---|---:|'];
  for (const row of report.branches) lines.push(`| ${markdown(row.name)} | ${markdown(row.result)} | ${row.count || 0} |`);
  for (const row of report.branches.filter(row => row.count)) {
    lines.push('', `## ${markdown(row.name)}`, ...row.commits.map(commit => `- ${markdown(commit)}`));
    if (row.files?.length) lines.push('', 'Files requiring attention:', ...row.files.map(name => `- \`${markdown(name)}\``));
  }
  if (report.blocked) lines.push('', '**Nothing was published. Resolve the listed conflicts or automation-file changes first.**');
  if (report.candidate) lines.push('', `Candidate: \`${report.candidate}\``, '', 'Main will only advance after the existing CI workflow succeeds and the protected publishing credential is configured.');
  if (!report.candidate && !report.blocked) lines.push('', 'No new file changes need integration.');
  return lines.join('\n') + '\n';
}
function plan(directory = process.cwd(), outputDirectory = artifactDirectory()) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const base = git(['rev-parse', 'refs/remotes/origin/main'], directory);
  if (!shaPattern.test(base)) throw Error('Invalid main snapshot');
  if (git(['status', '--porcelain'], directory)) throw Error('Planning requires a clean, disposable checkout');
  git(['config', 'user.name', 'Motteku weekly integration'], directory);
  git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], directory);
  git(['config', 'commit.gpgsign', 'false'], directory);
  const hooks = path.join(outputDirectory, 'empty-hooks');
  fs.mkdirSync(hooks, { recursive: true });
  git(['config', 'core.hooksPath', hooks], directory);
  git(['checkout', '--detach', base], directory);
  const report = { repository: process.env.GITHUB_REPOSITORY || 'Jack13-Han/motteku', base, branches: [], included: [], blocked: false };
  const names = git(['for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin'], directory).split('\n')
    .filter(name => name && name !== 'HEAD' && name !== 'main' && !/^(?:codex|automation)\//.test(name)).sort();
  for (const name of names) {
    const head = git(['rev-parse', `refs/remotes/origin/${name}`], directory);
    const row = { name, head, count: Number(git(['rev-list', '--count', `${base}..${head}`], directory)), commits: [] };
    report.branches.push(row);
    if (isAncestor(head, 'HEAD', directory)) { row.result = 'Already included'; continue; }
    row.commits = git(['log', '-20', '--format=%h %an: %s', `${base}..${head}`], directory).split('\n').filter(Boolean);
    try {
      git(['merge', '--no-ff', '--no-commit', '--no-edit', head], directory);
    } catch (error) {
      row.result = 'Conflict; manual resolution required';
      row.files = git(['diff', '--name-only', '--diff-filter=U'], directory).split('\n').filter(Boolean);
      try { git(['merge', '--abort'], directory); } catch {}
      report.blocked = true;
      continue;
    }
    const changed = git(['diff', '--cached', '--name-only', '-z'], directory).split('\0').filter(Boolean);
    if (!changed.length) {
      row.result = 'History only; no new file changes';
      git(['merge', '--abort'], directory);
    } else if (changed.some(protectedPath)) {
      row.result = 'Automation/CI changes require manual review';
      row.files = changed.filter(protectedPath);
      git(['merge', '--abort'], directory);
      report.blocked = true;
    } else {
      git(['commit', '--no-edit'], directory);
      row.result = 'Included in candidate';
      report.included.push({ name, head });
    }
  }
  if (!report.blocked && report.included.length) {
    const tree = git(['rev-parse', 'HEAD^{tree}'], directory);
    const parents = [base, ...report.included.map(row => row.head)].flatMap(sha => ['-p', sha]);
    report.candidate = git(['commit-tree', tree, ...parents], directory, 'Weekly branch integration\n\nCombine clean source-branch snapshots for CI validation.\n');
    git(['update-ref', 'refs/heads/weekly-candidate', report.candidate], directory);
    git(['bundle', 'create', path.join(outputDirectory, 'candidate.bundle'), 'refs/heads/weekly-candidate', '--not', base], directory);
  }
  const markdownReport = reportMarkdown(report);
  fs.writeFileSync(path.join(outputDirectory, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outputDirectory, 'report.md'), markdownReport);
  summary(markdownReport);
  output('has_updates', !!report.candidate);
  if (report.blocked) throw Error('Weekly integration stopped; see the branch report. No branch was pushed.');
  return report;
}
function credential() {
  const token = process.env.WEEKLY_MERGE_TOKEN;
  if (!token) throw Error('Auto-merge is blocked: configure environment weekly-main-merge for main ONLY, then add its MOTTEKU_MERGE_TOKEN secret. The branch report is still available.');
  return token;
}
async function api(route, method = 'GET', body) {
  const response = await fetch(`https://api.github.com${route}`, {
    method, signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${credential()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw Error(`GitHub ${method} ${route}: ${response.status} ${result?.message || ''}`);
  return result;
}
async function paged(route, key) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const result = await api(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const rows = key ? result[key] : result;
    if (!Array.isArray(rows)) throw Error('Unexpected GitHub collection');
    all.push(...rows);
    if (rows.length < 100) return all;
  }
  throw Error('Repository exceeds the bounded pagination limit');
}
function repository() {
  const value = process.env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value || '')) throw Error('GITHUB_REPOSITORY is required');
  return value;
}
async function publish() {
  credential();
  const repo = repository(), root = `/repos/${repo}`;
  const report = JSON.parse(fs.readFileSync(path.join(artifactDirectory(), 'report.json'), 'utf8'));
  if (report.repository !== repo || report.blocked || !shaPattern.test(report.base) || !shaPattern.test(report.candidate || '')) throw Error('Candidate report is invalid');
  const main = await api(`${root}/git/ref/heads/main`);
  if (main.object.sha !== report.base) throw Error('Main advanced after planning. Run the weekly scan again; do not force-push.');
  git(['fetch', path.join(artifactDirectory(), 'candidate.bundle'), 'refs/heads/weekly-candidate:refs/heads/weekly-candidate']);
  if (git(['rev-parse', 'refs/heads/weekly-candidate']) !== report.candidate) throw Error('Bundle does not match the reported candidate');
  if (pathsChanged(report.base, report.candidate).some(protectedPath)) throw Error('Automation files cannot be auto-integrated');
  const branch = `${branchPrefix}${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT || '1'}`;
  const header = Buffer.from(`x-access-token:${credential()}`).toString('base64');
  git(['push', `https://github.com/${repo}.git`, `${report.candidate}:refs/heads/${branch}`], process.cwd(), undefined, {
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${header}`,
    GIT_CONFIG_KEY_1: 'credential.helper', GIT_CONFIG_VALUE_1: '',
    GIT_TRACE: '', GIT_TRACE_CURL: '', GIT_CURL_VERBOSE: '',
  });
  const actor = await api('/user');
  const previous = (await paged(`${root}/pulls?state=open&base=main`)).filter(pr => pr.user.login === actor.login && pr.head.ref.startsWith(branchPrefix) && pr.body?.includes(marker));
  const pr = await api(`${root}/pulls`, 'POST', {
    title: 'Weekly source-branch integration', base: 'main', head: branch,
    body: `${marker}\n\n${reportMarkdown(report)}\nThe existing CI workflow must pass before the exact candidate can advance main.`,
  });
  for (const old of previous) await api(`${root}/pulls/${old.number}`, 'PATCH', { state: 'closed' });
  summary(`## Candidate PR\n\n${pr.html_url}\n\nCI will validate this commit. Main has not been updated yet.`);
}
async function finalize() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const run = event.workflow_run;
  if (run?.event !== 'pull_request' || run.conclusion !== 'success' || !run.head_branch?.startsWith(branchPrefix)) return;
  const repo = repository(), root = `/repos/${repo}`;
  if (run.head_repository?.full_name !== repo || !shaPattern.test(run.head_sha)) return;
  credential();
  const workflow = await api(`${root}/actions/workflows/ci.yml`);
  if (run.workflow_id !== workflow.id || run.path !== '.github/workflows/ci.yml') throw Error('The completed workflow is not the trusted CI workflow');
  const actor = await api('/user');
  const associated = await paged(`${root}/commits/${run.head_sha}/pulls`);
  const pr = associated.find(value => value.state === 'open' && !value.draft && value.base.ref === 'main' && value.head.ref === run.head_branch && value.head.sha === run.head_sha && value.head.repo?.full_name === repo && value.user.login === actor.login && value.body?.includes(marker));
  if (!pr) return;
  const jobs = await paged(`${root}/actions/runs/${run.id}/jobs?filter=latest`, 'jobs');
  for (const name of ['build', 'trip workflow and rules']) {
    if (!jobs.some(job => job.name === name && job.conclusion === 'success')) throw Error(`Required CI job did not pass: ${name}`);
  }
  const files = await paged(`${root}/pulls/${pr.number}/files`);
  if (files.some(file => protectedPath(file.filename) || (file.previous_filename && protectedPath(file.previous_filename)))) throw Error('This PR changes automation/CI files and requires manual review');
  const candidate = await api(`${root}/git/commits/${run.head_sha}`);
  const main = await api(`${root}/git/ref/heads/main`);
  if (candidate.parents[0]?.sha !== main.object.sha) throw Error('Main or the candidate changed after planning. Start a fresh weekly scan.');
  // Publish exactly what CI tested. force:false atomically rejects a diverged main.
  await api(`${root}/git/refs/heads/main`, 'PATCH', { sha: run.head_sha, force: false });
  const verified = await api(`${root}/git/ref/heads/main`);
  if (verified.object.sha !== run.head_sha) throw Error('Main publication could not be verified');
  summary(`## Weekly merge completed\n\nPR: ${pr.html_url}\n\nMain: \`${run.head_sha}\`\n\nBoth CI jobs passed. No source branch was changed or deleted.`);
}
if (require.main === module) {
  const command = process.argv[2];
  Promise.resolve().then(() => command === 'plan' ? plan() : command === 'publish' ? publish() : command === 'finalize' ? finalize() : Promise.reject(Error('Use plan, publish or finalize'))).catch(error => {
    summary(`## Weekly integration stopped\n\n${markdown(error.message)}\n\nMain was not intentionally overwritten. Inspect the run before retrying.`);
    console.error(error.message); process.exitCode = 1;
  });
}
module.exports = { plan, publish, finalize, protectedPath, reportMarkdown };
