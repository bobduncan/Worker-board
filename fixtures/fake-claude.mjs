// A stand-in for the Claude app's command-line program, for the tests of `npm run setup` (B251): it answers the few
// `plugin` commands setup uses from a state file (FAKE_CLAUDE_STATE), changes that file as the real program changes
// its records, and notes every call. It installs nothing anywhere.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const file = process.env.FAKE_CLAUDE_STATE
const state = JSON.parse(readFileSync(file, 'utf8'))
const args = process.argv.slice(2)
state.calls.push(args)
const save = () => writeFileSync(file, JSON.stringify(state))
const said = (text, code = 0) => {
  save()
  process.stdout.write(text)
  process.exitCode = code
}
const words = args.filter(arg => !arg.startsWith('-'))
const command = words.slice(0, words[1] === 'marketplace' ? 3 : 2).join(' ')
const versionIn = dir => JSON.parse(readFileSync(join(dir, 'workers', '.claude-plugin', 'plugin.json'), 'utf8')).version

if (state.isBroken) {
  said('Something went wrong inside the program.\n', 1)
} else if (command === 'plugin list') {
  said(JSON.stringify(state.plugins))
} else if (command === 'plugin marketplace list') {
  said(JSON.stringify(state.marketplaces))
} else if (command === 'plugin marketplace add') {
  const path = args[3]
  const name = JSON.parse(readFileSync(join(path, '.claude-plugin', 'marketplace.json'), 'utf8')).name
  if (state.marketplaces.some(one => one.name === name)) {
    said(`Marketplace '${name}' is already declared.\n`, 1)
  } else {
    state.marketplaces.push({ name, source: 'directory', path, installLocation: path })
    said(`Successfully added marketplace: ${name} (declared in user settings)\n`)
  }
} else if (command === 'plugin install' || command === 'plugin i') {
  const id = args[2]
  const [name, market] = id.split('@')
  const known = state.marketplaces.find(one => one.name === market)
  if (known === undefined) {
    said(`Plugin "${name}" not found in marketplace "${market}"\n`, 1)
  } else {
    state.plugins.push({ id, version: versionIn(known.path), scope: 'user', enabled: true })
    said(`Successfully installed plugin: ${id} (scope: user)\n`)
  }
} else if (command === 'plugin uninstall' || command === 'plugin remove') {
  state.plugins = state.plugins.filter(one => one.id !== args[2])
  said(`Successfully uninstalled plugin: ${args[2]}\n`)
} else if (command === 'plugin enable') {
  const plugin = state.plugins.find(one => one.id === args[2])
  if (plugin !== undefined) plugin.enabled = true
  said(`Successfully enabled plugin: ${args[2]}\n`)
} else if (command === 'plugin marketplace update') {
  said(`Successfully updated marketplace: ${args[3]}\n`)
} else if (command === 'plugin update') {
  const plugin = state.plugins.find(one => one.id === args[2])
  const known = state.marketplaces.find(one => one.name === args[2].split('@')[1])
  if (plugin !== undefined && known !== undefined) plugin.version = versionIn(known.path)
  said(`Plugin "${args[2]}" updated. Restart to apply changes.\n`)
} else {
  said(`unknown command: ${args.join(' ')}\n`, 1)
}
