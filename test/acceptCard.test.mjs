// B883, the fix of X117: B851 sat in review after its fix B875 was dropped on the partner's accept at 74 of 75. Only the
// person's done closes a step below its bar, nobody told them, and the rule dropped-fix raised it again (X117 twice; X54 and
// X116 before). Now such a step gets the person's card under Needs your attention: what it gives, its score beside its bar,
// its evidence and the drop's why, with Accept (done) and Send back (its next try, a fix the partner refines from their note).
// While the card is open the step waits as planned. Made-up items in a temporary folder; no word names a project.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { healthSummary } from '../src/supervisor/health.mjs'
import { findStuck } from '../src/supervisor/rules/repair.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { workApi } from '../src/work/api.mjs'
import { storeNeeds } from '../src/work/lists.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { ACCEPT_GRACE_MS, acceptCardDue, acceptReading, reviewWaitOf } from '../src/work/resultCheck.mjs'
import { readStore } from '../src/work/store.mjs'

const MIN = 60_000
/** 13:30 on a made-up day: the fix B875 was dropped at 12:48, 42 minutes ago. */
const NOW = new Date(2026, 9, 31, 13, 30).getTime()
const at = minutes => stamp(NOW - minutes * MIN)

const STEP = [
  'Id: B851', 'Kind: step', 'Title: Break up the cliff walls\' stripes', 'State: review', 'Owner: Painter', 'Activity: Garden', 'Goal: G29', `Since: ${at(49)}`, 'Branch: b851-walls', '',
  '## Context', '  The walls show even stripes.',
  `  Reported by Painter on 2026-10-31 at 12:41: Context: The walls showed stripes. Change: The walls are now uneven cracked rock on every map. Details: merged abc1234.`, '',
  '## Standard', 'ground look · pictures/walls.png · target 75', '',
  '## What we build', '- uneven rock walls', '- judged beside the painting, target 75', '',
  '## Checked', 'Evidence: pictures/B851/evidence.png', 'Score: 72 of 75', '- pass: uneven rock walls', '- fail: judged beside the painting, target 75', '',
  '## History',
  `- ${at(49)} Painter: in progress → review`,
  `- ${at(49)} server: check passed: work in garden; result named`,
  `- ${at(44)} Checker: result check failed: 1 of 2 points pass, score 72 of 75; fix B875 for Painter`, '',
].join('\n')
const FIX = [
  'Id: B875', 'Kind: step', 'Title: Fix: judged beside the painting', 'State: dropped', 'Owner: Painter', 'Activity: Garden', 'Goal: G29', `Since: ${at(42)}`, 'Fix of: B851', '',
  '## Context', '  Fix of B851: the result check by Checker failed on one point.', '  Dropped by Lead on 2026-10-31 at 12:48: the partner accepts B851 at 74', '',
  '## History', `- ${at(44)} Checker: made by the result check of B851`, `- ${at(42)} Lead: in progress → dropped`, '',
].join('\n')

