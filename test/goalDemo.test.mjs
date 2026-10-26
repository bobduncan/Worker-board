// B677: the goal demo before "Did we reach the goal?": the Demo line of the goal map, the card's link and its waiting
// line, Yes waiting for the demo, the board's word to the partner (once, hourly, three at most), the button, the
// partner's rule and the tool that draws the demo. Made-up names only.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { DEMO_AGAIN_MS, DEMO_WORDS, demoAgain, demoAskOf, demoDue, focusMove } from '../src/focus.mjs'
import { hasDemo, parseGoals } from '../src/goals.mjs'
import { focusWords } from '../src/say.mjs'
import { focusState } from '../src/state.mjs'
import { createBoard } from '../server.mjs'
import { checkList, demoPage, orderedPictures, pathFrom } from '../src/demo.mjs'
import { findDemo } from '../src/pictures.mjs'
import { parseItem } from '../src/work/item.mjs'
import { demoFile, missingPictures, pictureFiles, tooBigPictures, writeDemo } from '../tools/demo.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// focus:start'), script.indexOf('// focus:end'))}
Object.assign(this, { focusView })`, made)
const focusView = (...args) => JSON.parse(JSON.stringify(made.focusView(...args)))
// B699: the demo page's drawing, run over a made-up document: every node is { tag, className, text, children }.
const node = (tag, className = '', text = null) => ({ tag, className, text, children: [], dataset: {}, append(...more) { this.children.push(...more) } })
const drawn = {}
vm.runInNewContext(`${script.slice(script.indexOf('// demo:start'), script.indexOf('// demo:end'))}
Object.assign(this, { demoBody })`, Object.assign(drawn, { el: node, picture: (path, caption) => Object.assign(node('button', 'picture'), { path, caption }) }))
const flat = (one, found = []) => { found.push(one); for (const child of one.children) flat(child, found); return found }
const withClass = (one, className) => flat(one).filter(each => each.className.split(' ').includes(className))
const wordsOf = one => flat(one).map(each => each.text).filter(text => text !== null).join(' ')
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
  assert.deepEqual(state.demo, { path: 'art/g6/demo/g6-demo.png', caption: 'what G6 made', isPage: false })
  assert.equal(state.demoAsked, '2026-10-26 09:00 · 1')
  assert.deepEqual([focusOf([]).demo, focusOf([]).demoAsked], [null, null])
})

test('the card "Did we reach the goal?" links the demo above Yes and No; without it Yes waits and the partner is asked again by a button', () => {
  const withDemo = focusView(focusOf(['    Demo: art/g6/demo/g6-demo.png · what G6 made']), null, CAN).vibeThere
  assert.deepEqual(withDemo.demo, { text: null, link: { label: 'See the goal demo', path: 'art/g6/demo/g6-demo.png', caption: 'what G6 made', isPage: false }, again: null })
  assert.equal(withDemo.buttons[0].isEnabled, true)
  const without = focusView(focusOf([]), null, CAN).vibeThere
  assert.equal(without.demo.text, 'Your partner makes the goal demo first.')
  assert.equal(without.demo.link, null)
  assert.deepEqual([without.demo.again.label, without.demo.again.act, without.demo.again.isEnabled], ['Ask your partner again', 'goal-demo', true])
  assert.deepEqual([without.buttons[0].label, without.buttons[0].isEnabled, without.buttons[1].isEnabled], ['Yes', false, true])
  assert.match(without.buttons[0].title, /goal demo first/)
})

test('the page opens a demo picture in the picture window, a demo.json as a page, and sends the button\'s move', () => {
  assert.match(script, /else see\.dataset\.zoom = demo\.link\.path/)
  assert.match(script, /if \(demo\.link\.isPage\) see\.dataset\.demo = demo\.link\.path/)
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
  for (const words of ['`goal demo: G<n> <title>`', '`Demo: <the demo.json\'s path in the picture folder> · <a few words>`', 'node tools/demo.mjs', 'Reached', 'Not reached', 'Still open', 'FOLLOW-UP', 'fixed for good', 'escalate']) assert.ok(partner.includes(words), words)
  assert.doesNotMatch(partner, /very last step is a recap page/)
})

