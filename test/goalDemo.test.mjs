// B677: the goal demo before "Did we reach the goal?": the Demo line of the goal map, the card's link and its waiting
// line, Yes waiting for the demo, the board's word to the partner (once, hourly, three at most), the button, the
// partner's rule and the tool that draws the demo. Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { DEMO_AGAIN_MS, DEMO_WORDS, demoAgain, demoAskOf, demoDue, focusMove } from '../src/focus.mjs'
import { hasDemo, parseGoals } from '../src/goals.mjs'
import { focusWords } from '../src/say.mjs'
import { focusState } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'
import { checkList, demoHtml, missingPictures, orderedPictures, pictureFiles } from '../tools/demo.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// focus:start'), script.indexOf('// focus:end'))}
Object.assign(this, { focusView })`, made)
const focusView = (...args) => JSON.parse(JSON.stringify(made.focusView(...args)))
const CAN = { canWrite: true, whyNot: null }

const NOW = new Date(2026, 9, 26, 9, 0).getTime()
const HOUR = DEMO_AGAIN_MS
const goals = extra => ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish you need to judge fun', '    Done when: you judge a fight fun in one playthrough', '    Vibe: every fight reads at a glance',
  '    Vibe agreed: 2026-10-18 10:00', '    Part: Show damage · about 1 h · steps B1', '    How agreed: 2026-10-18 11:00', ...extra, '- [ ] G7 Lanterns', ''].join('\n')
const parse = text => parseItem(text.replace(/^ +/gm, ''))
const stepItem = (id, state) => parse(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nSince: 2026-10-18 09:00\n`)
const focusOf = (extra, steps = ['done']) => focusState(parseGoals(goals(extra)), steps.map((state, at) => stepItem(`B${at + 1}`, state)), [], 'Game - ', 'Partner')

// ---- the files (as the board's own tests fake them) ----
function fakeFs(files) {
  return {
    files,
    readFile: async path => {
      if (!(path in files)) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      return Buffer.from(files[path], 'latin1')
    },
    writeFile: async (path, bytes, options) => {
      if (options?.flag === 'wx' && path in files) throw Object.assign(new Error('there'), { code: 'EEXIST' })
      files[path] = Buffer.from(bytes).toString('latin1')
    },
    rename: async (from, to) => { files[to] = files[from]; delete files[from] },
    rm: async path => { delete files[path] },
    mkdir: async () => {},
    access: async path => { if (!(path in files)) throw new Error('gone') },
    readdir: async dir => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1)),
  }
}
const MAP = 'C:/p/goals.md'
const latin = text => Buffer.from(text, 'utf8').toString('latin1')
const utf8 = text => Buffer.from(text, 'latin1').toString('utf8')
const mapOf = fs => parseGoals(utf8(fs.files[MAP]))
const ctx = (fs, extra = {}) => ({
  canWrite: true, goalsFile: MAP, historyDir: 'C:/p/history', brainstormDir: 'C:/p/talks', brainstormFolder: 'talks', now: NOW, fs,
  partner: { name: 'Partner', isRunning: true }, job: 'C:/board/roles/partner.md', allDone: true, ...extra,
})
const DONE_FOCUS = { id: 'G6', progress: { done: 1, total: 1 } }

test('the Demo line and the board\'s Demo asked line are read from the goal map', () => {
  const node = parseGoals(goals(['    Demo: art/g6/demo/g6-demo.png · what G6 made', '    Demo asked: 2026-10-26 09:00 · 2'])).byId.get('G6')
  assert.deepEqual([node.demo, node.demoAsked, hasDemo(node)], ['art/g6/demo/g6-demo.png · what G6 made', '2026-10-26 09:00 · 2', true])
  const none = parseGoals(goals([])).byId.get('G6')
  assert.deepEqual([none.demo, none.demoAsked, hasDemo(none)], [null, null, false])
  assert.deepEqual(demoAskOf('2026-10-26 09:00 · 2'), { at: '2026-10-26 09:00', n: 2 })
  assert.deepEqual(demoAskOf('2026-10-26 09:00'), { at: '2026-10-26 09:00', n: 1 })
  assert.equal(demoAskOf('soon'), null)
})

