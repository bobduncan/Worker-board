import { describe, expect, mock, test } from 'claude-code/testing'
import type { FsEntry, On } from 'claude-code'

import type { FolderRow } from '../types'
import { SELF, branchList, branchName, byName, detached, folderName, inFolder, isListed, ordered, summary } from './folders'

describe('the parts that need no engine', () => {
  test('paths keep the separator of the folder they are in', () => {
    expect(inFolder('D:\\Work\\project', 'game')).toBe('D:\\Work\\project\\game')
    expect(inFolder('D:\\Work\\project\\', '.git')).toBe('D:\\Work\\project\\.git')
    expect(inFolder('/home/me/app/', 'src')).toBe('/home/me/app/src')
    expect(folderName('D:\\Work\\project\\')).toBe('project')
    expect(folderName('/home/me/app')).toBe('app')
    expect(folderName('/')).toBe('/')
  })

  test('reads what git prints', () => {
    expect(branchName('look/shape\n')).toBe('look/shape')
    expect(branchName('\n')).toBeNull()
    expect(detached('abc1234\n')).toBe('(none, at commit abc1234)')
    expect(detached(null)).toBe('(none)')
    expect(branchList('feature/pillar\r\nlook/shape\nmain\n\n')).toEqual(['feature/pillar', 'look/shape', 'main'])
    expect(branchList('')).toEqual([])
  })

  test('lists the folder itself first, then the folders in git, then the others, each by name', () => {
    const row = (id: string, branch: string | null): FolderRow => ({ id, name: id === SELF ? 'app (this folder)' : id, branch, branches: [] })
    const rows = [row('zeta', null), row('Beta', 'main'), row('alpha', null), row(SELF, 'main'), row('art', 'look/x')]
    expect(ordered(rows).map(r => r.id)).toEqual([SELF, 'art', 'Beta', 'alpha', 'zeta'])
    expect(['b', 'A', 'a', 'C'].sort(byName)).toEqual(['A', 'a', 'b', 'C'])
    expect(isListed('.claude')).toBe(false)
    expect(isListed('art-inbox')).toBe(true)
    expect(summary(ordered(rows))).toBe('app (this folder): main\nart: look/x\nBeta: main\nalpha: no git\nzeta: no git')
    expect(summary([])).toBe('This folder holds no folders.')
  })
})

/** A path as a hook is handed it, with forward slashes: on Windows it arrives with backslashes. */
const slashed = (path: string): string => path.replaceAll('\\', '/')

const dir = (name: string): FsEntry => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })
const file = (name: string): FsEntry => ({ name, kind: 'file', size: 10, mtimeMs: 1, isLink: false })
const link = (name: string): FsEntry => ({ name, kind: 'other', size: 0, mtimeMs: 0, isLink: true })

/** A git checkout as the test's hooks answer for it: null as the branch is a detached HEAD. */
type Repo = { branch: string | null; branches: string[]; isBroken?: boolean }

/** What the test's hooks answer from: the folder the session is in, its entries, and the checkouts by folder. */
type World = {
  root: string
  entries: FsEntry[]
  repos: Record<string, Repo>
  /** The git questions asked, each as its folder and arguments. */
  asked: string[]
  /** The panes opened, each as `id:title`. */
  opened: string[]
  listError?: string
}

/** The checkout whose own folder a path names; a POSIX path arrives on Windows with a drive before it. */
function repoAt(world: World, folder: string): Repo | undefined {
  const key = Object.keys(world.repos).find(known => slashed(folder).endsWith(known))
  return key === undefined ? undefined : world.repos[key]
}

