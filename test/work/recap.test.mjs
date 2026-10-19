// B360: recaps. A step through its result check and a goal through its re-check give the person a recap: a note to
// them marked Recap, with what they get and the evidence picture. It blocks nothing; the person may overturn it (their
// words go to the partner) or mark it seen (B390: approved at once), and left alone it approves itself 24 hours after it
// showed. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { informationOf } from '../../src/work/lists.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { RECAP_WINDOW_MS, recapsOf } from '../../src/work/recap.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 19, 9, 0).getTime()
const HOUR = 60 * 60 * 1000
const BACKLOG = ['# Backlog', '', '## Lamps', '- [ ] B1 Trim the wicks (for Lamplighter; about 1 h)', ''].join('\n')
const ROLES = { Keeper: 'main', Lamplighter: 'worker', Partner: 'advisor' }

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'work-recap-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = {
    dir, now: NOW + 60_000, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), freeChats: new Set(['Lamplighter']),
    hasGoal: id => id === 'G3',
    goalChecked: async body => ({ ok: true, result: { id: body.id, ticked: body.verdict === 'passed', title: 'A warm garden', attempts: 0 } }),
  }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return {
    dir, lamplighter: as('Lamplighter'), keeper: as('Keeper'), partner: as('Partner'),
    person: (body, at = ctx.now) => workApi(body, { ...ctx, now: at, as: 'person' }),
    server: (body, at = ctx.now) => workApi(body, { ...ctx, now: at, as: 'server' }),
  }
}
const store = async dir => ({ ok: true, ...(await readStore(dir)) })
const recapNotes = async dir => [...(await readStore(dir)).items.values()].filter(one => valueOf(one, 'Recap') !== null)
const LAMP = { action: 'new', title: 'Light the garden lamps', activity: 'Lamps', goal: 'G3', text: 'Warm light on every path.', summary: 'Every path has a warm lamp.', size: '1 h', what: ['a lamp at every bench', 'warm yellow light, never white', 'Not in it: new paths'] }

/** B2, made from the agreed how, queued for the Lamplighter, taken, reported and its git check passed. */
async function reported(one) {
  const made = await one.partner(LAMP)
  assert.equal(made.ok, true, made.why)
  const id = made.result.id
  assert.equal((await one.keeper({ action: 'queue', id, for: 'Lamplighter', about: '1 h' })).ok, true)
  assert.equal((await one.lamplighter({ action: 'take', id, branch: 'b2-lamps' })).ok, true)
  assert.equal((await one.lamplighter({ action: 'report', id, result: 'Every path has a warm lamp.', merged: 'c0ffee1' })).ok, true)
  assert.equal((await one.server({ action: 'check', id, passed: true, lines: ['branch gone'] })).ok, true)
  return id
}
const PASSED = { action: 'checked', evidence: 'pictures/b2/evidence.png', points: ['pass: a lamp at every bench', 'pass: warm yellow light, never white'] }

test('a step through its result check gives the person one open recap: what they get, its evidence, About the step', async () => {
  const one = await fresh()
  try {
    const id = await reported(one)
    assert.deepEqual(await recapNotes(one.dir), [])
    assert.equal((await one.partner({ ...PASSED, id })).ok, true)
    const [note, ...more] = await recapNotes(one.dir)
    assert.equal(more.length, 0)
    assert.deepEqual(['Kind', 'From', 'To', 'State', 'Recap', 'Evidence'].map(key => valueOf(note, key)), ['note', 'Partner', 'you', 'unread', 'open', 'pictures/b2/evidence.png'])
    assert.deepEqual(note.sections.get('Text'), [`${id} Light the garden lamps is done`, 'Every path has a warm lamp.'])
    assert.deepEqual(note.sections.get('About'), [id])
    // The step is done already: a recap blocks nothing.
    assert.equal(valueOf((await readStore(one.dir)).items.get(id), 'State'), 'done')
    const [shown] = recapsOf(await store(one.dir), NOW + HOUR)
    assert.deepEqual({ ...shown, at: null, approvesAt: shown.approvesAt - shown.at }, {
      id: `recap:${valueOf(note, 'Id')}`, workId: valueOf(note, 'Id'), about: id, isGoal: false, title: `${id} Light the garden lamps is done`,
      line: 'Every path has a warm lamp.', evidence: 'pictures/b2/evidence.png', state: 'open', at: null, approvesAt: RECAP_WINDOW_MS, words: '', isClosed: false,
    })
    // A recap is no line of Information: it has its own card.
    assert.deepEqual(informationOf(await store(one.dir), NOW + HOUR).filter(info => info.id === valueOf(note, 'Id')), [])
  } finally {
    await rm(one.dir, { recursive: true, force: true })
  }
})

