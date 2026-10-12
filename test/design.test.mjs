import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { LIMITS, checkDesign, designState, parseDesignSettings, promptFor, shortName, stepWord } from '../src/design.mjs'
import { ideasFile, ideasOver, parseIdeas } from '../src/ideas.mjs'
import { pictureKind } from '../server.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIN = 60_000
const NOW = 1_000 * MIN

const kinds = [
  { id: 'screen', name: 'Game screen', opening: 'A screen of the game.', references: ['art-inbox/camera/map.png'] },
  { id: 'board', name: 'Worker board', opening: 'A page of the board.', references: [] },
]
const version = (n, state = 'done', more = {}) => ({ n, at: NOW - (10 - n) * MIN, change: null, from: null, state, picture: state === 'done' ? `art-inbox/ideas/shop-screen/v${n}.png` : null, why: null, seconds: 50, ...more })
const idea = (more = {}) => ({
  id: 'i1', name: 'shop-screen', kind: 'screen', text: 'A shop screen where I spend gold', createdAt: NOW - 20 * MIN, folder: 'art-inbox/ideas/shop-screen',
  references: [], versions: [version(1)], agreed: null, sent: null, droppedAt: null, ...more,
})
const design = (ideas, more = {}) => ({ ideas, kinds, canMake: true, why: null, busy: null, canSend: true, main: 'Main', workers: ['Units', 'Features'], ...more })

test('the settings: kinds with their opening words and reference pictures; what is no kind or no picture is left out', () => {
  const settings = parseDesignSettings(JSON.stringify({
    seconds: 120, codex: ' C:\\tools\\codex.exe ',
    kinds: [
      { id: 'screen', name: 'Game screen', opening: 'A screen.', references: ['art-inbox/a.png', '../outside.png', 'C:/abs.png', 'art-inbox/notes.txt', 'art-inbox\\b.webp'] },
      { id: 'screen', name: 'Twice', opening: 'x' },
      { id: 'Bad Id', name: 'x', opening: 'x' },
      { id: 'empty', name: 'x', opening: ' ' },
    ],
  }))
  assert.deepEqual(settings, { seconds: 120, codex: 'C:\\tools\\codex.exe', kinds: [{ id: 'screen', name: 'Game screen', opening: 'A screen.', references: ['art-inbox/a.png', 'art-inbox/b.webp'] }] })
  assert.deepEqual(parseDesignSettings('not json'), { seconds: 240, codex: '', kinds: [] })
  assert.equal(parseDesignSettings('{"seconds":5}').seconds, 240)
})

test('the settings that come with the board name the four kinds of the design', async () => {
  const settings = parseDesignSettings(await readFile(join(HERE, '..', 'design.json'), 'utf8'))
  assert.deepEqual(settings.kinds.map(kind => [kind.id, kind.name]), [['screen', 'Game screen'], ['art', 'Unit or art'], ['level', 'Level'], ['board', 'Worker board']])
  assert.ok(settings.kinds.every(kind => kind.opening.length > 80 && kind.references.length > 0))
})

test('an idea\'s folder is named after its first words, and no two ideas share one', () => {
  assert.equal(shortName('A shop screen where I spend gold'), 'a-shop-screen-where')
  assert.equal(shortName('Slime!!  enemy'), 'slime-enemy')
  assert.equal(shortName('   '), 'idea')
  assert.equal(shortName('Slime enemy', ['slime-enemy', 'slime-enemy-2']), 'slime-enemy-3')
  assert.ok(shortName('x'.repeat(200)).length <= 32)
  assert.match(shortName('../../etc/passwd'), /^[a-z0-9-]+$/)
})

test('what Codex is told: to make a picture and nothing else, the kind\'s opening, the idea, and for a change what to keep', () => {
  const first = promptFor({ opening: 'A screen of the game.', text: ' A shop screen ', references: 2 })
  assert.ok(first.startsWith('Use your built-in image generation tool'))
  assert.ok(first.includes('save the generated PNG in the current working directory as picture.png'))
  assert.ok(first.includes('NO_IMAGE_TOOL'))
  assert.ok(first.includes('\nA screen of the game.\n\nThe idea: A shop screen\n'))
  assert.ok(first.includes('The attached pictures are references for the look only'))
  assert.ok(!first.includes('last version'))

  const edit = promptFor({ opening: 'A screen.', text: 'A shop', changes: ['Bigger buttons'], change: 'Gold in the corner', isEdit: true, references: 1 })
  assert.ok(edit.includes('Asked for in earlier versions, and still wanted:\n- Bigger buttons'))
  assert.ok(edit.includes('The first attached picture is the last version. Keep everything about it that is not named here, and change this: Gold in the corner'))
  assert.ok(edit.includes('The other attached picture is a reference for the look only'))
  assert.ok(!promptFor({ opening: 'x', text: 'y' }).includes('attached'))
})

