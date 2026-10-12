// The ideas of the Design tab and their versions, kept in `data/ideas.json`: there again after a restart of the
// board. The file holds what the person typed for an idea and where its pictures are, nothing from a chat.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { IDEAS_FOLDER, shortName } from './design.mjs'

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The ideas a file's text holds; a broken file holds none. A picture still "being made" was cut off by a restart. */
export function parseIdeas(text, why = 'The board was started anew while this picture was being made.') {
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!isRecord(raw) || !Array.isArray(raw.ideas)) return []
  return raw.ideas
    .filter(idea => isRecord(idea) && typeof idea.id === 'string' && typeof idea.name === 'string' && typeof idea.text === 'string' && Array.isArray(idea.versions))
    .map(idea => ({
      ...idea,
      references: Array.isArray(idea.references) ? idea.references : [],
      agreed: Number.isInteger(idea.agreed) ? idea.agreed : null,
      sent: isRecord(idea.sent) ? idea.sent : null,
      droppedAt: Number.isFinite(idea.droppedAt) ? idea.droppedAt : null,
      versions: idea.versions.filter(isRecord).map(version => (version.state === 'making' ? { ...version, state: 'failed', why } : version)),
    }))
}

/**
 * The ideas, with the changes the Design tab makes to them. `write(text)` keeps the file; every change is written
 * before it is answered, one write after the other.
 */
export function ideasOver(ideas, write = async () => {}) {
  let saving = Promise.resolve()
  const save = () => {
    const text = `${JSON.stringify({ ideas }, null, 1)}\n`
    saving = saving.then(() => write(text), () => write(text))
    return saving
  }
  const find = id => ideas.find(idea => idea.id === id)

  return {
    all: () => ideas,
    /** A new idea with its first version being made. */
    async add({ id, kind, text, references, now }) {
      const name = shortName(text, ideas.map(idea => idea.name))
      const idea = {
        id, name, kind, text, createdAt: now, folder: `${IDEAS_FOLDER}/${name}`, references,
        versions: [{ n: 1, at: now, change: null, from: null, state: 'making', picture: null, why: null, seconds: null }],
        agreed: null, sent: null, droppedAt: null,
      }
      ideas.push(idea)
      await save()
      return idea
    },
    /** One more version of an idea, being made: a change to the version `from`, or the idea tried again. */
    async again(id, { change, from, now }) {
      const idea = find(id)
      const version = { n: Math.max(0, ...idea.versions.map(one => one.n)) + 1, at: now, change, from, state: 'making', picture: null, why: null, seconds: null }
      idea.versions.push(version)
      // A new version is looked at anew.
      idea.agreed = null
      await save()
      return version
    },
    /** How the making of a version ended: with a picture, or with the reason it failed. */
    async finish(id, n, { picture = null, why = null, seconds = null }) {
      const version = find(id)?.versions.find(one => one.n === n)
      if (version === undefined || version.state !== 'making') return
      Object.assign(version, picture === null ? { state: 'failed', why } : { state: 'done', picture }, { seconds })
      await save()
    },
    async agree(id, n) {
      find(id).agreed = n
      await save()
    },
    async send(id, sent) {
      find(id).sent = sent
      await save()
    },
    async drop(id, now) {
      find(id).droppedAt = now
      await save()
    },
  }
}

/** The ideas over their file. The file is replaced whole, by way of a second file, so a write never leaves half of it. */
export async function ideasFile(file) {
  let text = ''
  try {
    text = await readFile(file, 'utf8')
  } catch {
    // No ideas yet.
  }
  return ideasOver(parseIdeas(text), async next => {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(`${file}.new`, next)
    await rename(`${file}.new`, file)
  })
}
