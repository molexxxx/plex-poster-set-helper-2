import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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

const ROUTES = [
  { path: 'docs/index.html', title: 'Docs - Plex Poster Set Helper 2', description: 'Install Plex Poster Set Helper 2 on Windows, Linux, Docker, or Unraid, sign in to Plex, and keep your posters current on a schedule.' },
  { path: 'changelog/index.html', title: 'Changelog - Plex Poster Set Helper 2', description: 'Release notes for every version of Plex Poster Set Helper 2.' },
  { path: '404.html', title: 'Not found - Plex Poster Set Helper 2', description: 'This page does not exist.' },
]

/**
 * The site is one app with client-side routes. GitHub Pages serves static
 * files, so each route gets a copy of the built shell (with its own title and
 * description) for direct visits and refreshes, and 404.html renders the
 * not-found route for anything else.
 */
function spaRoutes(): Plugin
{
  return {
    name: 'spa-routes',
    apply: 'build',
    closeBundle()
    {
      const dist = resolve(root, 'dist')
      const shell = readFileSync(resolve(dist, 'index.html'), 'utf8')
      for (const r of ROUTES)
      {
        const html = shell
          .replace(/<title>[^<]*<\/title>/, `<title>${r.title}</title>`)
          .replace(/(<meta name="description" content=")[^"]*(")/, `$1${r.description}$2`)
        const out = resolve(dist, r.path)
        mkdirSync(resolve(out, '..'), { recursive: true })
        writeFileSync(out, html)
      }
    },
  }
}

export default defineConfig({
  base: '/plex-poster-set-helper-2/',
  plugins: [readmeAnchors(), react(), spaRoutes()],
  server: {
    // The screenshots, README.md, and CHANGELOG.md live in the repository root, above the site.
    fs: { allow: [resolve(root, '..')] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