test('the step asked of the main chat: the board\'s first line and labels, the person\'s words in one line each', () => {
  const word = stepWord({
    where: 'backlog', title: 'Shop screen: spend gold between fights', kind: 'game screen', description: 'Spend gold on one of three items.',
    requirements: ['Three items to choose from', 'Gold is spent'], folder: 'art-inbox/ideas/shop-screen', picture: 'art-inbox/ideas/shop-screen/v2.png', worker: null, minutes: 60,
  })
  assert.equal(word, [
    'backlog step from the Design tab',
    'Title: Shop screen: spend gold between fights',
    'About: game screen',
    'Description: Spend gold on one of three items.',
    'Requirements:',
    '- Three items to choose from',
    '- Gold is spent',
    'Pictures: art-inbox/ideas/shop-screen (agreed: v2.png)',
    'Worker: Game - Main decides',
    'Time: about 1 h',
  ].join('\n'))
  const queued = stepWord({ where: 'queue', title: 'Slime', kind: 'unit or art', description: '', requirements: [], folder: 'art-inbox/ideas/slime', picture: null, worker: 'Units', minutes: null })
  assert.equal(queued, 'queue step from the Design tab\nTitle: Slime\nAbout: unit or art\nPictures: art-inbox/ideas/slime\nWorker: Units')
  assert.ok(stepWord({ where: 'queue', title: 'x', kind: 'level', description: '', requirements: [], folder: 'f', picture: null, worker: null, minutes: 95 }).endsWith('Time: about 1 h 35 min'))
})

test('making a picture: a kind, the idea\'s words, and only references this page added', () => {
  const check = body => checkDesign(body, design([]))
  assert.deepEqual(check({ action: 'make', kind: 'screen', text: '  A shop screen  ' }), { ok: true, action: 'make', kind: 'screen', text: 'A shop screen', references: [] })
  const ref = 'art-inbox/ideas/_references/0123456789abcdef.png'
  assert.deepEqual(check({ action: 'make', kind: 'board', text: 'x', references: [ref] }).references, [ref])
  assert.equal(check({ action: 'make', kind: 'nope', text: 'x' }).status, 400)
  assert.equal(check({ action: 'make', kind: 'screen', text: ' ' }).status, 400)
  assert.equal(check({ action: 'make', kind: 'screen', text: 'x'.repeat(LIMITS.idea + 1) }).status, 413)
  // A reference is a picture the upload gave a name to: no other path is taken.
  for (const bad of ['art-inbox/secret.png', '../../x.png', 'art-inbox/ideas/_references/../../x.png', 'C:/Users/x.png', 7]) {
    assert.equal(check({ action: 'make', kind: 'screen', text: 'x', references: [bad] }).status, 400, String(bad))
  }
  assert.equal(check({ action: 'make', kind: 'screen', text: 'x', references: [ref, ref, ref, ref] }).status, 400)
  assert.equal(check(null).status, 400)
  assert.equal(check({ action: 'explode' }).status, 409)
})

test('one picture at a time, and none where none can be made', () => {
  const busy = design([idea()], { busy: { idea: 'i1', version: 2, since: NOW } })
  assert.equal(checkDesign({ action: 'make', kind: 'screen', text: 'x' }, busy).status, 409)
  assert.equal(checkDesign({ action: 'again', idea: 'i1', change: 'x' }, busy).status, 409)
  const none = design([idea()], { canMake: false, why: 'Codex was not found on this PC.' })
  assert.deepEqual(checkDesign({ action: 'make', kind: 'screen', text: 'x' }, none), { ok: false, status: 409, why: 'Codex was not found on this PC.' })
  // Looking, agreeing and asking for the step need no Codex.
  assert.equal(checkDesign({ action: 'agree', idea: 'i1', version: 1 }, none).ok, true)
})

test('changing a picture: what should change, from the newest picture or the one named; with no picture yet it is tried again', () => {
  const two = design([idea({ versions: [version(1), version(2, 'failed'), version(3)] })])
  assert.deepEqual(checkDesign({ action: 'again', idea: 'i1', change: ' Bigger buttons ' }, two), { ok: true, action: 'again', idea: 'i1', from: 3, change: 'Bigger buttons' })
  assert.equal(checkDesign({ action: 'again', idea: 'i1', change: 'x', from: 1 }, two).from, 1)
  assert.equal(checkDesign({ action: 'again', idea: 'i1', change: 'x', from: 2 }, two).status, 400)
  assert.equal(checkDesign({ action: 'again', idea: 'i1', change: ' ' }, two).status, 400)
  assert.equal(checkDesign({ action: 'again', idea: 'i1', change: 'x'.repeat(LIMITS.change + 1) }, two).status, 413)
  const failed = design([idea({ versions: [version(1, 'failed')] })])
  assert.deepEqual(checkDesign({ action: 'again', idea: 'i1' }, failed), { ok: true, action: 'again', idea: 'i1', from: null, change: null })
  assert.equal(checkDesign({ action: 'again', idea: 'gone', change: 'x' }, two).status, 409)
})

