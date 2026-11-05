// The start-up check (2026-11-05, chat 3's brief and chat 1's plan): one moment where the board re-reads reality. Stage 1,
// tasks 1-4: where a chat's file is (task 1), the picture (task 2), the verdict (task 3) and its writes (task 4). The real
// case of the evening is the fixture: fixtures/wake-account (the two Worker 2 files, the Worker 1 files, the wake record) and
// fixtures/startup-check (trimmed copies of the snapshot, made-up paths).

import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { listedWhere, readAccountFolders, readAppChats } from '../src/appChats.mjs'

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'wake-account')
const W1_APP = 'local_e92c96e7-9f9c-4b57-8f7d-7bfdfc3afcc8'
const W2_REAL_APP = 'local_f86ba0e4-f337-456d-84be-52cd655253e1'
const W2_STUB_APP = 'local_8f2378dd-982c-4323-95d8-fdc0f40775ff'

/** The two account folders of the evening, from the fixtures; `reimported`: the 20:33 state (the real Worker 1 copied into the folder in use). */
async function accounts({ reimported = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'startup-accounts-'))
  const fresh = join(dir, '7b36a87b-new', 'org-1')
  const old = join(dir, '26b81206-old', 'org-1')
  await mkdir(fresh, { recursive: true })
  await mkdir(old, { recursive: true })
  await cp(join(FIXTURES, 'w1-stale.json'), join(fresh, 'local_a9540fd7-6516-4271-89cd-ff99e681faff.json'))
  await cp(join(FIXTURES, 'w2-real.json'), join(fresh, `${W2_REAL_APP}.json`))
  await cp(join(FIXTURES, 'w2-stub.json'), join(fresh, `${W2_STUB_APP}.json`))
  await cp(join(FIXTURES, 'w1-real.json'), join(old, `${W1_APP}.json`))
  if (reimported) await cp(join(FIXTURES, 'w1-real.json'), join(fresh, `${W1_APP}.json`))
  return dir
}

test('task 1: all account folders are read; the real Worker 1 is elsewhere at 20:25 and here at 20:33; the stub is no chat; f86ba0e4 is Worker 2\'s', async () => {
  const before = await accounts()
  const after = await accounts({ reimported: true })
  try {
    const folders = await readAccountFolders(before)
    assert.deepEqual(folders.map(folder => folder.account).sort(), ['26b81206-old', '7b36a87b-new'])
    assert.equal(listedWhere(W1_APP, folders), 'elsewhere', '20:25: only in the account the board does not read')
    assert.equal(listedWhere(W2_REAL_APP, folders), 'here')
    assert.equal(listedWhere(W2_STUB_APP, folders), 'nowhere', 'a launch stub is never the chat\'s file')
    assert.equal(listedWhere('local_00000000-0000-0000-0000-000000000000', folders), 'nowhere')
    assert.equal(listedWhere(null, folders), 'nowhere')
    assert.equal(listedWhere(W1_APP, await readAccountFolders(after)), 'here', '20:33: the reimport put it in the folder in use')
    // readAppChats keeps its behaviour: only the folder in use is read, the other account's ids come as `elsewhere`.
    const elsewhere = new Map()
    const files = new Set()
    const texts = await readAppChats(before, files, elsewhere)
    assert.equal(texts.length, 3)
    assert.equal(elsewhere.get(W1_APP), '26b81206-old')
    assert.equal(files.has(W1_APP), false)
  } finally {
    await rm(before, { recursive: true, force: true })
    await rm(after, { recursive: true, force: true })
  }
})
