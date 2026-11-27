# Weekly branch integration setup

The schedule is **Monday 09:00 Japan time**, implemented as UTC cron `0 0 * * 1`. GitHub-hosted Actions runs even when the developer's computer is off. GitHub schedules are best effort, can be delayed, and may be disabled after 60 days without repository activity in a public repository.

This workflow scans pushed GitHub branches only. It cannot see or publish uncommitted local work. It excludes `main`, `codex/*` and `automation/*` integration branches. It does not change or delete source branches and never force-pushes.

## What is automatic

1. A trusted, read-only planning job snapshots main and source branch heads, reports the missing commits, and builds a clean integration candidate without executing source-branch code.
2. A conflict, or any change to `.github/**`, stops the entire batch for manual review. It does not choose ours/theirs or silently publish a partial batch.
3. A protected publishing job opens a candidate PR. The existing CI workflow tests that candidate.
4. After both `build` and `trip workflow and rules` pass, a trusted default-branch finalizer advances main to the exact tested commit with `force:false`. If main diverged, it stops and requires a new scan. GitHub's normal branch rules remain in force.

The candidate has main as its first parent and the included source heads as additional parents, preserving the source history. The PR is associated with the exact commit published to main.

## Required one-time credential setup

The repository's existing `main-owner-only` ruleset cannot be satisfied by an ordinary `GITHUB_TOKEN`. Do **not** disable or broaden the ruleset to get around this.

1. In repository Settings > Environments, create `weekly-main-merge`.
2. Set its deployment branches/tags to **Selected branches and tags**, with the branch **main only**. Do not allow feature branches, pull-request refs, tags or all protected branches. Required human reviewers must be absent if fully automatic operation is desired.
3. Create a fine-grained personal access token belonging to the existing owner/admin who is already allowed to update main. Restrict it to **Jack13-Han/motteku only**. Permissions: **Contents: Read and write**, **Pull requests: Read and write**, **Actions: Read**, and automatically included Metadata read access. Workflows write permission is unnecessary because workflow changes are blocked for manual review.
4. Store that token as the **environment secret** `MOTTEKU_MERGE_TOKEN`. Do not put it in a repository secret, workflow file, committed file, chat or log. Renew it before its selected expiration date.
5. Keep the CI workflow explicitly read-only: add top-level `permissions: contents: read` and set `persist-credentials: false` on both `actions/checkout` steps. Do not add the owner token or publishing environment to CI. This prevents candidate code from obtaining the credential used to update main.
6. Use Actions > Weekly branch integration > Run workflow on main to verify the setup before the first scheduled run.

Until the environment secret is configured, scheduled scanning/reporting can run, but the publishing job stops with a clear credential-required message. **Automatic main publication is not active merely because the workflow file is present.**

The privileged jobs check out the trusted script from main and never execute candidate code. The finalizer checks the CI workflow identity/path, successful named jobs, current PR author/head/repository, changed paths and the candidate's exact first parent before publishing. `workflow_run` is used only for this trusted, checked finalizer; candidate code runs solely in the read-only CI workflow.

Reports are available in the scheduled run's Step Summary and the `weekly-candidate-*` artifact, retained for 30 days. Successful candidates link their PR. Conflicts, failed tests, changed automation files, an expired token or a moved main stop integration and remain visible in Actions. An automatic Git merge cannot resolve semantic conflicts or replace a human review of business behavior.

## Official references

- [GitHub token workflow triggering and approvals](https://docs.github.com/en/actions/concepts/security/github_token)
- [Ruleset restrict-updates and bypass actors](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [Scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [Environment deployment branch policies](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [Fine-grained token permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)