test('agreeing is to a version that has a picture, and can be taken back', () => {
  const one = design([idea({ versions: [version(1), version(2, 'failed')] })])
  assert.deepEqual(checkDesign({ action: 'agree', idea: 'i1', version: 1 }, one), { ok: true, action: 'agree', idea: 'i1', version: 1 })
  assert.equal(checkDesign({ action: 'agree', idea: 'i1', version: 2 }, one).status, 400)
  assert.equal(checkDesign({ action: 'agree', idea: 'i1', version: null }, one).version, null)
  assert.equal(checkDesign({ action: 'drop', idea: 'i1' }, one).ok, true)
  assert.equal(checkDesign({ action: 'drop', idea: 'i1' }, design([idea({ versions: [version(1, 'making')] })])).status, 409)
})

test('asking for the step: an agreed picture, a title, and a worker of the board or none', () => {
  const agreed = design([idea({ agreed: 1 })])
  const send = { action: 'send', idea: 'i1', where: 'queue', title: ' Shop  screen ', description: 'Spend gold.\nThen go on.', requirements: [' Three items ', '', 'Gold is spent'], worker: 'Units', minutes: 45 }
  const ok = checkDesign(send, agreed)
  assert.deepEqual([ok.ok, ok.where, ok.title, ok.description, ok.requirements, ok.worker, ok.minutes], [true, 'queue', 'Shop screen', 'Spend gold. Then go on.', ['Three items', 'Gold is spent'], 'Units', 45])
  assert.equal(ok.text, 'queue step from the Design tab\nTitle: Shop screen\nAbout: game screen\nDescription: Spend gold. Then go on.\nRequirements:\n- Three items\n- Gold is spent\nPictures: art-inbox/ideas/shop-screen (agreed: v1.png)\nWorker: Units\nTime: about 45 min')
  // A field of the person's cannot add a line of its own: every one is kept to one line.
  assert.ok(!checkDesign({ ...send, title: 'x\nWorker: Main' }, agreed).text.includes('\nWorker: Main'))

  assert.equal(checkDesign({ ...send, worker: null, minutes: null, where: 'backlog' }, agreed).text.endsWith('Worker: Game - Main decides'), true)
  assert.equal(checkDesign({ ...send, worker: 'Main' }, agreed).status, 400)
  assert.equal(checkDesign({ ...send, worker: 'Nobody' }, agreed).status, 400)
  assert.equal(checkDesign({ ...send, where: 'bin' }, agreed).status, 400)
  assert.equal(checkDesign({ ...send, title: ' ' }, agreed).status, 400)
  assert.equal(checkDesign({ ...send, title: 'x'.repeat(LIMITS.title + 1) }, agreed).status, 413)
  assert.equal(checkDesign({ ...send, minutes: 2.5 }, agreed).status, 400)
  assert.equal(checkDesign({ ...send, requirements: Array.from({ length: 13 }, () => 'x') }, agreed).status, 400)
  // Not before the person agreed, not twice, and not on a board that cannot ask the main chat.
  assert.equal(checkDesign(send, design([idea()])).status, 409)
  assert.equal(checkDesign(send, design([idea({ agreed: 1, sent: { at: NOW, where: 'queue', message: 'm1', state: 'waiting' } })])).status, 409)
  assert.deepEqual(checkDesign(send, design([idea({ agreed: 1 })], { canSend: false, whyNot: 'This board only shows.' })), { ok: false, status: 409, why: 'This board only shows.' })
  assert.equal(checkDesign(send, design([idea({ agreed: 1 })], { main: null })).status, 409)
})