test('a failed check gives no recap; the step it fixes gets one once its fix is through, with the fix\'s evidence', async () => {
  const one = await fresh()
  try {
    const id = await reported(one)
    const failed = await one.partner({ ...PASSED, id, points: ['pass: a lamp at every bench', 'fail: warm yellow light, never white (two are white)'] })
    const fixId = failed.result.fix
    assert.deepEqual(await recapNotes(one.dir), [])
    await one.lamplighter({ action: 'take', id: fixId, branch: 'b-fix-lamps' })
    await one.lamplighter({ action: 'report', id: fixId, result: 'All lamps are warm yellow.', merged: 'beef123' })
    await one.server({ action: 'check', id: fixId, passed: true, lines: ['branch gone'] })
    assert.equal((await one.partner({ ...PASSED, id: fixId, evidence: 'pictures/fix/evidence.png', points: ['pass: warm yellow light, never white'] })).ok, true)
    const notes = await recapNotes(one.dir)
    assert.equal(notes.length, 1)
    assert.deepEqual(notes[0].sections.get('About'), [id])
    assert.equal(valueOf(notes[0], 'Evidence'), 'pictures/fix/evidence.png')
  } finally {
    await rm(one.dir, { recursive: true, force: true })
  }
})

test('Overturn: the recap closes with the person\'s words, and the partner is woken to make a fix step from them', async () => {
  const one = await fresh()
  try {
    const id = await reported(one)
    await one.partner({ ...PASSED, id })
    const [note] = await recapNotes(one.dir)
    const recap = valueOf(note, 'Id')
    // Words are needed; a chat cannot answer for the person.
    assert.equal((await one.person({ action: 'overturn', id: recap, text: ' ' })).status, 400)
    assert.equal((await one.lamplighter({ action: 'overturn', id: recap, text: 'no' })).status, 403)
    // The review: a recap is not read away.
    assert.equal((await one.person({ action: 'read', id: recap })).status, 409)
    const done = await one.person({ action: 'overturn', id: recap, text: 'The lamp by the pond is still white.' })
    assert.equal(done.ok, true, done.why)
    assert.deepEqual(done.result.wake, {
      to: 'Partner', id: recap, title: `${id} Light the garden lamps is done`,
      text: `Overturn: The lamp by the pond is still white.\nAbout: ${id}\nYour job: make a fix step of ${id} from their words (roles/partner.md, "Recaps")`,
    })
    assert.equal(done.result.reopen, undefined)
    const after = (await readStore(one.dir)).items.get(recap)
    assert.deepEqual(['Recap', 'State'].map(key => valueOf(after, key)), ['overturned', 'read'])
    assert.deepEqual(after.sections.get('Answer'), ['The lamp by the pond is still white.'])
    // Once is enough.
    assert.equal((await one.person({ action: 'seen', id: recap })).status, 409)
    const [shown] = recapsOf(await store(one.dir), NOW + HOUR)
    assert.deepEqual([shown.state, shown.isClosed, shown.words, shown.approvesAt], ['overturned', true, 'The lamp by the pond is still white.', null])
  } finally {
    await rm(one.dir, { recursive: true, force: true })
  }
})

