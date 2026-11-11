import { useEffect, useRef } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
import { yaml } from '@codemirror/lang-yaml'
import { setDiagnostics, lintGutter } from '@codemirror/lint'
import type { Diagnostic } from './core/types'

export interface Focus { from: number; to: number; nonce: number; activate?: boolean }
interface Props {
  value: string
  readOnly?: boolean
  onChange?: (v: string) => void
  onCursor?: (pos: number) => void
  focus?: Focus | null
  diagnostics?: Diagnostic[]
}

export default function Editor({ value, readOnly, onChange, onCursor, focus, diagnostics }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const programmatic = useRef(false)
  const cbs = useRef({ onChange, onCursor })
  cbs.current = { onChange, onCursor }
  const ro = useRef(new Compartment())

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup, yaml(), lintGutter(), keymap.of([]),
          ro.current.of([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !programmatic.current) cbs.current.onChange?.(u.state.doc.toString())
            if (u.selectionSet && !programmatic.current && !u.docChanged) cbs.current.onCursor?.(u.state.selection.main.head)
          }),
        ],
      }),
    })
    view.current = v
    return () => v.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const v = view.current
    if (!v) return
    v.dispatch({ effects: ro.current.reconfigure([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]) })
  }, [readOnly])

  useEffect(() => {
    const v = view.current
    if (!v || v.state.doc.toString() === value) return
    programmatic.current = true
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
    programmatic.current = false
  }, [value])

  useEffect(() => {
    const v = view.current
    if (!v || !focus) return
    const len = v.state.doc.length
    const from = Math.min(focus.from, len)
    const to = Math.min(Math.max(focus.to, from), len)
    if (focus.activate !== false) {
      programmatic.current = true
      v.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'start', yMargin: 40 }) })
      programmatic.current = false
      v.focus()
      return
    }
    // A phone view can have just become visible. Let CodeMirror measure its
    // viewport before scrolling, otherwise it uses the hidden editor's size.
    let nextFrame = 0
    const frame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => {
        programmatic.current = true
        v.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
        programmatic.current = false
        // Source navigation on phones should not summon the keyboard.
        if (focus.activate !== false) v.focus()
      })
    })
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame) }
  }, [focus])

  useEffect(() => {
    const v = view.current
    if (!v) return
    const len = v.state.doc.length
    const ds = (diagnostics ?? []).filter((d) => d.range).map((d) => {
      const from = Math.min(d.range![0], len)
      return { from, to: Math.min(Math.max(d.range![1], from + 1), len), severity: d.severity, message: d.message }
    })
    v.dispatch(setDiagnostics(v.state, ds))
  }, [diagnostics, value])

  return <div className="cm-host" ref={host} />
}
