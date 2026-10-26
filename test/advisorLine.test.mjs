// The person, 2026-10-26: the Advisor's line shows all the work waiting for it (result checks, refines, the questions it
// answers first), each with where it stands and a link; its task line starts with the item it is on (X76, B701, Q423) the
// way a worker's line does, its own card text and step count in the tooltip; and on the Backlog a step in review reads as
// built by its worker and waiting for its check, not as its builder at work ("it says worker 4 is doing something").
// The page only words what the server worked out (test/advisorWork.test.mjs). Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const css = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
/** The source of a top-level function, by its name. */
function source(name) {
  const start = script.search(new RegExp(`^(async )?function ${name}[(]`, 'm'))
  assert.ok(start >= 0, `${name} is not in board.js`)
  const lines = script.slice(start).split('\n')
  const end = lines.findIndex((line, index) => index > 0 && line.startsWith('}'))
  return lines.slice(0, end + 1).join('\n')
}
const constant = name => {
  const from = script.indexOf(`const ${name} = `)
  assert.ok(from >= 0, `board.js has no const ${name}`)
  return script.slice(from, script.indexOf('\n', from) + 1)
}

class Node {
  constructor(tag) {
    Object.assign(this, { tag, tagName: tag.toUpperCase(), className: '', textContent: '', children: [], dataset: {}, attrs: {}, disabled: false, title: '', type: '', value: '', id: '', hidden: false, href: '' })
    this.classList = { add: name => { this.className = `${this.className} ${name}`.trim() } }
  }
  append(...items) { for (const one of items) this.children.push(typeof one === 'string' ? { tag: '#text', textContent: one, children: [], dataset: {}, attrs: {}, className: '' } : one) }
  setAttribute(name, value) { this.attrs[name] = value }
  addEventListener() {}
}
const words = node => (node.textContent ?? '') + (node.children ?? []).map(words).join('')
const all = (node, test) => [...(test(node) ? [node] : []), ...(node.children ?? []).flatMap(one => all(one, test))]
const plain = value => JSON.parse(JSON.stringify(value))
const at = (hour, minute) => new Date(2026, 9, 26, hour, minute).getTime()

const page = { document: { createElement: tag => new Node(tag) }, problems: new Map(), sending: new Set() }
vm.runInNewContext([
  'const MIN = 60000', cut('times'), cut('askstand'), cut('advisorlane'), cut('coordinate'), source('el'), source('fixChip'), constant('BLOCK_EMPTY'), source('drawBlock'), source('blockChip'), source('blockLine'), source('queueButton'), source('editPart'),
  'Object.assign(this, { advisorQueued, drawWaitingAsks, advisorOnLine, checkStandWords, coordinateList, backlogBlocks, blockLine })',
].join('\n'), page)

const queued = { kind: 'queued', since: at(16, 14) }
const working = { kind: 'working', since: at(16, 20) }
const LIST = [
  { kind: 'check', id: 'B701', title: 'Show the damage', who: 'Worker 4', stand: queued },
  { kind: 'refine', id: 'B703', title: 'The Ranger as a pick', who: null, stand: working },
  { kind: 'question', id: 'Q423', title: 'Merge the chain?', who: 'Worker 1', stand: { kind: 'queued', since: at(16, 10), toYouAt: at(16, 40) } },
]

test('what waits for it: result checks, refines and questions, counted by kind, each a link to its step or ask with its stand in words', () => {
  const view = plain(page.advisorQueued({ refines: 0, rounds: 1, words: 2 }, LIST))
  assert.equal(view.count, 6)
  assert.equal(view.text, '1 question, 1 result check, 1 refine, 1 round of the clock, 2 messages')
  assert.deepEqual(view.asks.map(one => [one.id, one.href, one.text, one.stand]), [
    ['B701', '#details=B701', 'check B701 (built by Worker 4): Show the damage', 'in the Advisor\'s queue since 16:14'],
    ['B703', '#details=B703', 'refine B703: The Ranger as a pick', 'the Advisor is on it since 16:20'],
    ['Q423', '#details=Q423', 'Q423 · Worker 1: Merge the chain?', 'in the Advisor\'s queue since 16:10 · comes to you at 16:40'],
  ])
  // Plural kinds; the refines of the list are the refines (not counted again from the words that wait).
  const many = plain(page.advisorQueued({ refines: 2, rounds: 0, words: 0 }, [LIST[0], { ...LIST[0], id: 'B702' }, LIST[1], { ...LIST[1], id: 'B704' }]))
  assert.equal(many.text, '2 result checks, 2 refines')
  // A check whose builder is not known names no builder.
  assert.equal(plain(page.advisorQueued(undefined, [{ ...LIST[0], who: null }])).asks[0].text, 'check B701: Show the damage')
  // Nothing waits: nothing to show.
  assert.equal(page.advisorQueued({ refines: 0, rounds: 0, words: 0 }, []), null)
})

test('"Waiting for it": a link for each, then where it stands, on its own quiet line', () => {
  const view = page.advisorQueued({ refines: 0, rounds: 0, words: 0 }, LIST)
  const line = page.drawWaitingAsks(view.asks)
  assert.match(words(line), /^Waiting for it: /)
  const rows = all(line, node => node.className.includes('advisor-lane-ask-row'))
  assert.deepEqual(rows.map(words), [
    'check B701 (built by Worker 4): Show the damagein the Advisor\'s queue since 16:14',
    'refine B703: The Ranger as a pickthe Advisor is on it since 16:20',
    'Q423 · Worker 1: Merge the chain?in the Advisor\'s queue since 16:10 · comes to you at 16:40',
  ])
  assert.deepEqual(all(line, node => node.tag === 'a').map(node => node.href), ['#details=B701', '#details=B703', '#details=Q423'])
})

