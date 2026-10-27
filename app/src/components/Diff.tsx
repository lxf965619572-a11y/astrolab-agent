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
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.keyword, t.controlKeyword, t.modifier, t.definitionKeyword], color: 'var(--accent-text)' },
  { tag: [t.typeName, t.standard(t.typeName)], color: 'var(--code-type)' },
  { tag: [t.string, t.character], color: 'var(--code-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--code-number)' },
  { tag: [t.processingInstruction, t.meta], color: 'var(--code-meta)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--code-fn)', fontWeight: '500' },
  { tag: t.heading, color: 'var(--code-fn)', fontWeight: '700' },
  { tag: [t.link, t.url], color: 'var(--accent-text)' },
])

const theme = EditorView.theme({
  '&': { fontSize: '12.5px', backgroundColor: 'transparent', height: '100%' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.75' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--ink-4)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 12px', minWidth: '36px' },
  '.cm-content': { padding: '8px 0' },
  '.cm-line': { padding: '0 16px 0 6px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-changedLine': { backgroundColor: 'var(--diff-add) !important' },
  '.cm-changedText': { background: 'var(--diff-add-text) !important' },
  '.cm-deletedChunk': { backgroundColor: 'var(--diff-del)', padding: '0' },
  '.cm-deletedChunk .cm-deletedText': { background: 'var(--diff-del-text)' },
  '.cm-insertedLine': { backgroundColor: 'var(--diff-add)' },
  '.cm-deletedLine': { backgroundColor: 'var(--diff-del)' },
  '.cm-changeGutter': { width: '3px', paddingLeft: '0' },
  '.cm-changedLineGutter': { backgroundColor: 'var(--ok)' },
  '.cm-deletedLineGutter': { backgroundColor: 'var(--err)' },
  '.cm-collapsedLines': { backgroundColor: 'var(--diff-collapsed)', color: 'var(--ink-3)', fontFamily: 'var(--font)', fontSize: '12px', padding: '4px 16px' },
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
