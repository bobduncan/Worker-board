import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { LIMITS, checkDesign, designState, inTurn, parseDesignSettings, promptFor, shortName, stepWord } from '../src/design.mjs'
import { ideasFile, ideasOver, parseIdeas, placeReferences } from '../src/ideas.mjs'
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
const design = (ideas, more = {}) => ({ ideas, kinds, pictures: 'art-inbox', canMake: true, why: null, busy: null, canSend: true, main: 'Main', workers: ['Units', 'Features'], ...more })

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

test('B133: the example kinds name no project, and the demo has its made-up four', async () => {
  const example = parseDesignSettings(await readFile(join(HERE, '..', 'examples', 'design.json'), 'utf8'))
  assert.deepEqual(example.kinds.map(kind => [kind.id, kind.name, kind.references.length]), [['screen', 'Screen', 0], ['art', 'Art', 0]])
  assert.ok(example.kinds.every(kind => kind.opening.length > 80))
  const settings = parseDesignSettings(await readFile(join(HERE, '..', 'fixtures', 'demo-design.json'), 'utf8'))
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
    'Worker: you decide',
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
  // The same picture twice is one reference (B156: it is moved into the idea's folder once).
  assert.deepEqual(check({ action: 'make', kind: 'board', text: 'x', references: [ref, ref] }).references, [ref])
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

  assert.equal(checkDesign({ ...send, worker: null, minutes: null, where: 'backlog' }, agreed).text.endsWith('Worker: you decide'), true)
  assert.equal(checkDesign({ ...send, worker: 'Main' }, agreed).status, 400)
  assert.equal(checkDesign({ ...send, worker: 'Nobody' }, agreed).status, 400)
  assert.equal(checkDesign({ ...send, where: 'bin' }, agreed).status, 400)
  assert.equal(checkDesign({ ...send, title: ' ' }, agreed).status, 400)
  assert.equal(checkDesign({ ...send, title: 'x'.repeat(LIMITS.title + 1) }, agreed).status, 413)
  assert.equal(checkDesign({ ...send, minutes: 2.5 }, agreed).status, 400)
  assert.equal(checkDesign({ ...send, requirements: Array.from({ length: 13 }, () => 'x') }, agreed).status, 400)
  // Not twice, and not on a board that cannot ask the main chat.
  assert.equal(checkDesign(send, design([idea({ agreed: 1, sent: { at: NOW, where: 'queue', message: 'm1', state: 'waiting' } })])).status, 409)
  assert.deepEqual(checkDesign(send, design([idea({ agreed: 1 })], { canSend: false, whyNot: 'This board only shows.' })), { ok: false, status: 409, why: 'This board only shows.' })
  assert.equal(checkDesign(send, design([idea({ agreed: 1 })], { main: null })).status, 409)
})