test('B390: OK, seen approves the recap at once with no words: closed, its History says seen by you, nobody is woken', async () => {
  const one = await fresh()
  try {
    const id = await reported(one)
    await one.partner({ ...PASSED, id })
    const [note] = await recapNotes(one.dir)
    const recap = valueOf(note, 'Id')
    // Only the person marks it seen.
    assert.equal((await one.lamplighter({ action: 'seen', id: recap })).status, 403)
    const done = await one.person({ action: 'seen', id: recap }, NOW + HOUR)
    assert.equal(done.ok, true, done.why)
    assert.equal(done.result.wake, undefined)
    const after = (await readStore(one.dir)).items.get(recap)
    assert.deepEqual(['Recap', 'State'].map(key => valueOf(after, key)), ['seen', 'read'])
    assert.equal(after.sections.has('Answer'), false)
    assert.match(after.sections.get('History').at(-1), / person: seen by you: approved at once$/)
    const [shown] = recapsOf(await store(one.dir), NOW + 2 * HOUR)
    assert.deepEqual([shown.state, shown.isClosed, shown.approvesAt], ['seen', true, null])
    // Once is enough, and a seen recap does not approve itself again.
    assert.equal((await one.person({ action: 'overturn', id: recap, text: 'late' })).status, 409)
    assert.deepEqual((await one.server({ action: 'approve-recaps' }, NOW + 2 * RECAP_WINDOW_MS)).result.approved, [])
  } finally {
    await rm(one.dir, { recursive: true, force: true })
  }
})

test('B390: OK, seen needs no partner chat on the board: no words go anywhere', async () => {
  const one = await fresh()
  try {
    const id = await reported(one)
    await one.partner({ ...PASSED, id })
    const [note] = await recapNotes(one.dir)
    const alone = await workApi({ action: 'seen', id: valueOf(note, 'Id') }, { dir: one.dir, now: NOW + HOUR, prefix: '', roleOf: () => null, chats: [], as: 'person' })
    assert.equal(alone.ok, true, alone.why)
    assert.equal(valueOf((await readStore(one.dir)).items.get(valueOf(note, 'Id')), 'Recap'), 'seen')
  } finally {
    await rm(one.dir, { recursive: true, force: true })
  }
})

test('B390: Feedback on a recap is gone: the action is refused and the recap stays open', async () => {
  const one = await fresh()
  try {
    const id = await reported(one)
    await one.partner({ ...PASSED, id })
    const [note] = await recapNotes(one.dir)
    assert.equal((await one.person({ action: 'feedback', id: valueOf(note, 'Id'), text: 'Lovely.' })).ok, false)
    assert.equal(valueOf((await readStore(one.dir)).items.get(valueOf(note, 'Id')), 'Recap'), 'open')
  } finally {
    await rm(one.dir, { recursive: true, force: true })
  }
})

test('left alone, a recap approves itself 24 hours after it showed, and stays among the closed items for a day', async () => {
  const one = await fresh()
  try {
    const id = await reported(one)
    await one.partner({ ...PASSED, id })
    const [note] = await recapNotes(one.dir)
    const shownAt = recapsOf(await store(one.dir), NOW).at(0).at
    const early = await one.server({ action: 'approve-recaps' }, shownAt + RECAP_WINDOW_MS - 60_000)
    assert.deepEqual(early.result.approved, [])
    assert.equal((await one.person({ action: 'approve-recaps' })).ok, false)
    const due = await one.server({ action: 'approve-recaps' }, shownAt + RECAP_WINDOW_MS)
    assert.deepEqual(due.result.approved, [valueOf(note, 'Id')])
    const after = (await readStore(one.dir)).items.get(valueOf(note, 'Id'))
    assert.deepEqual(['Recap', 'State'].map(key => valueOf(after, key)), ['approved', 'read'])
    assert.ok(after.sections.get('History').some(line => line.endsWith('approved by itself: its 24 hours passed without an overturn')))
    assert.equal(recapsOf(await store(one.dir), shownAt + RECAP_WINDOW_MS + HOUR).at(0).state, 'approved')
    assert.deepEqual(recapsOf(await store(one.dir), shownAt + 2 * RECAP_WINDOW_MS + HOUR), [])
    // An approved recap takes no answer any more.
    assert.equal((await one.person({ action: 'overturn', id: valueOf(note, 'Id'), text: 'late' })).status, 409)
  } finally {
    await rm(one.dir, { recursive: true, force: true })
  }
})