async function storeWith(files) {
  const dir = await mkdtemp(join(tmpdir(), 'accept-card-'))
  await mkdir(dir, { recursive: true })
  for (const [id, text] of Object.entries(files)) await writeFile(join(dir, `${id}.md`), text)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: Object.keys(files).filter(id => id.startsWith('B')) }] }, null, 1)}\n`)
  return dir
}
const ROLES = { Lead: 'main', Painter: 'worker', Partner: 'advisor' }
const ctx = (dir, now, as) => ({ dir, now, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), as, pictureProblem: async path => (path.startsWith('pictures/') ? null : 'outside'), recaps: [] })
const server = (dir, now = NOW) => workApi({ action: 'accept-cards' }, ctx(dir, now, 'server'))
const person = (dir, body, now = NOW + MIN) => workApi(body, ctx(dir, now, 'person'))

const LEAD = { name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }
const PAINTER = { name: 'Painter', isLeftover: false, state: 'free', isRunning: true }
const view = (items, now) => buildView({ state: { chats: [LEAD, PAINTER], today: [], limits: {}, pause: null, chatPrefix: '', recapWaits: [] }, items, outbox: [], settings: {}, now })
const dropWatch = (items, now) => WATCH_RULES.find(one => one.id === 'dropped-fix').check(view(items, now), { seen: new Map(), observed: [] })
const repairs = (items, now) => findStuck({ items, lanes: [LEAD], partner: { name: 'Partner', state: 'working', isRunning: true }, now }).filter(one => one.check === 'fix-dropped')
const cardsOf = items => [...items.values()].filter(one => one.head.get('Kind') === 'ask' && one.head.get('Via') === 'accept')

test('X117: a step in review whose fix was dropped gets the person\'s card, with what it gives, its score and its evidence', async () => {
  const dir = await storeWith({ B851: STEP, B875: FIX })
  try {
    const before = await readStore(dir)
    assert.equal(reviewWaitOf(before.items.get('B851'), before.items, null, NOW).kind, 'dropped')
    // Today's code raises it after 30 minutes: X117.
    assert.equal(dropWatch(before.items, NOW).length, 1)
    // Within the grace a new fix, check or block may follow: no card yet.
    assert.equal(acceptCardDue(before.items.get('B851'), before.items, NOW - 42 * MIN + ACCEPT_GRACE_MS - MIN), false)
    const done = await server(dir)
    assert.equal(done.ok, true, done.why)
    assert.equal(done.result.filed.length, 1)
    const after = await readStore(dir)
    const [card] = cardsOf(after.items)
    assert.equal(card.head.get('Of'), 'B851')
    assert.equal(card.head.get('Owner'), undefined)
    assert.equal(card.head.get('Title'), 'Accept B851 at 72 of 75, or send it back?')
    assert.equal(card.head.get('Pictures'), 'pictures/B851/evidence.png')
    const words = card.sections.get('Text').join('\n')
    assert.match(words, /its fix B875 was dropped by Lead \(the partner accepts B851 at 74\), and only you close a result below its bar/)
    assert.match(words, /What it gives: The walls are now uneven cracked rock on every map\./)
    assert.match(words, /Its check: 72 of 75, 1 of 2 points pass\./)
    // It stands under Needs your attention, with Accept and Send back, from no chat.
    const [need] = storeNeeds({ ok: true, items: after.items, activities: [] }, { now: NOW })
    assert.deepEqual([need.workId, need.from, need.options.map(one => one.label)], [card.head.get('Id'), null, ['A Accept: done as it is', 'B Send back: the partner makes another try from your note']])
    // The step waits for it: no incident, no repair, nothing odd in the health summary, however long the person takes.
    const wait = reviewWaitOf(after.items.get('B851'), after.items, null, NOW)
    assert.deepEqual([wait.kind, wait.text], ['accept', `waits for your Accept in ${card.head.get('Id')}`])
    for (const minutes of [0, 31, 600]) {
      assert.deepEqual(dropWatch(after.items, NOW + minutes * MIN), [])
      assert.deepEqual(repairs(after.items, NOW + minutes * MIN), [])
    }
    const line = healthSummary(view(after.items, NOW + 600 * MIN)).split('\n').find(one => /^- (?:! )?B851 /.test(one))
    assert.match(line, /^- B851 review .*\(waits for your Accept in Q\d+\)/)
    // A card filed without its picture (by the first version of this pass) gets it on the next pass.
    const file = join(dir, `${card.head.get('Id')}.md`)
    await writeFile(file, (await readFile(file, 'utf8')).replace(/^Pictures: .*\r?\n/m, ''))
    await server(dir, NOW + MIN)
    assert.equal((await readStore(dir)).items.get(card.head.get('Id')).head.get('Pictures'), 'pictures/B851/evidence.png')
    // One card: the pass files none again.
    assert.deepEqual((await server(dir, NOW + 5 * MIN)).result.filed, [])
    // The step's History says it was asked.
    assert.match(after.items.get('B851').sections.get('History').at(-1), /asked you to accept it or send it back: Q\d+$/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Accept marks the step done as the person; Send back needs a note and makes the next try for the partner', async () => {
  const dir = await storeWith({ B851: STEP, B875: FIX })
  try {
    await server(dir)
    const id = cardsOf((await readStore(dir)).items)[0].head.get('Id')
    // Left alone the card never closes the step.
    assert.equal((await readStore(dir)).items.get('B851').head.get('State'), 'review')
    const accepted = await person(dir, { action: 'answer', id, text: 'A Accept: done as it is\nthe stripes are gone' })
    assert.equal(accepted.ok, true, accepted.why)
    assert.equal(accepted.result.accepted, 'B851')
    const done = (await readStore(dir)).items.get('B851')
    assert.equal(done.head.get('State'), 'done')
    assert.match(done.sections.get('History').join('\n'), new RegExp(`person: accepted by you in ${id} at 72 of 75: A Accept`))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  const back = await storeWith({ B851: STEP, B875: FIX })
  try {
    await server(back)
    const id = cardsOf((await readStore(back)).items)[0].head.get('Id')
    const bare = await person(back, { action: 'answer', id, text: 'B Send back: the partner makes another try from your note' })
    assert.deepEqual([bare.ok, bare.status], [false, 400])
    const sent = await person(back, { action: 'answer', id, text: 'B Send back: the partner makes another try from your note\nthe top edge needs big jagged teeth' })
    assert.equal(sent.ok, true, sent.why)
    const items = (await readStore(back)).items
    const fix = items.get(sent.result.fix)
    // Its next try: a fix of the step, open, so the board's refine word takes the person's words to the partner.
    assert.deepEqual([fix.head.get('Fix of'), fix.head.get('State'), fix.head.get('Refined'), fix.head.get('Title')], ['B851', 'new', 'open', 'Fix: the top edge needs big jagged teeth'])
    assert.match(fix.sections.get('Context')[0], new RegExp(`you sent it back in ${id} at 72 of 75`))
    assert.equal(items.get('B851').head.get('State'), 'review')
    const wait = reviewWaitOf(items.get('B851'), items, null, NOW + 2 * MIN)
    assert.deepEqual([wait.kind, wait.fix, wait.unrefined === null], ['fix', sent.result.fix, false])
    // The person's words stand on the step.
    assert.match(items.get('B851').sections.get('Your words')?.join('\n') ?? '', /big jagged teeth/)
    // No new card for it.
    assert.deepEqual((await server(back, NOW + 60 * MIN)).result.filed, [])
  } finally {
    await rm(back, { recursive: true, force: true })
  }
})

test('a card whose step went on is withdrawn; a step that is blocked or has an open fix gets none', async () => {
  const dir = await storeWith({ B851: STEP, B875: FIX })
  try {
    await server(dir)
    const id = cardsOf((await readStore(dir)).items)[0].head.get('Id')
    // The partner made a new fix meanwhile: the card is withdrawn, the step waits for its fix.
    await writeFile(join(dir, 'B890.md'), ['Id: B890', 'Kind: step', 'Title: Fix: teeth', 'State: refined', 'Owner: Painter', 'Activity: Garden', `Since: ${at(-2)}`, 'Fix of: B851', 'Refined: ready', ''].join('\n'))
    const passed = await server(dir, NOW + 3 * MIN)
    assert.deepEqual(passed.result.withdrawn, [id])
    const items = (await readStore(dir)).items
    assert.equal(items.get(id).head.get('State'), 'withdrawn')
    assert.equal(reviewWaitOf(items.get('B851'), items, null, NOW + 3 * MIN).kind, 'fix')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  const blocked = await storeWith({ B851: STEP.replace('Branch: b851-walls', 'Branch: b851-walls\nBlocked by: B900'), B875: FIX, B900: ['Id: B900', 'Kind: step', 'Title: First', 'State: queued', 'Activity: Garden', `Since: ${at(60)}`, ''].join('\n') })
  try {
    assert.deepEqual((await server(blocked)).result.filed, [])
  } finally {
    await rm(blocked, { recursive: true, force: true })
  }
})

test('how an answer to a card reads: A or Accept or a plain yes accepts; anything else sends it back', () => {
  assert.equal(acceptReading(['A Accept: done as it is']), 'accept')
  assert.equal(acceptReading('Accept'), 'accept')
  assert.equal(acceptReading('yes'), 'accept')
  assert.equal(acceptReading('yes, but the edge'), 'back')
  assert.equal(acceptReading(['B Send back: ...', 'teeth']), 'back')
  assert.equal(acceptReading('the edge still reads flat'), 'back')
})