test('the ideas with what was done to them, kept and there again after a new start', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-ideas-test-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const file = join(dir, 'data', 'ideas.json')
  const ideas = await ideasFile(file, { pictures: 'art-inbox' })
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

test('a word to the main chat that did not arrive leaves the idea free: it can be changed, agreed to and sent again', () => {
  const lost = state => design([idea({ agreed: 1, sent: { at: NOW, where: 'queue', worker: null, title: 'Shop', message: 'm1', state } })])
  const send = { action: 'send', idea: 'i1', where: 'backlog', title: 'Shop' }
  for (const state of ['expired', 'failed']) {
    assert.equal(checkDesign(send, lost(state)).ok, true, state)
    assert.equal(checkDesign({ action: 'again', idea: 'i1', change: 'x' }, lost(state)).ok, true, state)
    assert.equal(checkDesign({ action: 'agree', idea: 'i1', version: 1 }, lost(state)).ok, true, state)
  }
  for (const state of ['waiting', 'taken', 'delivered']) {
    assert.equal(checkDesign(send, lost(state)).status, 409, state)
    assert.equal(checkDesign({ action: 'again', idea: 'i1', change: 'x' }, lost(state)).status, 409, state)
  }
})

test('the step asked of the main chat is never longer than a chat is typed: the fields together have a limit', () => {
  const agreed = design([idea({ agreed: 1 })], { maxChars: 2500 })
  const long = { action: 'send', idea: 'i1', where: 'backlog', title: 'x'.repeat(160), description: 'y'.repeat(1200), requirements: Array.from({ length: 12 }, () => 'z'.repeat(200)) }
  const refused = checkDesign(long, agreed)
  assert.equal(refused.status, 413)
  assert.match(refused.why, /2500/)
  assert.equal(checkDesign({ ...long, requirements: ['short'] }, agreed).ok, true)
})

test('a worker\'s name is one plain line in the step', () => {
  assert.ok(stepWord({ where: 'queue', title: 'x', kind: 'level', description: '', requirements: [], folder: 'f', picture: null, worker: 'Levels /\n Environment', minutes: null }).endsWith('\nWorker: Levels / Environment'))
})

test('the Design tab\'s calls are worked off one after the other, so two clicks never start two pictures', async () => {
  const turn = inTurn()
  const order = []
  const work = (name, ms) => turn(async () => {
    order.push(`${name} starts`)
    await new Promise(done => setTimeout(done, ms))
    order.push(`${name} ends`)
    return name
  })
  const results = await Promise.all([work('first', 30), work('second', 1), turn(async () => { throw new Error('third fails') }).catch(error => error.message), work('fourth', 1)])
  assert.deepEqual(order, ['first starts', 'first ends', 'second starts', 'second ends', 'fourth starts', 'fourth ends'])
  assert.deepEqual(results, ['first', 'second', 'third fails', 'fourth'])
})

test('an ideas file that was changed by hand cannot name a folder or a picture outside the ideas folder', () => {
  const text = JSON.stringify({ ideas: [
    { id: 'ok', name: 'shop', kind: 'screen', text: 'A shop', createdAt: 1, folder: 'art-inbox/ideas/shop', references: ['art-inbox/ideas/_references/0123456789abcdef.png', '../../secret.png'], versions: [
      { n: 1, at: 1, state: 'done', picture: 'art-inbox/ideas/shop/v1.png' },
      { n: 2, at: 2, state: 'done', picture: '../../windows/system.png' },
      { n: 'x', at: 3, state: 'done', picture: 'art-inbox/ideas/shop/v3.png' },
    ] },
    { id: 'out', name: 'out', kind: 'screen', text: 'x', createdAt: 1, folder: '../../elsewhere', versions: [] },
    { id: 'none', name: 'none', kind: 'screen', text: 'x', createdAt: 1, versions: [] },
  ] })
  const ideas = parseIdeas(text)
  assert.deepEqual(ideas.map(one => one.id), ['ok'])
  assert.deepEqual(ideas[0].references, ['art-inbox/ideas/_references/0123456789abcdef.png'])
  // A version whose picture is not its own file in the idea's folder counts as failed; one without a number is gone.
  assert.deepEqual(ideas[0].versions.map(one => [one.n, one.state, one.picture]), [[1, 'done', 'art-inbox/ideas/shop/v1.png'], [2, 'failed', null]])
  // And the page's state is built from it without a throw.
  assert.equal(designState({ ideas, settings: { kinds, seconds: 240, codex: '' }, canMake: true, why: null, busy: null }).ideas.length, 1)
})

test('an idea that cannot be kept is not left "being made", and its folder is one no other board uses', async () => {
  let fails = true
  const ideas = ideasOver([], async () => {
    if (fails) throw new Error('disk full')
  }, { pictures: 'art-inbox' })
  await assert.rejects(ideas.add({ id: 'i1', kind: 'screen', text: 'A shop screen', references: [], now: NOW }))
  assert.deepEqual(ideas.all().map(one => one.versions[0].state), ['failed'])
  fails = false
  // Folders that are there already, from this board or a copy of it, are not written into.
  const second = await ideas.add({ id: 'i2', kind: 'screen', text: 'A shop screen', references: [], now: NOW, taken: ['a-shop-screen-2', 'unrelated'] })
  assert.equal(second.name, 'a-shop-screen-3')
})

test('the page is told before a click whether this board can ask the main chat, and reads every limit from the state', () => {
  const settings = { kinds, seconds: 240, codex: '' }
  const here = designState({ ideas: [], settings, canMake: true, why: null, busy: null, canSend: true, whyNot: 'x' })
  assert.deepEqual([here.canSend, here.whyNot], [true, null])
  const copy = designState({ ideas: [], settings, canMake: true, why: null, busy: null, canSend: false, whyNot: 'This board only shows.' })
  assert.deepEqual([copy.canSend, copy.whyNot], [false, 'This board only shows.'])
  assert.deepEqual(here.limits, { idea: 1500, text: 1500, change: 600, title: 160, description: 1200, requirement: 200, requirements: 12, references: 3, referenceBytes: 8 * 1024 * 1024 })
})

test('B156: an idea\'s reference pictures move into its own folder under plain names; one that cannot move stays', async t => {
  const project = await mkdtemp(join(tmpdir(), 'board-references-test-'))
  t.after(() => rm(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const picked = 'art-inbox/ideas/_references/0123456789abcdef.png'
  const pasted = 'art-inbox/ideas/_references/fedcba9876543210.webp'
  const gone = 'art-inbox/ideas/_references/00000000000000aa.jpg'
  await mkdir(join(project, 'art-inbox', 'ideas', '_references'), { recursive: true })
  await writeFile(join(project, ...picked.split('/')), 'a made-up picture')
  await writeFile(join(project, ...pasted.split('/')), 'another made-up picture')

  const placed = await placeReferences(project, [picked, pasted, gone], 'art-inbox/ideas/a-shop-screen')
  assert.deepEqual(placed, ['art-inbox/ideas/a-shop-screen/reference-1.png', 'art-inbox/ideas/a-shop-screen/reference-2.webp', gone])
  assert.equal(await readFile(join(project, 'art-inbox', 'ideas', 'a-shop-screen', 'reference-2.webp'), 'utf8'), 'another made-up picture')
  await assert.rejects(stat(join(project, ...picked.split('/'))))

  // A new idea keeps them where they were placed; without a place they stay where the page put them.
  const ideas = ideasOver([], undefined, { pictures: 'art-inbox' })
  const made = await ideas.add({ id: 'i1', kind: 'screen', text: 'A shop screen', references: [picked], now: NOW, place: async (paths, folder) => paths.map((_, n) => `${folder}/reference-${n + 1}.png`) })
  assert.deepEqual(made.references, ['art-inbox/ideas/a-shop-screen/reference-1.png'])
  assert.deepEqual((await ideas.add({ id: 'i2', kind: 'screen', text: 'A road', references: [picked], now: NOW })).references, [picked])
  // A place that fails leaves them where they were, and the idea is made all the same.
  assert.deepEqual((await ideas.add({ id: 'i3', kind: 'screen', text: 'A bridge', references: [picked], now: NOW, place: async () => { throw new Error('no disk') } })).references, [picked])
})

test('B156: a hand-changed ideas file keeps only references in the idea\'s own folder or where the page puts them', () => {
  const text = JSON.stringify({ ideas: [{ id: 'ok', name: 'shop', kind: 'screen', text: 'A shop', createdAt: 1, folder: 'art-inbox/ideas/shop', versions: [], references: [
    'art-inbox/ideas/shop/reference-1.png', 'art-inbox/ideas/_references/0123456789abcdef.png', 'art-inbox/ideas/other/reference-1.png',
    'art-inbox/ideas/shop/v1.png', 'art-inbox/ideas/shop/reference-1.png/../../../secret.png', 'art-inbox/ideas/shop/reference-12.png',
  ] }] })
  assert.deepEqual(parseIdeas(text)[0].references, ['art-inbox/ideas/shop/reference-1.png', 'art-inbox/ideas/_references/0123456789abcdef.png'])
})

test('B198: new ideas go into the project\'s picture folder; ideas saved in another stay readable; an upload counts only in the folder now set', async () => {
  const { ideasFolder, isUploadedReference, referencesFolder } = await import('../src/design.mjs')
  assert.deepEqual([ideasFolder('shots'), referencesFolder('shots')], ['shots/ideas', 'shots/ideas/_references'])
  const made = await ideasOver([], undefined, { pictures: 'shots' }).add({ id: 'i1', kind: 'screen', text: 'A shop screen', references: [], now: NOW })
  assert.equal(made.folder, 'shots/ideas/a-shop-screen')
  await assert.rejects(ideasOver([]).add({ id: 'i2', kind: 'screen', text: 'A map', references: [], now: NOW }), /no picture folder/)
  const saved = JSON.stringify({ ideas: [{ id: 'old', name: 'map', kind: 'level', text: 'A map', createdAt: 1, folder: 'old-pictures/ideas/map', references: ['old-pictures/ideas/_references/0123456789abcdef.png'], versions: [] }] })
  assert.deepEqual(parseIdeas(saved).map(one => [one.folder, one.references]), [['old-pictures/ideas/map', ['old-pictures/ideas/_references/0123456789abcdef.png']]])
  assert.equal(isUploadedReference('shots/ideas/_references/0123456789abcdef.png', 'shots'), true)
  assert.equal(isUploadedReference('old-pictures/ideas/_references/0123456789abcdef.png', 'shots'), false)
  assert.equal(isUploadedReference('shots/ideas/_references/../x.png', 'shots'), false)
})

test("B368, B379: a step without a picture is a New idea's: no idea, no pictures line; an idea needs its agreed picture", () => {
  const send = { action: 'send', where: 'backlog', title: 'Sort the backlog', description: 'Oldest first.', requirements: ['Newest on top'], worker: null, minutes: 30 }
  const bare = checkDesign(send, design([]))
  assert.deepEqual([bare.ok, bare.idea], [true, null])
  assert.equal(bare.text, 'backlog step from the Design tab\nTitle: Sort the backlog\nDescription: Oldest first.\nRequirements:\n- Newest on top\nWorker: you decide\nTime: about 30 min')
  assert.equal(checkDesign({ ...send, idea: null }, design([])).ok, true)
  // B379: an idea is as before: not before its picture is agreed, so a step from it always names its picture.
  assert.deepEqual(checkDesign({ ...send, idea: 'i1' }, design([idea()])), { ok: false, status: 409, why: 'Agree to a picture first, or choose New idea for a step without one.' })
  // With an agreed picture it is as before.
  assert.match(checkDesign({ ...send, idea: 'i1' }, design([idea({ agreed: 1 })])).text, /\nPictures: art-inbox\/ideas\/shop-screen \(agreed: v1\.png\)\n/)
  // An idea named that is not there is still refused, and so is a step on a board that cannot ask.
  assert.equal(checkDesign({ ...send, idea: 'gone' }, design([])).status, 409)
  assert.equal(checkDesign(send, design([], { canSend: false, whyNot: 'This board only shows.' })).status, 409)
  assert.equal(checkDesign({ ...send, title: ' ' }, design([])).status, 400)
})