// ---- B699: the demo as data the board draws (src/demo.mjs, tools/demo.mjs, GET /api/demo, the page) ----

const list = () => ({
  goal: 'G6', title: 'The polish',
  sections: [
    { kind: 'reached', rows: [{ title: '1. Damage', note: 'seen before the click', pictures: [
      { kind: 'final', caption: 'now', path: 'shots/after.png' }, { kind: 'between', caption: 'try 1', path: 'shots/mid.png' },
      { kind: 'target', caption: 'the target', path: 'shots/target.png' }, { kind: 'before', caption: 'before', path: 'shots/before.png' }] }] },
    { kind: 'not-reached', intro: ['What went wrong:'], items: ['The wrong method.', 'Unfair checks.'], rows: [{ title: '2. Hits', pictures: [{ kind: 'final-not', caption: 'last try', path: 'shots/hit.png' }] }] },
    { kind: 'open', items: ['Lanterns (B9)'], rows: [{ title: 'Three left', grid: [{ caption: 'A', path: 'shots/a.png' }, { caption: 'B', path: 'shots/b.png' }] }] },
  ],
  followUp: { fixedForGood: ['A rule now stops it (B1).'], fixedOnce: ['Fixed by hand. Action: a step.'], backlog: ['Hits: B9.'], noStep: ['Bridges: needs your yes.'], escalate: ['Refining: ask the architect.'] },
})

test('in every row the target comes first, then before, in between, and the final last, whatever the list says', () => {
  const rows = list().sections[0].rows[0].pictures
  assert.deepEqual(orderedPictures(rows).map(one => one.kind), ['target', 'before', 'between', 'final'])
  const row = demoPage(list(), 'g6/demo').sections[0].rows[0]
  assert.deepEqual(row.pictures.map(one => one.label), ['TARGET', 'BEFORE THIS GOAL', 'IN BETWEEN', 'FINAL, IN THE GAME'])
  assert.deepEqual(row.pictures.map(one => one.path), ['g6/demo/shots/target.png', 'g6/demo/shots/before.png', 'g6/demo/shots/mid.png', 'g6/demo/shots/after.png'])
  assert.equal(demoPage(list(), '').sections[1].rows[0].pictures[0].label, 'LAST TRY, IN THE GAME')
})

test('three sections apart with their verdicts, then the five follow-up groups in order', () => {
  const page = demoPage(list(), 'g6/demo')
  assert.deepEqual(page.sections.map(one => [one.kind, one.verdict, one.band]), [['reached', 'Reached', 'REACHED'], ['not-reached', 'Not reached', 'NOT REACHED: WHAT WENT WRONG'], ['open', 'Still open', 'STILL OPEN']])
  assert.equal(page.followUp.band, 'FOLLOW-UP: WHAT WENT WRONG, AND WHAT IS DONE ABOUT IT')
  assert.deepEqual(page.followUp.groups.map(one => one.key), ['fixedForGood', 'fixedOnce', 'backlog', 'noStep', 'escalate'])
  assert.deepEqual(page.followUp.groups.map(one => one.title), ['Fixed for good: a rule or the board now prevents it', 'Fixed this time only: needs a lasting fix', 'Not fixed yet: on the backlog', 'Not fixed yet: no step', 'Escalate: no clear fix here'])
  // A grid's pictures carry no label; a list without a follow-up has none; the title and the intro have words.
  assert.deepEqual(page.sections[2].rows[0].pictures.map(one => [one.label, one.caption]), [[null, 'A'], [null, 'B']])
  const bare = demoPage({ ...list(), title: undefined, followUp: undefined })
  assert.deepEqual([bare.followUp, bare.title, /^In every row: target first/.test(bare.intro)], [null, 'the goal demo', true])
})

