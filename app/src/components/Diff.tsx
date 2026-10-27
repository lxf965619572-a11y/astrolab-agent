// 差异视图：CodeMirror 6 的统一差异（删除的行内嵌显示），只读；C/C++ 和 Markdown 有语法高亮，长文件只渲染可见部分。

import { useEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { unifiedMergeView } from '@codemirror/merge'
import { cpp } from '@codemirror/lang-cpp'
import { markdown } from '@codemirror/lang-markdown'
import { tags as t } from '@lezer/highlight'

const highlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#6B6878', fontStyle: 'italic' },
  { tag: [t.keyword, t.controlKeyword, t.modifier, t.definitionKeyword], color: '#5B4BC4' },
  { tag: [t.typeName, t.standard(t.typeName)], color: '#2B5FB8' },
  { tag: [t.string, t.character], color: '#146C3A' },
  { tag: [t.number, t.bool, t.null], color: '#8A4B06' },
  { tag: [t.processingInstruction, t.meta], color: '#7A4106' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#1C1B22', fontWeight: '500' },
  { tag: t.heading, color: '#1C1B22', fontWeight: '700' },
  { tag: [t.link, t.url], color: '#5B4BC4' },
])

const theme = EditorView.theme({
  '&': { fontSize: '12.5px', backgroundColor: 'transparent', height: '100%' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.75' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#74717F' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 12px', minWidth: '36px' },
  '.cm-content': { padding: '8px 0' },
  '.cm-line': { padding: '0 16px 0 6px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-changedLine': { backgroundColor: '#F1FAF4 !important' },
  '.cm-changedText': { background: 'rgba(26, 143, 78, .16) !important' },
  '.cm-deletedChunk': { backgroundColor: '#FFF4F4', padding: '0' },
  '.cm-deletedChunk .cm-deletedText': { background: 'rgba(198, 40, 40, .14)' },
  '.cm-insertedLine': { backgroundColor: '#F1FAF4' },
  '.cm-deletedLine': { backgroundColor: '#FFF4F4' },
  '.cm-changeGutter': { width: '3px', paddingLeft: '0' },
  '.cm-changedLineGutter': { backgroundColor: '#1A8F4E' },
  '.cm-deletedLineGutter': { backgroundColor: '#C62828' },
  '.cm-collapsedLines': { backgroundColor: '#F4F2F9', color: '#5F5D6B', fontFamily: 'var(--font)', fontSize: '12px', padding: '4px 16px' },
})

function language(path: string): Extension[] {
  if (/\.(c|h|cc|cpp|hpp|cxx)$/i.test(path)) return [cpp()]
  if (/\.(md|markdown)$/i.test(path)) return [markdown()]
  return []
}

export function Diff({ path, before, after }: { path: string; before: string; after: string }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: after,
        extensions: [
          lineNumbers(), theme, syntaxHighlighting(highlight), ...language(path),
          EditorState.readOnly.of(true), EditorView.editable.of(false),
          unifiedMergeView({ original: before, mergeControls: false, highlightChanges: true, gutter: true, syntaxHighlightDeletions: true, collapseUnchanged: before && after ? { margin: 3, minSize: 8 } : undefined }),
        ],
      }),
    })
    return () => view.destroy()
  }, [path, before, after])
  return <div className="diff-host" ref={host} />
}
