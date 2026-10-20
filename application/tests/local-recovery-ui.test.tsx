import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('the application has no automatic legacy-review banner in loading, login or workspace states', async()=>{
 const source=await readFile(new URL('../web/app.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/LocalRecoveryNotice|local-recovery-notice|getLocalRecovery|openLocalRecovery/);
 // Current write failures remain actionable; removing an upgrade prompt must not hide them.
 assert.equal((source.match(/<NativeStorageFailureNotice\/>/g)||[]).length,3);
});