test('a goal through its re-check gives a recap too; its Overturn asks the board to reopen the goal', async () => {
  const one = await fresh()
  try {
    const checked = await one.partner({ action: 'checked', id: 'G3', evidence: 'pictures/g3/evidence.png', points: ['pass: warm light everywhere'] })
    assert.equal(checked.ok, true, checked.why)
    const [note] = await recapNotes(one.dir)
    assert.deepEqual(note.sections.get('Text'), ['G3 A warm garden is done', 'a helper re-checked it against its Done when and its vibe, 1 of 1 points pass.'])
    assert.equal(recapsOf(await store(one.dir), NOW + HOUR).at(0).isGoal, true)
    // The board opened the goal before (server.mjs); the partner's words say so.
    const done = await one.person({ action: 'overturn', id: valueOf(note, 'Id'), text: 'The north path is dark.' })
    assert.match(done.result.wake.text, /Your job: G3 is open again: make its follow-up steps from their words/)
  } finally {
    await rm(one.dir, { recursive: true, force: true })
  }
})

test('the review: a step the reconciler moves to done once the person answered its look gets its recap, once', async () => {
  const one = await fresh()
  try {
    const id = await reported(one)
    const asked = await one.partner({ action: 'ask', of: id, kind: 'look', text: 'Do the lamps look warm to you?', options: ['A yes', 'B no'], advice: 'A' })
    assert.equal(asked.ok, true, asked.why)
    assert.equal((await one.partner({ ...PASSED, id })).ok, true)
    assert.equal(valueOf((await readStore(one.dir)).items.get(id), 'State'), 'review')
    assert.deepEqual(await recapNotes(one.dir), [])
    assert.equal((await one.person({ action: 'answer', id: asked.result.id, verdict: 'approve', text: '' })).ok, true)
    const moved = await one.server({ action: 'advance', id, to: 'done' })
    assert.equal(moved.ok, true, moved.why)
    const notes = await recapNotes(one.dir)
    assert.deepEqual(notes.map(note => note.sections.get('About')), [[id]])
    assert.equal(valueOf(notes[0], 'Evidence'), 'pictures/b2/evidence.png')
  } finally {
    await rm(one.dir, { recursive: true, force: true })
  }
})

test('the review: when the board\'s own check passes after the result check, the step gets its recap then', async () => {
  const one = await fresh()
  try {
    const made = await one.partner(LAMP)
    const id = made.result.id
    await one.keeper({ action: 'queue', id, for: 'Lamplighter', about: '1 h' })
    await one.lamplighter({ action: 'take', id, branch: 'b2-lamps' })
    await one.lamplighter({ action: 'report', id, result: 'Every path has a warm lamp.', merged: 'c0ffee1' })
    await one.server({ action: 'check', id, passed: false, lines: ['the branch b2-lamps is still there'] })
    assert.equal((await one.partner({ ...PASSED, id })).ok, true)
    assert.deepEqual(await recapNotes(one.dir), [])
    await one.server({ action: 'check', id, passed: true, lines: ['branch gone'] })
    assert.equal(valueOf((await readStore(one.dir)).items.get(id), 'State'), 'done')
    assert.equal((await recapNotes(one.dir)).length, 1)
  } finally {
    await rm(one.dir, { recursive: true, force: true })
  }
})

test('the review: without a partner chat on the board an answer to a recap is refused, so the words are not lost', async () => {
  const one = await fresh()
  try {
    const id = await reported(one)
    await one.partner({ ...PASSED, id })
    const [note] = await recapNotes(one.dir)
    const alone = await workApi({ action: 'overturn', id: valueOf(note, 'Id'), text: 'The pond lamp is white.' },{ dir: one.dir, now: NOW + HOUR, prefix: '', roleOf: () => null, chats: [], as: 'person' })
    assert.equal(alone.status, 409)
    assert.equal(valueOf((await readStore(one.dir)).items.get(valueOf(note, 'Id')), 'Recap'), 'open')
  } finally {
    await rm(one.dir, { recursive: true, force: true })
  }
})
