import { useEffect, useRef } from 'react'
export interface ValidationIssue {
  id: string
  message: string
  reveal?: () => void
  server?: boolean
}
export function focusIssue(issue: ValidationIssue) {
  issue.reveal?.()
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const target = document.getElementById(issue.id)
      if (!target) return
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      const control = target.matches('input,select,textarea,button')
        ? target
        : target.querySelector<HTMLElement>('input,select,textarea,button,[tabindex]') || target
      control.focus({ preventScroll: true })
    }),
  )
}
export function ValidationSummary({
  issues,
  attempt = 1,
}: {
  issues: ValidationIssue[]
  attempt?: number
}) {
  const focused = useRef(0)
  useEffect(() => {
    const cleanups: (() => void)[] = []
    for (const issue of issues) {
      const target = document.getElementById(issue.id)
      if (!target) continue
      const controls = target.matches('input,select,textarea')
        ? [target]
        : Array.from(target.querySelectorAll('input,select,textarea,button'))
      const errorId = issue.id + '-validation-error'
      const message = document.createElement('p')
      message.id = errorId
      message.className = 'text-danger text-sm mt-2'
      message.textContent = issue.message
      const group = target.matches('input,select,textarea') ? target.parentElement : target
      group?.appendChild(message)
      target.setAttribute('data-invalid', 'true')
      for (const c of controls) {
        c.setAttribute('aria-invalid', 'true')
        c.setAttribute('aria-describedby', errorId)
      }
      cleanups.push(() => {
        message.remove()
        target.removeAttribute('data-invalid')
        for (const c of controls) {
          c.removeAttribute('aria-invalid')
          c.removeAttribute('aria-describedby')
        }
      })
    }
    if (issues.length && focused.current !== attempt) {
      focused.current = attempt
      focusIssue(issues[0])
    }
    return () => cleanups.forEach((c) => c())
  }, [issues, attempt])
  if (!issues.length) return null
  return (
    <div role="alert" className="execution-card border-danger-border mb-4">
      <h2 className="font-semibold text-danger">Please correct these fields</h2>
      <ul className="list-disc pl-5 mt-2">
        {issues.map((issue) => (
          <li key={issue.id}>
            <button className="text-accent underline text-left" onClick={() => focusIssue(issue)}>
              {issue.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