test('the page draws each part with its verdict, its labelled pictures, and the follow-up last', () => {
  const body = drawn.demoBody(demoPage(list(), 'g6/demo'))
  assert.equal(wordsOf(withClass(body, 'demo-title')[0]), 'G6 · The polish: the goal demo')
  const sections = body.children.filter(one => one.tag === 'section')
  assert.deepEqual(sections.map(one => one.className), ['demo-section is-reached', 'demo-section is-not-reached', 'demo-section is-open', 'demo-section is-follow-up'])
  assert.deepEqual(sections.map(one => wordsOf(withClass(one, 'demo-band')[0])).slice(0, 3), ['REACHED', 'NOT REACHED: WHAT WENT WRONG', 'STILL OPEN'])
  assert.deepEqual(withClass(body, 'demo-verdict').map(wordsOf), ['Reached', 'Not reached', 'Still open'])
  assert.deepEqual(withClass(sections[0], 'demo-kind').map(wordsOf), ['TARGET', 'BEFORE THIS GOAL', 'IN BETWEEN', 'FINAL, IN THE GAME'])
  assert.deepEqual(withClass(sections[0], 'demo-figure').map(one => one.className), ['demo-figure is-target', 'demo-figure is-before', 'demo-figure is-between', 'demo-figure is-final'])
  // Each picture is its own file, opened by a click on the picture frame (the picture window shows it at its own size).
  assert.deepEqual(flat(sections[0]).filter(one => one.tag === 'button').map(one => one.path), ['g6/demo/shots/target.png', 'g6/demo/shots/before.png', 'g6/demo/shots/mid.png', 'g6/demo/shots/after.png'])
  assert.ok(flat(sections[0]).filter(one => one.tag === 'button').every(one => one.className === 'picture demo-picture'))
  assert.deepEqual(withClass(sections[3], 'demo-group').map(one => one.className.split(' ')[1]), ['is-fixedForGood', 'is-fixedOnce', 'is-backlog', 'is-noStep', 'is-escalate'])
  assert.deepEqual(withClass(sections[1], 'demo-items')[0].children.map(wordsOf), ['The wrong method.', 'Unfair checks.'])
})

