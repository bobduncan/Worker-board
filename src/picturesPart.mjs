// T5.2 P4: setup's pictures part (setup.mjs calls it): where the project's pictures live (src/picturesSetup.mjs). Asked once, with a
// keyboard, when the project has no `pictures` setting; `--pictures <folder>` or `--pictures none` answers without asking. The choice goes
// into the project's settings (board-settings.json when it has one, else config.json); this PC's path to the folder into config.json
// (picturesHome). It never makes config.json: on a new board folder the first start makes it from examples/config.json (B127).

import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { cloudFolders } from './carry/pictures.mjs'
import { loadConfig } from './config.mjs'
import { DEFAULT_PICTURES_FOLDER, homeFor, isPictures, picturesAnswer, picturesAsked, picturesChoices, picturesFlag, withSetting } from './picturesSetup.mjs'
import { writeAtomic } from './write.mjs'

/**
 * `{ ok, lines }`. `boardDir` holds config.json; `ask(question)` gives the typed line (a keyboard); `clouds` the cloud folders found.
 */
export async function picturesPart({ boardDir, flag, isTty, isCheck, ask, clouds = cloudFolders(), env = process.env }) {
  const lines = []
  const configFile = join(boardDir, 'config.json')
  const hasConfig = await access(configFile).then(() => true, () => false)
  if (!hasConfig) return { ok: true, lines: ['The pictures part waits for the board\'s first start (it makes config.json); run setup again after it.'] }
  let config
  try {
    config = await loadConfig(configFile, env)
  } catch (error) {
    return { ok: true, lines: [`The pictures part is skipped: ${error.message}`] }
  }
  let answer = null
  if (isPictures(config.pictures)) {
    const home = config.picturesHome === '' ? homeFor(config.pictures, clouds) : null
    lines.push(`The project's pictures: ${config.pictures.where}${config.pictures.folder ? `, folder "${config.pictures.folder}"` : ''}${config.picturesHome ? ` (${config.picturesHome})` : ''}.`)
    if (home !== null) answer = { ok: true, pictures: null, picturesHome: home }
  } else if (flag !== undefined) answer = picturesFlag(flag)
  else if (picturesAsked({ pictures: config.pictures, flag, isTty, isCheck })) {
    const choices = picturesChoices(clouds)
    const shown = ['Where do this project\'s pictures go?', ...choices.map(one => `  ${one.key}. ${one.label}`)].join('\n')
    const typed = String(await ask(`${shown}\nPick 1 to ${choices.length} [1]: `)).trim()
    const picked = choices.find(one => one.key === (typed || '1'))
    const folder = picked?.path ? String(await ask(`The folder's name there [${DEFAULT_PICTURES_FOLDER}]: `)).trim() : ''
    const path = picked?.where === 'elsewhere' ? String(await ask('The whole folder (C:\\...): ')).trim() : ''
    answer = picturesAnswer(choices, { typed, folder, path })
  } else lines.push(isCheck ? 'The project names no place for its pictures: setup would ask.' : 'The project names no place for its pictures (say --pictures <folder> or --pictures none).')
  if (answer === null) return { ok: true, lines }
  if (!answer.ok) return { ok: false, lines: [...lines, `Nothing changed for the pictures: ${answer.why}`] }
  if (isCheck) return { ok: true, lines: [...lines, 'Nothing is written for the pictures: this is --check.'] }
  const write = async (file, key, value) => {
    const next = withSetting(await readFile(file, 'utf8').catch(() => null), key, value)
    if (next === null) throw new Error(`${file} is not there or holds no settings object`)
    await writeAtomic(file, next)
  }
  try {
    if (answer.pictures !== null) await write(config.settingsFile ?? configFile, 'pictures', answer.pictures)
    await write(configFile, 'picturesHome', answer.picturesHome)
  } catch (error) {
    return { ok: false, lines: [...lines, `The pictures were not written: ${error.message}`] }
  }
  return { ok: true, lines: [...lines, answer.picturesHome === '' ? 'The pictures stay in the project on this PC.' : `The pictures go to ${answer.picturesHome}.`] }
}