test('the state carries the demo as { path, caption } and whether it was asked', () => {
  const state = focusOf(['    Demo: art/g6/demo/g6-demo.png · what G6 made', '    Demo asked: 2026-10-26 09:00 · 1'])
  assert.deepEqual(state.demo, { path: 'art/g6/demo/g6-demo.png', caption: 'what G6 made' })
  assert.equal(state.demoAsked, '2026-10-26 09:00 · 1')
  assert.deepEqual([focusOf([]).demo, focusOf([]).demoAsked], [null, null])
})

test('the card "Did we reach the goal?" links the demo above Yes and No; without it Yes waits and the partner is asked again by a button', () => {
  const withDemo = focusView(focusOf(['    Demo: art/g6/demo/g6-demo.png · what G6 made']), null, CAN).vibeThere
  assert.deepEqual(withDemo.demo, { text: null, link: { label: 'See the goal demo', path: 'art/g6/demo/g6-demo.png', caption: 'what G6 made' }, again: null })
  assert.equal(withDemo.buttons[0].isEnabled, true)
  const without = focusView(focusOf([]), null, CAN).vibeThere
  assert.equal(without.demo.text, 'Your partner makes the goal demo first.')
  assert.equal(without.demo.link, null)
  assert.deepEqual([without.demo.again.label, without.demo.again.act, without.demo.again.isEnabled], ['Ask your partner again', 'goal-demo', true])
  assert.deepEqual([without.buttons[0].label, without.buttons[0].isEnabled, without.buttons[1].isEnabled], ['Yes', false, true])
  assert.match(without.buttons[0].title, /goal demo first/)
})

test('the page opens the demo in the picture window and sends the button\'s move', () => {
  assert.match(script, /see\.dataset\.zoom = demo\.link\.path/)
  assert.match(script, /command: 'goal-demo', id: focus\.id/)
})

test('Yes without a demo is refused; with one it asks for the re-check as before', async () => {
  const fs = fakeFs({ [MAP]: latin(goals([])) })
  const refused = await focusMove({ command: 'vibe-there-yes', id: 'G6' }, ctx(fs))
  assert.deepEqual([refused.status, /no goal demo yet/.test(refused.why)], [409, true])
  const withDemo = fakeFs({ [MAP]: latin(goals(['    Demo: art/g6/demo.png · what G6 made'])) })
  const yes = await focusMove({ command: 'vibe-there-yes', id: 'G6' }, ctx(withDemo))
  assert.equal(yes.words.command, 'goal-recheck')
})

test('the word to the partner: goal demo: G<n> <title> with the Done when and the job; again says which word', () => {
  const goal = parseGoals(goals([])).byId.get('G6')
  const first = focusWords('goal-demo', { to: 'Partner', goal, job: 'C:/board/roles/partner.md' })
  assert.equal(first.command, 'goal-demo')
  assert.equal(first.text, 'goal demo: G6 The polish you need to judge fun\nDone when: you judge a fight fun in one playthrough\nYour job: C:/board/roles/partner.md, "The goal demo"')
  assert.match(focusWords('goal-demo', { to: 'Partner', goal, words: 2, job: 'j' }).text, /^goal demo: G6 .* \(again: word 2\)\n/)
  assert.match(focusWords('goal-demo', { to: 'Partner', goal, words: 'by you', job: 'j' }).text, /\(again: you asked\)/)
})