test('its task line starts with the item it is on, as a link: B701, Q423; an incident links to the supervisor; the card text and step count go to the tooltip', () => {
  const lane = { task: { text: 'Checks, then incident X76', step: 2, steps: 4, names: ['Incident X76', 'Check B701', 'Write', 'Done'] } }
  const line = page.advisorOnLine({ kind: 'check', id: 'B701', title: 'Show the damage', since: at(16, 20) }, lane)
  const link = all(line, node => node.tag === 'a')[0]
  assert.equal(link.textContent, 'B701')
  assert.equal(link.href, '#details=B701')
  assert.match(link.className, /task-code/)
  assert.equal(words(line), 'B701 Show the damage')
  assert.match(line.className, /clip/)
  assert.match(line.title, /B701 Show the damage/)
  assert.match(line.title, /Its own card: Checks, then incident X76/)
  assert.match(line.title, /Step 2 of 4: Check B701/)
  const incident = page.advisorOnLine({ kind: 'incident', id: 'X76', title: 'A card left on the wrong lane', since: at(16, 20) }, lane)
  assert.equal(all(incident, node => node.tag === 'a')[0].href, '#supervisor')
  assert.equal(words(incident), 'X76 A card left on the wrong lane')
  // Without a card (its task not recorded): the line still names the item, with nothing about a card.
  const bare = page.advisorOnLine({ kind: 'question', id: 'Q423', title: 'Merge the chain?', since: at(16, 20) }, { task: null })
  assert.equal(words(bare), 'Q423 Merge the chain?')
  assert.ok(!/Its own card/.test(bare.title))
})

test('the Advisor\'s card draws it: the item it is on in place of its card text, no step bar, the waiting list from the server', () => {
  const lane = source('drawAdvisorLane')
  assert.match(lane, /const on = advisor\.on \?\? null/)
  assert.match(lane, /advisorOnLine\(on, lane\)/)
  assert.match(lane, /advisorProgress\(on === null \? lane\.task : null\)/)
  assert.match(lane, /advisorQueued\(advisor\.queued, advisor\.waiting \?\? \(state\.withPartner \?\? \[\]\)\)/)
  // Today's line stays when it names no item.
  assert.match(lane, /taskTitle\(lane\)/)
})

test('the Backlog: a step in review is built by its worker, and says whom it waits for: the Advisor\'s queue, or the Advisor checking it', () => {
  const list = (steps) => ({ groups: [{ name: 'Work', steps }] })
  const review = (id, more = {}) => ({ key: id, id, title: `Title of ${id}`, status: 'open', item: { state: 'review', owner: 'Worker 4', goal: null, pinned: null, queuedBy: null }, ...more })
  const blocks = steps => plain(page.backlogBlocks(list(steps), null)).find(block => block.key === 'progress').rows
  const rows = blocks([
    review('B701', { reviewWait: 'waits for its first check', reviewStand: queued }),
    review('B702', { reviewWait: 'waits for its first check', reviewStand: working }),
    review('B703', { reviewWait: 'waits for its fix B710' }),
    { key: 'B704', id: 'B704', title: 'Working', status: 'progress', item: { state: 'in progress', owner: 'Worker 2', goal: null, pinned: null, queuedBy: null } },
  ])
  const byId = Object.fromEntries(rows.map(row => [row.step.id, row]))
  assert.deepEqual([byId.B701.who, byId.B701.state, byId.B701.tone], ['built by Worker 4', 'waits for its check: in the Advisor\'s queue since 16:14', 'review'])
  assert.deepEqual([byId.B702.who, byId.B702.state], ['built by Worker 4', 'the Advisor is checking it since 16:20'])
  // Waiting for its fix, as today: "In review", the fix in its title.
  assert.deepEqual([byId.B703.who, byId.B703.state], ['built by Worker 4', 'In review'])
  // A step at work keeps its worker as it is.
  assert.deepEqual([byId.B704.who, byId.B704.state], ['Worker 2', 'In progress'])
  // The words alone, and none for what the server did not say.
  assert.equal(page.checkStandWords(queued), 'waits for its check: in the Advisor\'s queue since 16:14')
  assert.equal(page.checkStandWords({ kind: 'working', since: null }), 'the Advisor is checking it')
  assert.equal(page.checkStandWords({ kind: 'taken', since: at(16, 20) }), 'waits for its check: the Advisor took it at 16:20, idle now')
  assert.equal(page.checkStandWords(null), null)
  assert.equal(page.checkStandWords(undefined), null)
  // The row: the state cell says it, and the title does not say it a second time.
  const line = page.blockLine(rows.find(row => row.step.id === 'B701'), 'progress')
  const text = words(line)
  assert.ok(text.includes('built by Worker 4'))
  assert.ok(text.includes('waits for its check: in the Advisor\'s queue since 16:14'))
  assert.ok(!text.includes('(waits for its first check)'))
  const fix = page.blockLine(rows.find(row => row.step.id === 'B703'), 'progress')
  assert.ok(words(fix).includes('(waits for its fix B710)'), 'a wait for a fix stays in the title')
})

test('quiet colours: the Advisor\'s item line and the stands use no colour of attention', () => {
  const rules = css.split('}').filter(rule => /advisor-on|advisor-lane-ask-stand|block-who/.test(rule))
  assert.ok(rules.length >= 1)
  for (const rule of rules) assert.doesNotMatch(rule, /amber|gold|orange|--warn|--bad|--attention|--waiting/i)
})
