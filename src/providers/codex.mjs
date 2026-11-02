// The asset provider for pictures: Codex, which the board runs by itself (mode "auto"). `check` knows whether it can
// work now; part C (spec 2026-11-01, part 4) adds `provide`, which wraps `makePicture` of src/codex.mjs: its own
// temporary folder, a time limit, and only the request's words and reference pictures.

import { join } from 'node:path'

import { findCodex, makePicture } from '../codex.mjs'
import { promptFor } from '../design.mjs'
import { freeName } from './elevenlabs-key.mjs'

/** How long one picture of a request may take when the board names no time (the Design tab's own default). */
export const PICTURE_SECONDS = 240

export const codex = {
  name: 'codex',
  mode: 'auto',
  kinds: ['visual'],
  card: { title: 'Codex', line: 'Pictures on your ChatGPT plan', facts: ['Signed in as you', 'One at a time, in a queue'], icon: 'openai' },
  /**
   * Whether Codex is found: where `tools.codexPath` says (the `codex` of the Design tab's settings, '' for none), else
   * where the board looks for it. `tools.findCodex` stands in for src/codex.mjs `findCodex` (the tests'). It makes
   * nothing and never throws.
   */
  async check({ findCodex: find = findCodex, codexPath = '' } = {}) {
    try {
      return (await find({ given: codexPath })) === null
        ? { ok: false, state: 'needs', why: 'Codex not found', detail: 'Codex not found' }
        : { ok: true, state: 'works', why: 'Codex found', detail: 'Codex found' }
    } catch {
      return { ok: false, state: 'needs', why: 'Codex could not be looked for', detail: 'Codex not found' }
    }
  },
  /**
   * Part C: makes one picture of the request and keeps it as `<n>.png` in the request's folder (the first number not
   * taken, so `1.png`), with its words beside it (`1.prompt.txt`, as makePicture keeps them): `{ files: ['1.png'] }`, or
   * `{ failed: why }`. `request.pictures` are whole paths, attached in order; with `request.edits` the first is the
   * earlier iteration to change (the request it follows), the others are references for the look. `tools.makePicture`
   * and `tools.findCodex` stand in for src/codex.mjs's (the tests'); `tools.seconds` is the time limit. It never throws.
   */
  async provide(request, { makePicture: make = makePicture, findCodex: find = findCodex, codexPath = '', seconds = PICTURE_SECONDS } = {}) {
    try {
      const path = await find({ given: codexPath })
      if (path === null) return { failed: 'Codex not found' }
      const pictures = Array.isArray(request.pictures) ? request.pictures : []
      const edits = request.edits === true && pictures.length > 0
      const text = String(request.text ?? '').trim()
      const prompt = promptFor({ opening: '', text, change: edits ? text : null, isEdit: edits, references: pictures.length - (edits ? 1 : 0) })
      const name = await freeName(request.folder, 'png')
      const made = await make({ command: [path], prompt, images: pictures, to: join(request.folder, name), seconds })
      return made?.ok === true ? { files: [name] } : { failed: String(made?.why ?? 'Codex made no picture') }
    } catch {
      return { failed: 'Codex could not be asked for the picture' }
    }
  },
}
