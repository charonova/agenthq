import { Fragment, type ReactNode } from 'react'

/**
 * Just enough Markdown for agents' replies: code blocks, headings, lists, quotes, tables,
 * `code`, **bold**, *italics* and links. Everything becomes React elements, never HTML, so a
 * transcript can't inject anything into the page.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="md">{blocks(text)}</div>
}

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  const key = () => out.length
  while (i < lines.length) {
    const line = lines[i]!
    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)/)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trimStart().startsWith(fence[1]!)) body.push(lines[i++]!)
      i++
      out.push(
        <pre key={key()} data-lang={fence[2] || undefined}>
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }
    if (!line.trim()) {
      i++
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      out.push(
        <p key={key()} className={`h h${Math.min(heading[1]!.length, 3)}`}>
          {inline(heading[2]!)}
        </p>,
      )
      i++
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(lines[i++]!)
      out.push(table(rows, key()))
      continue
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*>\s?/, ''))
      out.push(<blockquote key={key()}>{blocks(body.join('\n'))}</blockquote>)
      continue
    }
    const item = /^\s*([-*+]|\d+[.)])\s+/
    if (item.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: string[] = []
      while (i < lines.length && (item.test(lines[i]!) || (/^\s{2,}\S/.test(lines[i]!) && items.length))) {
        if (item.test(lines[i]!)) items.push(lines[i]!.replace(item, ''))
        else items[items.length - 1] += `\n${lines[i]!.trim()}`
        i++
      }
      const List = ordered ? 'ol' : 'ul'
      out.push(
        <List key={key()}>
          {items.map((text, n) => (
            <li key={n}>{inline(text)}</li>
          ))}
        </List>,
      )
      continue
    }
    const paragraph: string[] = []
    while (i < lines.length && lines[i]!.trim() && !/^\s*(```|~~~|#{1,6}\s|>|\||[-*+]\s|\d+[.)]\s)/.test(lines[i]!)) {
      paragraph.push(lines[i++]!)
    }
    if (!paragraph.length) paragraph.push(lines[i++]!)
    out.push(<p key={key()}>{inline(paragraph.join('\n'))}</p>)
  }
  return out
}

function table(rows: string[], key: number): ReactNode {
  const cells = (row: string) =>
    row
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim())
  const body = rows.filter((row) => !/^\s*\|[\s:|-]+\|\s*$/.test(row)).map(cells)
  const [head, ...rest] = body
  return (
    <div key={key} className="table">
      <table>
        {head && (
          <thead>
            <tr>
              {head.map((cell, n) => (
                <th key={n}>{inline(cell)}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rest.map((row, r) => (
            <tr key={r}>
              {row.map((cell, n) => (
                <td key={n}>{inline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** `code`, **bold**, *italics*, [links](https://…), and line breaks. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|(?<![\w*])\*([^*\n]+)\*(?!\w)|\[([^\]\n]+)\]\(([^)\s]+)\)|\n/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const key = out.length
    if (match[1] !== undefined) out.push(<code key={key}>{match[1]}</code>)
    else if (match[2] !== undefined) out.push(<strong key={key}>{match[2]}</strong>)
    else if (match[3] !== undefined) out.push(<em key={key}>{match[3]}</em>)
    else if (match[4] !== undefined) {
      // Only web links open; anything else (javascript:, file paths) stays text.
      out.push(
        /^https?:\/\//.test(match[5]!) ? (
          <a key={key} href={match[5]} target="_blank" rel="noreferrer noopener">
            {match[4]}
          </a>
        ) : (
          <Fragment key={key}>{match[4]}</Fragment>
        ),
      )
    } else out.push(<br key={key} />)
    last = match.index + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
