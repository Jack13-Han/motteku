const { spawnSync } = require('node:child_process');
for (const args of [['tests/packing-rules.mjs'], ['--test', 'tests/trips-emulator.test.cjs']]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}
