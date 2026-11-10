import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if(process.argv.slice(2).some(arg=>arg!=='--expanded'))throw new Error('usage: node scripts/matrix-runner.js [--expanded]');
const result=spawnSync(process.execPath,['--test','tests/adapter-matrix.test.js'],{
  cwd:fileURLToPath(new URL('..',import.meta.url)),stdio:'inherit',
  env:{...process.env,STATS_MAP_FULL_MATRIX:process.argv.includes('--expanded')?'1':'0'}
});
if(result.error)throw result.error;
process.exitCode=result.status??1;