test('every bullet is one item per line; a line with several items, or a line break, is refused', () => {
  const bad = list()
  bad.sections[1].items = ['One. • Two.']
  assert.throws(() => checkList(bad), /one item per bullet/)
  bad.sections[1].items = ['One.\nTwo.']
  assert.throws(() => checkList(bad), /one item per bullet/)
  bad.sections[1].items = ['']
  assert.throws(() => checkList(bad), /empty bullet/)
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

test('a picture over the board\'s limit is named: the board would answer too big', () => {
  const big = tooBigPictures(list(), 'C:/p', file => (/hit\.png$/.test(file) ? 40 * 1024 * 1024 : 1000))
  assert.equal(big.length, 1)
  assert.match(big[0].file, /hit\.png$/)
  assert.deepEqual(tooBigPictures(list(), 'C:/p', () => 32 * 1024 * 1024), [])
})

test('a list the tool cannot draw is refused with the reason', () => {
  assert.throws(() => checkList(null), /an object/)
  assert.throws(() => checkList({ goal: 'six', sections: [{}] }), /by id/)
  assert.throws(() => checkList({ goal: 'G6', sections: [] }), /no sections/)
  assert.throws(() => checkList({ goal: 'G6', sections: [{ kind: 'maybe' }] }), /reached, not-reached or open/)
  assert.throws(() => checkList({ goal: 'G6', sections: [{ kind: 'reached', rows: [{ title: 'x' }] }] }), /pictures or a grid/)
  assert.throws(() => checkList({ goal: 'G6', sections: [{ kind: 'reached', rows: [{ title: 'x', pictures: [{ kind: 'sketch', path: 'a.png' }] }] }] }), /a picture's kind is/)
})

test('a picture path starts at the folder of the demo.json that names it', () => {
  assert.equal(pathFrom('g6/demo', 'shots/a.png'), 'g6/demo/shots/a.png')
  assert.equal(pathFrom('g6/demo', '../heights/b.png'), 'g6/heights/b.png')
  assert.equal(pathFrom('g6/demo', 'C:/elsewhere/a.png'), 'C:/elsewhere/a.png')
  assert.equal(pathFrom('', 'a/b.png'), 'a/b.png')
})

/** A project folder with picture files of their own sizes: the demo tool and the board's reading run on real files. */
async function withProject(run) {
  const project = await mkdtemp(join(tmpdir(), 'demo-b699-'))
  try {
    await mkdir(join(project, 'art', 'g6', 'shots'), { recursive: true })
    for (const name of ['target', 'before', 'mid', 'after', 'hit', 'a', 'b']) await writeFile(join(project, 'art', 'g6', 'shots', `${name}.png`), Buffer.from(`pixels of ${name}`))
    await run(project)
  } finally {
    await rm(project, { recursive: true, force: true })
  }
}

test('the tool writes demo.json beside the pictures: ordered rows, paths from its own folder, every picture its own file', async () => {
  await withProject(async project => {
    const listFile = join(project, 'art', 'g6', 'list.json')
    await writeFile(listFile, JSON.stringify(list()))
    const out = join(project, 'art', 'g6', 'demo', 'demo.json')
    const done = await writeDemo({ listFile, out })
    assert.deepEqual([done.out, done.pictures], [out, 7])
    const written = JSON.parse(await readFile(out, 'utf8'))
    assert.deepEqual(written.sections[0].rows[0].pictures.map(one => [one.kind, one.path]),
      [['target', '../shots/target.png'], ['before', '../shots/before.png'], ['between', '../shots/mid.png'], ['final', '../shots/after.png']])
    assert.deepEqual(written.sections[2].rows[0].grid.map(one => one.path), ['../shots/a.png', '../shots/b.png'])
    // Without --out it lands beside the list as demo.json, and never over the list itself.
    assert.equal((await writeDemo({ listFile })).out, join(project, 'art', 'g6', 'demo.json'))
    await assert.rejects(writeDemo({ listFile, out: listFile }), /not the list itself/)
    // demoFile is pure: the same file from the list.
    assert.deepEqual(demoFile(list(), join(project, 'art', 'g6'), join(project, 'art', 'g6', 'demo')), written)
  })
})

test('the tool stops on a picture that is not there, naming it, and writes nothing', async () => {
  await withProject(async project => {
    const listFile = join(project, 'art', 'g6', 'list.json')
    const gone = list()
    gone.sections[1].rows[0].pictures[0].path = 'shots/gone.png'
    await writeFile(listFile, JSON.stringify(gone))
    const out = join(project, 'art', 'g6', 'demo', 'demo.json')
    await assert.rejects(writeDemo({ listFile, out }), /not there[\s\S]*gone\.png/)
    await assert.rejects(readFile(out), { code: 'ENOENT' })
    const odd = list()
    odd.sections[1].rows[0].pictures[0].path = 'list.json'
    await writeFile(listFile, JSON.stringify(odd))
    await assert.rejects(writeDemo({ listFile, out }), /a picture is a \.png/)
  })
})

test('the board reads a demo.json of a shown folder as the page, with paths from its folder; else nothing or a plain reason', async () => {
  await withProject(async project => {
    const listFile = join(project, 'art', 'g6', 'list.json')
    await writeFile(listFile, JSON.stringify(list()))
    await writeDemo({ listFile, out: join(project, 'art', 'g6', 'demo', 'demo.json') })
    const roots = ['art']
    const found = await findDemo(project, roots, 'art/g6/demo/demo.json')
    assert.equal(found.page.goal, 'G6')
    assert.deepEqual(found.page.sections[0].rows[0].pictures.map(one => one.path), ['art/g6/shots/target.png', 'art/g6/shots/before.png', 'art/g6/shots/mid.png', 'art/g6/shots/after.png'])
    // Not a shown folder, not a .json, a path that climbs, a file that is not there: nothing.
    assert.equal(await findDemo(project, ['other'], 'art/g6/demo/demo.json'), null)
    assert.equal(await findDemo(project, roots, 'art/g6/shots/target.png'), null)
    assert.equal(await findDemo(project, roots, 'art/../g6/demo/demo.json'), null)
    assert.equal(await findDemo(project, roots, 'art/g6/demo/none.json'), null)
    // A file that is there but cannot be drawn answers why, in plain words.
    await writeFile(join(project, 'art', 'g6', 'demo', 'broken.json'), '{ not json')
    await writeFile(join(project, 'art', 'g6', 'demo', 'bare.json'), JSON.stringify({ goal: 'six' }))
    assert.equal((await findDemo(project, roots, 'art/g6/demo/broken.json')).why, 'The demo list is not valid JSON.')
    assert.match((await findDemo(project, roots, 'art/g6/demo/bare.json')).why, /by id/)
  })
})

test('GET /api/demo gives the page to the board\'s own page only; 404 without a demo, 422 with the reason', async () => {
  const token = 'a'.repeat(64)
  const server = createBoard({
    token, getState: async () => ({ readAt: 1, chats: [] }), say: async () => ({}),
    demo: async path => (path === 'art/g6/demo/demo.json' ? { page: { goal: 'G6' } } : path === 'art/g6/demo/broken.json' ? { why: 'The demo list is not valid JSON.' } : null),
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const ask = (path, headers = {}) => new Promise((resolve, reject) => {
    const call = request({ host: '127.0.0.1', port: server.address().port, path, headers }, answer => {
      let text = ''
      answer.on('data', chunk => { text += chunk })
      answer.on('end', () => resolve({ status: answer.statusCode, text }))
    })
    call.on('error', reject)
    call.end()
  })
  try {
    const path = `/api/demo?path=${encodeURIComponent('art/g6/demo/demo.json')}`
    assert.equal((await ask(path)).status, 403)
    const good = await ask(path, { 'X-Board-Token': token })
    assert.deepEqual([good.status, JSON.parse(good.text)], [200, { goal: 'G6' }])
    assert.equal((await ask('/api/demo?path=art/none.json', { 'X-Board-Token': token })).status, 404)
    const broken = await ask('/api/demo?path=art/g6/demo/broken.json', { 'X-Board-Token': token })
    assert.deepEqual([broken.status, broken.text.includes('not valid JSON')], [422, true])
  } finally {
    await new Promise(done => server.close(done))
  }
})

test('a Demo line naming a .json is a page: the state says so and carries the number of words; the page keeps no copy of it', async () => {
  const page = focusOf(['    Demo: art/g6/demo/demo.json · what G6 made'])
  assert.deepEqual(page.demo, { path: 'art/g6/demo/demo.json', caption: 'what G6 made', isPage: true })
  assert.equal(page.demoWords, DEMO_WORDS)
  const link = focusView(page, null, CAN).vibeThere.demo.link
  assert.deepEqual([link.path, link.isPage], ['art/g6/demo/demo.json', true])
  assert.ok(!/DEMO_WORDS_SHOWN/.test(script))
  assert.match(script, /location\.hash\.startsWith\('#demo='\)/)
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
  assert.match(view(at([third], NOW)).text, /did not answer in 3 tries/)
  assert.ok(view(at([third], NOW)).again !== null)
  // Not yet: the third word is under an hour old, or only the second went, or there is no time.
  assert.equal(at([third], new Date(2026, 9, 26, 7, 59).getTime()).demoGaveUp, false)
  assert.equal(at(['    Demo asked: 2026-10-26 06:00 · 2'], NOW).demoGaveUp, false)
  assert.equal(at([third], null).demoGaveUp, false)
  assert.equal(view(at([third], null)).text, 'Your partner makes the goal demo first.')
  // With the demo there, never.
  assert.equal(at([third, '    Demo: a/b.png · made'], NOW).demoGaveUp, false)
})

test('B699: the demo page\'s pictures are fitted to the row without cropping, and each part has its tone', async () => {
  const css = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')
  assert.match(css, /^\.picture\.demo-picture img \{[^}]*height: auto; aspect-ratio: auto; object-fit: contain/m)
  for (const tone of ['is-reached { --tone: #5ad19a', 'is-not-reached { --tone: #ff8278', 'is-open { --tone: #9aa7bb']) assert.ok(css.includes(tone), tone)
  assert.match(await readFile(join(ROOT, 'public', 'index.html'), 'utf8'), /<dialog class="demo-page" id="demo-page"/)
})

test('B699: the tool stops on a picture over the board\'s limit, naming it and its size, and writes nothing', async () => {
  await withProject(async project => {
    await writeFile(join(project, 'art', 'g6', 'shots', 'hit.png'), Buffer.alloc(33 * 1024 * 1024))
    const listFile = join(project, 'art', 'g6', 'list.json')
    await writeFile(listFile, JSON.stringify(list()))
    const out = join(project, 'art', 'g6', 'demo', 'demo.json')
    await assert.rejects(writeDemo({ listFile, out }), /over the board's limit of 32 MB[\s\S]*hit\.png \(33\.0 MB\)/)
    await assert.rejects(readFile(out), { code: 'ENOENT' })
  })
})
