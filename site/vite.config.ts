import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const root = import.meta.dirname

/** Same slug rule as src/lib/markdown.tsx, which matches GitHub's heading anchors. */
const slug = (text: string) => text.toLowerCase().replace(/[`*_]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-')

function sourceFiles(dir: string): string[]
{
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [])
}

/**
 * Fails the build when the docs page lists a section, or the site links an
 * anchor, that README.md no longer has a heading for, so renaming a README
 * heading cannot silently drop a docs section or break a "How it works" link.
 */
function readmeAnchors(): Plugin
{
  return {
    name: 'readme-anchors',
    buildStart()
    {
      const readme = readFileSync(resolve(root, '../README.md'), 'utf8')
      const headings = new Set([...readme.matchAll(/^#{2,3} (.+)$/gm)].map(m => slug(m[1].trim())))
      const { sections } = JSON.parse(readFileSync(resolve(root, 'src/data/docs.json'), 'utf8')) as { sections: string[] }
      const linked = sourceFiles(resolve(root, 'src')).flatMap(file =>
      {
        const text = readFileSync(file, 'utf8')
        return [...text.matchAll(/\bdoc(?::\s*|\()'([a-z0-9-]+)'/g)].map(m => ({ id: m[1], file }))
      })
      const missing = [
        ...sections.filter(id => !headings.has(id)).map(id => `"#${id}" listed in src/data/docs.json`),
        ...linked.filter(l => !headings.has(l.id)).map(l => `"#${l.id}" linked from ${l.file.slice(root.length + 1)}`),
      ]
      if (missing.length)
      {
        this.error(`README.md has no heading for:\n  ${missing.join('\n  ')}\nRename the heading back, or update the site to the new heading.`)
      }
    },
  }
}

export default defineConfig({
  base: '/plex-poster-set-helper-2/',
  plugins: [readmeAnchors(), react()],
  server: {
    // The screenshots, README.md, and CHANGELOG.md live in the repository root, above the site.
    fs: { allow: [resolve(root, '..')] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        docs: resolve(root, 'docs/index.html'),
        changelog: resolve(root, 'changelog/index.html'),
      },
    },
  },
})
