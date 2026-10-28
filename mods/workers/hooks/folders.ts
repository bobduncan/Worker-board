// The parts of the Workers mod that need no engine: paths, the order of the rows, and reading what git prints.
import type { FolderRow } from '../types'

/** The row id of the session's own folder: no folder inside it can have this name. */
export const SELF = '.'
/** Shown for a checkout git gave no answer for. */
export const UNKNOWN = '(unknown)'

/** `name` inside `folder`, with the separator the folder's path uses. */
export function inFolder(folder: string, name: string): string {
  return `${folder.replace(/[\\/]+$/, '')}${folder.includes('\\') ? '\\' : '/'}${name}`
}

/** A folder's own name: the last part of its path; the path itself for a drive or the root. */
export function folderName(path: string): string {
  const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  return name === '' ? path : name
}

/** True for a folder the pane lists: one whose name starts with a dot (.git, .claude) is a tool's own. */
export function isListed(name: string): boolean {
  return !name.startsWith('.')
}

/** By name, capitals and small letters together, as a file explorer orders folders. */
export function byName(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0
}

/** The branch `git branch --show-current` printed; null when none is checked out. */
export function branchName(stdout: string): string | null {
  const name = stdout.trim()
  return name === '' ? null : name
}

/** What is shown when no branch is checked out, from what `git rev-parse --short HEAD` printed (null: nothing). */
export function detached(stdout: string | null): string {
  const commit = stdout?.trim() ?? ''
  return commit === '' ? '(none)' : `(none, at commit ${commit})`
}

/** The local branches `git for-each-ref --format=%(refname:short) refs/heads` printed, in git's order. */
export function branchList(stdout: string): string[] {
  return stdout.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '')
}

/** The rows in the pane's order: the session's own folder, the folders in git, then the others; each by name. */
export function ordered(rows: readonly FolderRow[]): FolderRow[] {
  const rank = (row: FolderRow): number => (row.id === SELF ? 0 : row.branch !== null ? 1 : 2)
  return [...rows].sort((a, b) => rank(a) - rank(b) || byName(a.name, b.name))
}

/** The folders and their branches as text, for the command's answer. */
export function summary(rows: readonly FolderRow[]): string {
  if (rows.length === 0) return 'This folder holds no folders.'
  return rows.map(row => `${row.name}: ${row.branch ?? 'no git'}`).join('\n')
}