test('every part done and no demo: one word at once, one more each hour, three at most; none once the demo stands', async () => {
  const fs = fakeFs({ [MAP]: latin(goals([])) })
  const at = offset => ctx(fs, { now: NOW + offset, focus: DONE_FOCUS })
  const first = await demoAgain(at(0))
  assert.equal(first.length, 1)
  assert.equal(first[0].command, 'goal-demo')
  assert.equal(mapOf(fs).byId.get('G6').demoAsked, '2026-10-26 09:00 · 1')
  assert.deepEqual(await demoAgain(at(HOUR - 60_000)), [])
  const second = await demoAgain(at(HOUR))
  assert.equal(second.length, 1)
  assert.match(second[0].text, /\(again: word 2\)/)
  const third = await demoAgain(at(2 * HOUR))
  assert.match(third[0].text, /\(again: word 3\)/)
  assert.equal(DEMO_WORDS, 3)
  assert.deepEqual(await demoAgain(at(9 * HOUR)), [])
  // The demo stands: nothing is asked, whatever the count.
  const stands = fakeFs({ [MAP]: latin(goals(['    Demo: a/b.png · made', '    Demo asked: 2026-10-26 07:00 · 1'])) })
  assert.deepEqual(await demoAgain(ctx(stands, { now: NOW + 5 * HOUR, focus: DONE_FOCUS })), [])
})

test('not asked while a part is open, without a partner, on a board that only shows, or for another goal', async () => {
  const fs = fakeFs({ [MAP]: latin(goals([])) })
  assert.deepEqual(await demoAgain(ctx(fs, { focus: { id: 'G6', progress: { done: 0, total: 1 } } })), [])
  assert.deepEqual(await demoAgain(ctx(fs, { focus: DONE_FOCUS, partner: null })), [])
  assert.deepEqual(await demoAgain(ctx(fs, { focus: DONE_FOCUS, canWrite: false })), [])
  assert.deepEqual(await demoAgain(ctx(fs, { focus: { id: 'G7', progress: { done: 1, total: 1 } } })), [])
  assert.equal(mapOf(fs).byId.get('G6').demoAsked, null)
  assert.equal(demoDue(parseGoals(goals([])).byId.get('G6'), NOW), 1)
})

test('"Ask your partner again" starts the count anew and types the word at once', async () => {
  const fs = fakeFs({ [MAP]: latin(goals(['    Demo asked: 2026-10-26 06:00 · 3'])) })
  const again = await focusMove({ command: 'goal-demo', id: 'G6' }, ctx(fs))
  assert.equal(again.ok, true, again.why)
  assert.match(again.words.text, /^goal demo: G6 .* \(again: you asked\)/)
  assert.equal(mapOf(fs).byId.get('G6').demoAsked, '2026-10-26 09:00 · 1')
  const notDone = await focusMove({ command: 'goal-demo', id: 'G6' }, ctx(fs, { allDone: false }))
  assert.equal(notDone.status, 409)
  const stands = fakeFs({ [MAP]: latin(goals(['    Demo: a/b.png · made'])) })
  assert.equal((await focusMove({ command: 'goal-demo', id: 'G6' }, ctx(stands))).status, 409)
})

