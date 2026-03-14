#!/usr/bin/env node
/**
 * Programmatic Vite build for environments where node_modules/.bin/vite
 * may not be executable (e.g. Docker/CI). Run with: node scripts/build.js
 */
import { build } from 'vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

await build({
  root,
  configFile: resolve(root, 'vite.config.js'),
})
