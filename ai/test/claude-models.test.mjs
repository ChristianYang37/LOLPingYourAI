import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configuredClaudeModels } from '../harness/claude-models.mjs';
test('configured Claude names reload from disk without returning credentials', async () => {
 const dir=await mkdtemp(join(tmpdir(),'lolping-models-'));
 try {
  const env={CLAUDE_CONFIG_DIR:dir};
  await writeFile(join(dir,'settings.json'),JSON.stringify({model:'custom-a',env:{ANTHROPIC_AUTH_TOKEN:'secret',ANTHROPIC_DEFAULT_SONNET_MODEL:'custom-b'}}));
  assert.deepEqual(await configuredClaudeModels(dir,env),['custom-a','custom-b']);
  await writeFile(join(dir,'settings.json'),JSON.stringify({model:'new-model'}));
  assert.deepEqual(await configuredClaudeModels(dir,env),['new-model']);
 } finally {await rm(dir,{recursive:true,force:true});}
});