test('the board asks for the demo in its reconcile loop; the partner\'s job names the goal demo', async () => {
  const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')
  assert.match(server, /loops\.run\('goal-demo', \(\) => demoNow\(state\)\)/)
  const partner = (await readFile(join(ROOT, 'roles', 'partner.md'), 'utf8')).replace(/\s+/g, ' ')
  assert.match(partner, /## The goal demo/)
  for (const words of ['`goal demo: G<n> <title>`', '`Demo: <the picture\'s path in the picture folder> · <a few words>`', 'node tools/demo.mjs', 'Reached', 'Not reached', 'Still open', 'FOLLOW-UP', 'fixed for good', 'escalate']) assert.ok(partner.includes(words), words)
  assert.doesNotMatch(partner, /very last step is a recap page/)
})

// ---- the tool that draws the demo ----

const list = () => ({
  goal: 'G6', title: 'The polish',
  sections: [
    { kind: 'reached', rows: [{ title: '1. Damage', note: 'seen before the click', pictures: [
      { kind: 'final', caption: 'now', path: 'shots/after.png' }, { kind: 'between', caption: 'try 1', path: 'shots/mid.png' },
      { kind: 'target', caption: 'the target', path: 'shots/target.png' }, { kind: 'before', caption: 'before', path: 'shots/before.png' }] }] },
    { kind: 'not-reached', intro: ['What went wrong:'], items: ['The wrong method.', 'Unfair checks.'], rows: [{ title: '2. Hits', pictures: [{ kind: 'final-not', caption: 'last try', path: 'shots/hit.png' }] }] },
    { kind: 'open', items: ['Lanterns (B9)'], rows: [{ title: 'Three left', grid: [{ caption: 'A', path: 'shots/a.png' }, { caption: 'B', path: 'shots/b.png' }], cols: 2 }] },
  ],
  followUp: { fixedForGood: ['A rule now stops it (B1).'], fixedOnce: ['Fixed by hand. Action: a step.'], backlog: ['Hits: B9.'], noStep: ['Bridges: needs your yes.'], escalate: ['Refining: ask the architect.'] },
})

test('in every row the target comes first, then before, in between, and the final last, whatever the list says', () => {
  const rows = list().sections[0].rows[0].pictures
  assert.deepEqual(orderedPictures(rows).map(one => one.kind), ['target', 'before', 'between', 'final'])
  const html = demoHtml(list(), 'C:/p')
  const order = ['TARGET', 'BEFORE THIS GOAL', 'IN BETWEEN', 'FINAL, IN THE GAME'].map(label => html.indexOf(`>${label}<`))
  assert.ok(order.every(at => at > 0) && order.every((at, i) => i === 0 || at > order[i - 1]), String(order))
  for (const label of ['LAST TRY, IN THE GAME']) assert.ok(html.includes(`>${label}<`), label)
})

test('three sections apart with their colours, then the five follow-up groups in order', () => {
  const html = demoHtml(list(), 'C:/p')
  const bands = ['>REACHED<', '>NOT REACHED: WHAT WENT WRONG<', '>STILL OPEN<', '>FOLLOW-UP: WHAT WENT WRONG, AND WHAT IS DONE ABOUT IT<'].map(one => html.indexOf(one))
  assert.ok(bands.every((at, i) => at > 0 && (i === 0 || at > bands[i - 1])), String(bands))
  assert.match(html, /<h3 style="color:#5ad19a">1\. Damage/)
  assert.match(html, /<h3 style="color:#ff8278">2\. Hits/)
  assert.match(html, /<h3 style="color:#9aa7bb">Three left/)
  const groups = ['Fixed for good', 'Fixed this time only', 'Not fixed yet: on the backlog', 'Not fixed yet: no step', 'Escalate'].map(one => html.indexOf(one))
  assert.ok(groups.every((at, i) => at > bands[3] && (i === 0 || at > groups[i - 1])), String(groups))
})

test('every bullet is one item per line; a line with several items, or a line break, is refused', () => {
  const html = demoHtml(list(), 'C:/p')
  assert.equal((html.match(/<li>/g) ?? []).length, 2 + 1 + 5 + 1 - 1 + 1)
  assert.match(html, /<li>The wrong method\.<\/li><li>Unfair checks\.<\/li>/)
  const bad = list()
  bad.sections[1].items = ['One. • Two.']
  assert.throws(() => checkList(bad), /one item per bullet/)
  bad.sections[1].items = ['One.\nTwo.']
  assert.throws(() => checkList(bad), /one item per bullet/)
  bad.sections[1].items = ['']
  assert.throws(() => checkList(bad), /empty bullet/)
})

test('pictures keep their own size: rows wrap, only a picture wider than the page shrinks; words are escaped', () => {
  const html = demoHtml({ ...list(), title: 'A <b>&</b> title' }, 'C:/p')
  assert.match(html, /\.pictures img\{display:block;max-width:100%;height:auto\}/)
  assert.match(html, /\.pictures\{display:flex;flex-wrap:wrap;/)
  assert.match(html, /figure\{margin:0;min-width:0;max-width:100%;flex:none\}/)
  assert.match(html, /\.grid\{display:flex;flex-wrap:wrap;/)
  assert.ok(!html.includes('grid-template-columns'))
  assert.ok(!html.includes('<b>&</b>'))
  assert.match(html, /A &lt;b&gt;&amp;&lt;\/b&gt; title/)
})

test('only files that exist: a picture that is not there stops the demo and is named', () => {
  const files = pictureFiles(list(), 'C:/p')
  assert.equal(files.length, 7)
  assert.ok(files.includes('C:\\p\\shots\\target.png') || files.includes('C:/p/shots/target.png'))
  const gone = missingPictures(list(), 'C:/p', file => !/hit\.png$/.test(file))
  assert.equal(gone.length, 1)
  assert.match(gone[0], /hit\.png$/)
  assert.deepEqual(missingPictures(list(), 'C:/p', () => true), [])
})

test('a list the tool cannot draw is refused with the reason', () => {
  assert.throws(() => checkList(null), /an object/)
  assert.throws(() => checkList({ goal: 'six', sections: [{}] }), /by id/)
  assert.throws(() => checkList({ goal: 'G6', sections: [] }), /no sections/)
  assert.throws(() => checkList({ goal: 'G6', sections: [{ kind: 'maybe' }] }), /reached, not-reached or open/)
  assert.throws(() => checkList({ goal: 'G6', sections: [{ kind: 'reached', rows: [{ title: 'x' }] }] }), /pictures or a grid/)
  assert.throws(() => checkList({ goal: 'G6', sections: [{ kind: 'reached', rows: [{ title: 'x', pictures: [{ kind: 'sketch', path: 'a.png' }] }] }] }), /a picture's kind is/)
})

// ---- B686: what the first result check of B677 found ----

test('B686: the word to the partner keeps every letter s of the Done when and squeezes only white space', () => {
  const goal = { ...parseGoals(goals([])).byId.get('G6'), doneWhen: 'Every screen shows\n  how the stress  lands' }
  const words = focusWords('goal-demo', { to: 'Partner', goal, job: 'j' })
  assert.equal(words.text.split('\n')[1], 'Done when: Every screen shows how the stress lands')
})

test('B686: the button "Ask your partner again" has a rule of its own, beside the waiting line', async () => {
  const css = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')
  assert.match(css, /^\.focus-ask-demo \{[^}]*cursor: pointer/m)
  assert.match(css, /^\.focus-ask-demo:disabled \{/m)
})

test('B686: a No takes the old demo and its asked line away, so the parts done again ask for a new demo', async () => {
  const fs = fakeFs({ [MAP]: latin(goals(['    Demo: a/b.png · what G6 made', '    Demo asked: 2026-10-26 07:00 · 2'])) })
  const no = await focusMove({ command: 'vibe-there-no', id: 'G6', text: 'the damage is not readable' }, ctx(fs))
  assert.equal(no.ok, true, no.why)
  const node = mapOf(fs).byId.get('G6')
  assert.deepEqual([node.demo, node.demoAsked, hasDemo(node)], [null, null, false])
  // The how is agreed anew; the parts done again, the demo is due once more.
  assert.equal(demoDue(node, NOW), 1)
  assert.ok(!/^\s*Demo( asked)?:/m.test(utf8(fs.files[MAP])))
})

test('B686: after the third word and an hour without a demo the card says the partner did not answer', () => {
  const at = (extra, now) => JSON.parse(JSON.stringify(focusState(parseGoals(goals(extra)), [stepItem('B1', 'done')], [], 'Game - ', 'Partner', now)))
  const view = state => focusView(state, null, CAN).vibeThere.demo
  const third = '    Demo asked: 2026-10-26 07:00 · 3'
  assert.equal(at([third], NOW).demoGaveUp, true)
  assert.match(view(at([third], NOW)).text, /did not answer in three tries/)
  assert.ok(view(at([third], NOW)).again !== null)
  // Not yet: the third word is under an hour old, or only the second went, or there is no time.
  assert.equal(at([third], new Date(2026, 9, 26, 7, 59).getTime()).demoGaveUp, false)
  assert.equal(at(['    Demo asked: 2026-10-26 06:00 · 2'], NOW).demoGaveUp, false)
  assert.equal(at([third], null).demoGaveUp, false)
  assert.equal(view(at([third], null)).text, 'Your partner makes the goal demo first.')
  // With the demo there, never.
  assert.equal(at([third, '    Demo: a/b.png · made'], NOW).demoGaveUp, false)
})
