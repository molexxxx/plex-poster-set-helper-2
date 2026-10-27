import type { ReactNode } from 'react'
import { REPO_URL } from '../data/release'

export interface ListItem
{
  text: string
  blocks: Block[]
}

export type Block =
  | { kind: 'heading'; level: 2 | 3; text: string; id: string }
  | { kind: 'p'; text: string }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }

export interface Section
{
  title: string
  id: string
  blocks: Block[]
}

const LIST = /^(\s*)([-*]|\d+\.) (.*)$/
const indentOf = (line: string) => line.length - line.trimStart().length

/**
 * Turns a heading into the anchor GitHub generates for it, so README links
 * such as "#first-run" resolve on the site too.
 *
 * @param text - The heading text.
 * @returns The slug, e.g. "troubleshooting-and-support".
 */
export function slug(text: string): string
{
  return text.toLowerCase().replace(/[`*_]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-')
}

/**
 * Parses the markdown the project's README.md and CHANGELOG.md use: headings,
 * paragraphs, ordered and bullet lists with nested blocks, fenced code, and
 * tables. Raw HTML lines are skipped.
 *
 * @param source - The markdown text.
 * @returns The blocks, in order.
 */
export function parseBlocks(source: string): Block[]
{
  return parseLines(source.split(/\r?\n/))
}

function parseLines(lines: string[]): Block[]
{
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () =>
  {
    if (para.length) blocks.push({ kind: 'p', text: para.join(' ') })
    para = []
  }

  let i = 0
  while (i < lines.length)
  {
    const line = lines[i]
    const trimmed = line.trim()
    const heading = /^(#{2,3}) (.+)$/.exec(trimmed)

    if (!trimmed)
    {
      flush()
      i++
    }
    else if (trimmed.startsWith('```'))
    {
      flush()
      const body: string[] = []
      const pad = indentOf(line)
      i++
      while (i < lines.length && lines[i].trim() !== '```') body.push(lines[i++].slice(pad))
      blocks.push({ kind: 'code', text: body.join('\n') })
      i++
    }
    else if (trimmed.startsWith('<') || trimmed.startsWith('# '))
    {
      flush()
      i++
    }
    else if (heading)
    {
      flush()
      const text = heading[2].trim()
      blocks.push({ kind: 'heading', level: heading[1].length as 2 | 3, text, id: slug(text) })
      i++
    }
    else if (trimmed.startsWith('|'))
    {
      flush()
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|'))
      {
        rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()))
        i++
      }
      const [head, , ...body] = rows
      blocks.push({ kind: 'table', head, rows: body })
    }
    else if (LIST.test(line))
    {
      flush()
      const parsed = parseList(lines, i)
      blocks.push(parsed.block)
      i = parsed.next
    }
    else
    {
      para.push(trimmed)
      i++
    }
  }
  flush()
  return blocks
}

function parseList(lines: string[], start: number): { block: Block; next: number }
{
  const base = indentOf(lines[start])
  const ordered = /^\d+\./.test(lines[start].trim())
  const items: ListItem[] = []
  let i = start

  while (i < lines.length)
  {
    const m = LIST.exec(lines[i])
    if (!m || m[1].length !== base) break
    const sub: string[] = []
    i++
    while (i < lines.length)
    {
      const line = lines[i]
      if (!line.trim())
      {
        let j = i + 1
        while (j < lines.length && !lines[j].trim()) j++
        if (j < lines.length && indentOf(lines[j]) > base)
        {
          sub.push('')
          i++
          continue
        }
        break
      }
      if (indentOf(line) <= base) break
      sub.push(line)
      i++
    }
    const pad = Math.min(...sub.filter(l => l.trim()).map(indentOf), Infinity)
    items.push({ text: m[3].trim(), blocks: parseLines(sub.map(l => (pad === Infinity ? l : l.slice(pad)))) })
  }
  return { block: { kind: 'list', ordered, items }, next: i }
}

/**
 * Groups blocks under their level-two headings.
 *
 * @param blocks - Parsed blocks.
 * @returns One section per "## " heading; anything before the first is dropped.
 */
export function sections(blocks: Block[]): Section[]
{
  const out: Section[] = []
  for (const b of blocks)
  {
    if (b.kind === 'heading' && b.level === 2) out.push({ title: b.text, id: b.id, blocks: [] })
    else out[out.length - 1]?.blocks.push(b)
  }
  return out
}

const INLINE = /(\*\*.+?\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\b_[^_]+_\b)/g

function href(target: string): string
{
  if (/^(https?:|mailto:|#)/.test(target)) return target
  return `${REPO_URL}/blob/main/${target.replace(/^\.\//, '')}`
}

/**
 * Renders bold, inline code, links, and underscore emphasis as React nodes.
 * Relative links point at the file on GitHub; in-page anchors stay in-page.
 *
 * @param text - One paragraph, list item, or table cell.
 * @returns The rendered nodes; everything else stays plain text.
 */
export function inline(text: string): ReactNode[]
{
  return text.split(INLINE).filter(Boolean).map((part, i) =>
  {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{inline(part.slice(2, -2))}</strong>
    if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    if (/^_[^_]+_$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (link) return <a key={i} href={href(link[2])}>{inline(link[1])}</a>
    return part
  })
}

/**
 * Renders parsed blocks.
 *
 * @param props.blocks - The blocks to draw.
 */
export function Markdown({ blocks }: { blocks: Block[] })
{
  return <>{blocks.map((b, i) => <BlockView key={i} block={b} />)}</>
}

function BlockView({ block }: { block: Block })
{
  switch (block.kind)
  {
    case 'heading':
      return block.level === 2
        ? <h2 id={block.id}>{inline(block.text)}</h2>
        : <h3 id={block.id}>{inline(block.text)}</h3>
    case 'p':
      return <p>{inline(block.text)}</p>
    case 'code':
      return <pre><code>{block.text}</code></pre>
    case 'table':
      return (
        <table>
          <thead><tr>{block.head.map((h, i) => <th key={i} scope="col">{inline(h)}</th>)}</tr></thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>{row.map((cell, c) => (c === 0 ? <th key={c} scope="row">{inline(cell)}</th> : <td key={c}>{inline(cell)}</td>))}</tr>
            ))}
          </tbody>
        </table>
      )
    case 'list':
    {
      const items = block.items.map((item, i) => (
        <li key={i}>{inline(item.text)}{item.blocks.length > 0 && <Markdown blocks={item.blocks} />}</li>
      ))
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>
    }
  }
}