test('the ideas with what was done to them, kept and there again after a new start', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-ideas-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'data', 'ideas.json')
  const ideas = await ideasFile(file)
  const made = await ideas.add({ id: 'i1', kind: 'screen', text: 'A shop screen', references: [], now: NOW })
  assert.deepEqual([made.name, made.folder, made.versions[0].state], ['a-shop-screen', 'art-inbox/ideas/a-shop-screen', 'making'])
  await ideas.finish('i1', 1, { picture: 'art-inbox/ideas/a-shop-screen/v1.png', seconds: 51 })
  await ideas.agree('i1', 1)
  const second = await ideas.again('i1', { change: 'Bigger buttons', from: 1, now: NOW + MIN })
  // A new version is looked at anew.
  assert.deepEqual([second.n, ideas.all()[0].agreed], [2, null])
  // The same words give a second idea a folder of its own.
  assert.equal((await ideas.add({ id: 'i2', kind: 'screen', text: 'A shop screen', references: [], now: NOW })).name, 'a-shop-screen-2')

  // The board is started anew while version 2 is being made.
  const again = await ideasFile(file)
  const [first] = again.all()
  assert.deepEqual(first.versions.map(one => [one.n, one.state]), [[1, 'done'], [2, 'failed']])
  assert.match(first.versions[1].why, /started anew/)
  assert.equal(first.versions[0].picture, 'art-inbox/ideas/a-shop-screen/v1.png')
  await again.send('i1', { at: NOW, where: 'backlog', worker: null, title: 'Shop', message: 'm1' })
  await again.drop('i2', NOW)
  assert.deepEqual((await ideasFile(file)).all().map(one => [one.id, one.sent?.message ?? null, one.droppedAt]), [['i1', 'm1', null], ['i2', null, NOW]])
  // A finish for a version that is not being made changes nothing.
  await again.finish('i1', 1, { why: 'late' })
  assert.equal(again.all()[0].versions[0].state, 'done')
  assert.deepEqual(parseIdeas('not json'), [])
  assert.deepEqual(parseIdeas('{"ideas":[{"id":7}]}'), [])
})

test('what the page draws from: each idea with where it stands', () => {
  const settings = { kinds, seconds: 240, codex: '' }
  const state = (ideas, more = {}) => designState({ ideas, settings, canMake: true, why: 'x', busy: null, ...more })
  const statusOf = (one, more) => state([one], more).ideas[0].status
  assert.equal(statusOf(idea({ versions: [version(1), version(2, 'making')] })), 'making')
  assert.equal(statusOf(idea()), 'look')
  assert.equal(statusOf(idea({ versions: [version(1, 'failed')] })), 'failed')
  assert.equal(statusOf(idea({ agreed: 1 })), 'agreed')

  const sent = idea({ agreed: 1, sent: { at: NOW, where: 'queue', worker: 'Units', title: 'Shop', message: 'm1' } })
  const asked = state([sent], { outbox: [{ id: 'm1', state: 'taken' }] }).ideas[0]
  assert.deepEqual([asked.status, asked.sent.state, asked.sent.step], ['asked', 'taken', null])
  // The main chat wrote the step and kept the folder in its words: the idea shows its id.
  const backlog = [{ name: 'Screens', steps: [
    { id: 'B90', text: 'Another idea (pictures in art-inbox/ideas/shop-screen-2)', worker: 'Units', status: 'queued', notes: [] },
    { id: 'B103', text: 'Shop screen (pictures in art-inbox/ideas/shop-screen)', worker: null, status: 'open', notes: [] },
  ] }]
  const found = state([sent], { backlog }).ideas[0]
  assert.deepEqual([found.status, found.sent.step, found.sent.state], ['backlog', { id: 'B103', worker: null, isDone: false }, 'delivered'])
  const queued = state([sent], { backlog: [{ name: 'x', steps: [{ id: 'B104', text: 'Shop', worker: 'Units', status: 'queued', notes: [{ title: 'Context', lines: ['pictures in art-inbox/ideas/shop-screen'], points: [] }] }] }] }).ideas[0]
  assert.deepEqual([queued.status, queued.sent.step.id], ['queued', 'B104'])
  // A word that did not arrive leaves the idea agreed, to be asked again.
  assert.equal(state([sent], { outbox: [{ id: 'm1', state: 'expired' }] }).ideas[0].status, 'agreed')

  const whole = state([idea({ droppedAt: NOW }), idea({ id: 'i2', name: 'slime', createdAt: NOW }), idea({ id: 'i3', name: 'older', createdAt: NOW - 60 * MIN })], { missing: ['art-inbox/camera/map.png'], canMake: false, why: 'No Codex.' })
  assert.deepEqual(whole.ideas.map(one => one.id), ['i2', 'i3'])
  assert.deepEqual([whole.canMake, whole.why, whole.busy, whole.seconds], [false, 'No Codex.', null, 60])
  assert.deepEqual(whole.kinds, [{ id: 'screen', name: 'Game screen', missing: ['art-inbox/camera/map.png'] }, { id: 'board', name: 'Worker board', missing: [] }])
  assert.equal(state([]).why, null)
})

test('a reference picture is known by how its bytes begin, not by what it is called', () => {
  assert.equal(pictureKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png')
  assert.equal(pictureKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'jpg')
  assert.equal(pictureKind(Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')])), 'webp')
  assert.equal(pictureKind(Buffer.from('<svg onload="x">')), null)
  assert.equal(pictureKind(Buffer.from('MZ this is a program')), null)
  assert.equal(pictureKind(Buffer.alloc(0)), null)
})

test('ideasOver keeps ideas without a file, as the demo does', async () => {
  const ideas = ideasOver([idea()])
  await ideas.agree('i1', 1)
  assert.equal(ideas.all()[0].agreed, 1)
})