/** The engine beneath the mod: a folder tree and git, answered from `world`. */
function stand(on: On, world: World): void {
  on('session.root', () => ({ value: world.root }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => {
    world.opened.push(`${e.id}:${e.title}`)

    return { value: { isPlaced: true } }
  })
  on('fs.list', (_$, e) => {
    if (world.listError !== undefined) return { deny: world.listError }

    return slashed(e.path).endsWith(slashed(world.root)) ? { value: world.entries } : { deny: 'no such folder' }
  })
  on('fs.exists', (_$, e) => {
    const path = slashed(e.path)

    return { value: path.endsWith('/.git') && repoAt(world, path.slice(0, -'/.git'.length)) !== undefined }
  })
  // A link leads to a folder, but for the one named "dangling".
  on('fs.stat', (_$, e) => (
    e.path.endsWith('dangling') ? { deny: 'ENOENT' } : { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: true } }
  ))
  on('process.run', (_$, e) => {
    const done = (exitCode: number, stdout: string) => (
      { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    )
    const repo = repoAt(world, e.argv[2] ?? '')
    world.asked.push(e.argv.slice(2).map(slashed).join(' '))
    if (e.argv[0] !== 'git' || e.argv[1] !== '-C' || repo === undefined || repo.isBroken === true) return done(128, '')
    if (e.argv[3] === 'branch') return done(0, `${repo.branch ?? ''}\n`)
    if (e.argv[3] === 'rev-parse') return done(0, 'abc1234\n')
    if (e.argv[3] === 'for-each-ref') return done(0, repo.branches.map(b => `${b}\n`).join(''))

    return done(1, '')
  })
}

/** The side pane as a surface draws it. */
const PANE = {
  component: 'Pane',
  requestId: 'folder-branches',
  props: { title: 'Git', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const BRANCHES = ['feature/pillar', 'feature/sound-board', 'look/shape', 'main']

/** A project folder that holds two checkouts of one repository and folders that are not in git. */
function project(): World {
  return {
    root: 'D:\\Work\\project',
    entries: [
      dir('sound-library'), dir('.claude'), file('board.md'), dir('game-sound'), link('linked'), link('dangling'),
      dir('art-inbox'), dir('game'),
    ],
    repos: {
      'D:/Work/project/game': { branch: 'look/shape', branches: BRANCHES },
      'D:/Work/project/game-sound': { branch: 'feature/sound-board', branches: BRANCHES },
    },
    asked: [],
    opened: [],
  }
}

const START = { surface: 'desktop', isInteractive: true } as const
const ASKED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

describe('the Git pane', () => {
  test('lists each folder with its branch or "no git", and unfolds a folder to its local branches', async ($, on) => {
    mock.clock(on)
    const world = project()
    stand(on, world)
    await $.session.start({ cwd: world.root, ...START })

    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: 'folder-branches', surface, ...PANE })
      // The folders in git, folded; the others say "no git"; a file, a dot folder and a dead link are not listed.
      expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual([
        '▸ game · look/shape', '▸ game-sound · feature/sound-board',
      ])
      for (const name of ['art-inbox', 'linked', 'sound-library']) {
        expect(await ui.find({ type: 'Text', text: `${name} · no git` })).toBeDefined()
      }
      for (const name of ['.claude', 'board.md', 'dangling']) {
        expect(await ui.find({ type: 'Text', text: new RegExp(name.replace('.', '\\.')) })).toBeUndefined()
      }
      expect(await ui.find({ type: 'Text', text: /main/ })).toBeUndefined()
      await ui.unmount()
    }

    const ui = await $.ui.mount({ plugin: 'folder-branches', surface: 'desktop', ...PANE })
    await ui.press({ key: 'folder:game' })
    expect((await ui.find({ key: 'folder:game' }))?.text).toBe('▾ game · look/shape')
    // Every local branch, the one checked out marked.
    for (const shown of ['○ feature/pillar', '○ feature/sound-board', '● look/shape', '○ main']) {
      expect(await ui.find({ type: 'Text', text: shown })).toBeDefined()
    }
    // The other checkout stays folded: its own branch is not marked anywhere.
    expect(await ui.find({ type: 'Text', text: '● feature/sound-board' })).toBeUndefined()
    await ui.press({ key: 'folder:game-sound' })
    expect(await ui.find({ type: 'Text', text: '● feature/sound-board' })).toBeDefined()
    await ui.press({ key: 'folder:game' })
    expect((await ui.find({ key: 'folder:game' }))?.text).toBe('▸ game · look/shape')
    expect(await ui.find({ type: 'Text', text: '● look/shape' })).toBeUndefined()
    await ui.unmount()
  })

  test('follows a branch switched during a turn, and one switched in a terminal within half a minute', async ($, on) => {
    const clock = mock.clock(on)
    const world = project()
    stand(on, world)
    await $.session.start({ cwd: world.root, ...START })
    const ui = await $.ui.mount({ plugin: 'folder-branches', surface: 'desktop', ...PANE })
    await ui.press({ key: 'folder:game' })

    world.repos['D:/Work/project/game'] = { branch: 'main', branches: BRANCHES }
    await $.turn.complete({ answer: 'switched', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect((await ui.find({ key: 'folder:game' }))?.text).toBe('▾ game · main')
    expect(await ui.find({ type: 'Text', text: '● main' })).toBeDefined()

    // A new branch, a new checkout and a folder gone: all show after the next reading.
    world.repos['D:/Work/project/game'] = { branch: 'feature/x', branches: [...BRANCHES, 'feature/x'] }
    world.repos['D:/Work/project/art-inbox'] = { branch: 'main', branches: ['main'] }
    world.entries = world.entries.filter(entry => entry.name !== 'sound-library')
    await clock.advance(30000)
    for (let i = 0; i < 50 && (await ui.find({ key: 'folder:art-inbox' })) === undefined; i++) await Promise.resolve()
    expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual([
      '▸ art-inbox · main', '▾ game · feature/x', '▸ game-sound · feature/sound-board',
    ])
    expect(await ui.find({ type: 'Text', text: '● feature/x' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /sound-library/ })).toBeUndefined()
    await ui.unmount()
  })

  test('says what is checked out when no branch is, and when git gives no answer', async ($, on) => {
    mock.clock(on)
    const world = project()
    world.repos['D:/Work/project/game'] = { branch: null, branches: ['main'] }
    world.repos['D:/Work/project/game-sound'] = { branch: 'main', branches: [], isBroken: true }
    stand(on, world)
    await $.session.start({ cwd: world.root, ...START })
    const ui = await $.ui.mount({ plugin: 'folder-branches', surface: 'terminal', ...PANE })
    expect((await ui.find({ key: 'folder:game' }))?.text).toBe('▸ game · (none, at commit abc1234)')
    expect((await ui.find({ key: 'folder:game-sound' }))?.text).toBe('▸ game-sound · (unknown)')
    await ui.press({ key: 'folder:game' })
    expect(await ui.find({ type: 'Text', text: '○ main' })).toBeDefined()
    await ui.press({ key: 'folder:game-sound' })
    expect(await ui.find({ type: 'Text', text: 'No local branches.' })).toBeDefined()
    // A folder that is no checkout is never asked of git.
    expect(world.asked.some(asked => asked.includes('art-inbox'))).toBe(false)
    await ui.unmount()
  })

  test('a session opened in a checkout shows that folder first and leaves out the folders that are part of it', async ($, on) => {
    mock.clock(on)
    const world: World = {
      root: '/home/me/game',
      entries: [dir('src'), dir('docs'), dir('.git'), dir('vendor-lib'), file('package.json')],
      repos: {
        '/home/me/game': { branch: 'feature/sound-board', branches: ['feature/sound-board', 'main'] },
        '/home/me/game/vendor-lib': { branch: 'v2', branches: ['v2'] },
      },
      asked: [],
      opened: [],
    }
    stand(on, world)
    await $.session.start({ cwd: world.root, surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'folder-branches', surface: 'terminal', ...PANE })
    expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual([
      '▸ game (this folder) · feature/sound-board', '▸ vendor-lib · v2',
    ])
    expect(await ui.find({ type: 'Text', text: /no git/ })).toBeUndefined()
    await ui.press({ key: 'folder:.' })
    expect(await ui.find({ type: 'Text', text: '● feature/sound-board' })).toBeDefined()
    await ui.unmount()
  })

  test('/git answers the same list as text and opens the pane', async ($, on) => {
    mock.clock(on)
    const world = project()
    stand(on, world)
    await $.session.start({ cwd: world.root, ...START })
    // There are branches to show: the pane opens by itself.
    expect(world.opened).toEqual(['folder-branches:Git'])
    const answer = await $.command.run({ command: 'git', args: '', ...ASKED })
    expect(answer.text).toBe([
      'game: look/shape', 'game-sound: feature/sound-board', 'art-inbox: no git', 'linked: no git',
      'sound-library: no git', 'The Git pane is open.',
    ].join('\n'))
    expect(world.opened).toHaveLength(2)
  })

  test('stays closed where nothing is in git, and says so when the folder is empty or cannot be read', async ($, on) => {
    mock.clock(on)
    const world: World = {
      root: '/home/me/notes', entries: [dir('drafts'), file('todo.md')], repos: {}, asked: [], opened: [],
    }
    stand(on, world)
    await $.session.start({ cwd: world.root, surface: 'terminal', isInteractive: true })
    expect(world.opened).toEqual([])
    expect(world.asked).toEqual([])
    const ui = await $.ui.mount({ plugin: 'folder-branches', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: 'drafts · no git' })).toBeDefined()

    world.entries = [file('todo.md')]
    const empty = await $.command.run({ command: 'git', args: '', ...ASKED })
    expect(empty.text).toBe('This folder holds no folders.\nThe Git pane is open.')
    expect(await ui.find({ type: 'Text', text: 'This folder holds no folders.' })).toBeDefined()

    world.listError = 'EACCES: permission denied'
    const gone = await $.command.run({ command: 'git', args: '', ...ASKED })
    expect(gone.text).toContain('This folder could not be read (')
    expect(await ui.find({ type: 'Text', text: 'This folder could not be read.' })).toBeDefined()
    await ui.unmount()
  })
})
