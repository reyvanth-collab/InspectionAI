export type Assessment = {
  required: boolean
  mode: 'manual' | 'expected' | 'limits'
  expectedAnswer?: string
  optionMap?: Record<string, 'pass' | 'fail'>
}
export interface Question {
  field_type?: string
  required?: boolean
  conditional_json?: string | null
  options_json?: string | null
  min_value?: number | null
  max_value?: number | null
}
export interface Answer {
  result?: string | null
  value?: string
  captured_value?: string | null
  notes?: string | null
  naReason?: string
  photos?: string[]
  photo_urls?: string[]
}
export function policy(q: Question): {
  assessment: Assessment
  allowNA: boolean
  legacy: boolean
  notesOnFail?: boolean
  photoOnFail?: boolean
  naReasonRequired?: boolean
} {
  let p: Record<string, unknown> = {}
  try {
    p = JSON.parse(q.conditional_json || '{}') || {}
  } catch {
    /* invalid configuration is reported separately */
  }
  return {
    ...p,
    legacy: !p.assessment,
    assessment: (p.assessment as Assessment) || {
      required: q.field_type !== 'heading',
      mode: 'manual',
    },
    allowNA: p.allowNA !== false,
  }
}
export function defaultAssessment(type: string): Assessment {
  return { required: ['pass_fail', 'measurement', 'number'].includes(type), mode: 'manual' }
}
export function configurationProblem(q: Question): string | null {
  const p = policy(q),
    a = p.assessment
  if (q.field_type === 'heading') return null
  if (['dropdown', 'select', 'multiselect'].includes(q.field_type || '')) {
    try {
      const options = JSON.parse(q.options_json || '[]')
      if (
        !Array.isArray(options) ||
        !options.length ||
        options.some((o) => typeof o !== 'string' || !o.trim())
      )
        return 'Add at least one labelled response option'
    } catch {
      return 'Supply valid response options'
    }
  }
  if (typeof a.required !== 'boolean' || !['manual', 'expected', 'limits'].includes(a.mode))
    return 'Choose a supported assessment policy'
  if (!a.required && q.field_type === 'pass_fail')
    return 'Choose a response type before switching off Pass/Fail assessment'
  if (!a.required) return null
  if (
    a.mode === 'limits' &&
    (!['measurement', 'number'].includes(q.field_type || '') ||
      (q.min_value == null && q.max_value == null))
  )
    return 'Numeric assessment needs a numeric response and at least one explicit limit'
  if (q.min_value != null && q.max_value != null && q.min_value > q.max_value)
    return 'Minimum must not exceed maximum'
  if (
    a.mode === 'expected' &&
    (!['text', 'textarea', 'yes_no', 'dropdown', 'select', 'checkbox'].includes(
      q.field_type || '',
    ) ||
      (!a.expectedAnswer?.trim() && !Object.keys(a.optionMap || {}).length))
  )
    return 'Expected-answer assessment needs a compatible response and an explicit expected answer or option mapping'
  if (a.optionMap && Object.values(a.optionMap).some((v) => !['pass', 'fail'].includes(v)))
    return 'Option mappings must explicitly specify pass or fail'
  return null
}
export function responseValue(a: Answer): string {
  return String(a.value ?? a.captured_value ?? '')
}
const numeric = (value: string) =>
  /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value))
export function hasAnswer(q: Question, a: Answer): boolean {
  if (q.field_type === 'heading') return false
  if (q.field_type === 'pass_fail') return !!a.result
  if (q.field_type === 'photo') return !!(a.photos || a.photo_urls)?.length
  return !!responseValue(a).trim()
}
export function derivedResult(q: Question, a: Answer): 'pass' | 'fail' | 'na' | null {
  const p = policy(q),
    rule = p.assessment,
    v = responseValue(a).trim()
  if (!rule.required) return null
  if (a.result === 'na' && p.allowNA) return 'na'
  if (rule.mode === 'manual')
    return ['pass', 'fail'].includes(a.result || '') ? (a.result as 'pass' | 'fail') : null
  if (!v) return null
  if (rule.mode === 'limits') {
    if (!numeric(v)) return null
    return (q.min_value != null && Number(v) < q.min_value) ||
      (q.max_value != null && Number(v) > q.max_value)
      ? 'fail'
      : 'pass'
  }
  if (rule.optionMap && Object.keys(rule.optionMap).length) {
    const mapped = rule.optionMap[v]
    return mapped === 'pass' || mapped === 'fail' ? mapped : null
  }
  return v === rule.expectedAnswer?.trim() ? 'pass' : 'fail'
}
export function answerProblem(q: Question, a: Answer): string | null {
  if (q.field_type === 'heading') return null
  const config = configurationProblem(q)
  if (config) return config
  const p = policy(q),
    v = responseValue(a).trim(),
    result = derivedResult(q, a),
    type = q.field_type || 'pass_fail'
  if (p.legacy && q.required === false && !a.result) return null
  if (a.result === 'na') {
    if (!p.assessment.required || !p.allowNA) return 'N/A is not configured for this question'
    return (q.required !== false || p.naReasonRequired) && !(a.naReason ?? a.notes ?? '').trim()
      ? 'Explain why this item is not applicable'
      : null
  }
  const answered = hasAnswer(q, a)
  if (!answered && !a.result && q.required === false) return null
  if (!answered && type !== 'pass_fail')
    return type === 'photo' ? 'Attach photo evidence' : 'A response is required'
  if (['number', 'measurement'].includes(type) && !numeric(v))
    return 'Enter a valid numeric reading'
  if (p.assessment.required && !result)
    return p.assessment.mode === 'expected' && v
      ? 'Configure an assessment mapping for this response'
      : 'Choose a Pass/Fail assessment'
  if (
    ['number', 'measurement'].includes(type) &&
    result === 'pass' &&
    ((q.min_value != null && Number(v) < q.min_value) ||
      (q.max_value != null && Number(v) > q.max_value))
  )
    return 'The reading is outside the stated limits; record a failure'
  if (
    type === 'date' &&
    v &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
      Number.isNaN(Date.parse(v)) ||
      new Date(v).toISOString().slice(0, 10) !== v)
  )
    return 'Enter a valid calendar date'
  if (type === 'signature' && v && !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(v))
    return 'Capture a valid question signature'
  if (type === 'yes_no' && v && !['Yes', 'No', 'yes', 'no'].includes(v)) return 'Choose Yes or No'
  if (['dropdown', 'select', 'multiselect', 'table'].includes(type)) {
    try {
      const options = JSON.parse(q.options_json || '[]')
      if (['dropdown', 'select'].includes(type) && v && !options.includes(v))
        return 'Choose a listed response option'
      if (type === 'multiselect') {
        const list = JSON.parse(v)
        if (!Array.isArray(list) || !list.length || list.some((x) => !options.includes(x)))
          return 'Choose at least one listed response'
      }
      if (type === 'table') {
        const table = JSON.parse(v)
        if (
          !table ||
          Array.isArray(table) ||
          typeof table !== 'object' ||
          !Object.values(table).some((x) => String(x).trim())
        )
          return 'Complete the response table'
      }
    } catch {
      return 'Enter a valid structured response'
    }
  }
  if (result === 'fail' && p.notesOnFail && !a.notes?.trim()) return 'Describe the failed condition'
  if (result === 'fail' && p.photoOnFail && !(a.photos || a.photo_urls)?.length)
    return 'Attach failure photo evidence'
  return null
}
export function questionAnswered(q: Question, a: Answer): boolean {
  return (
    !answerProblem(q, a) &&
    (policy(q).assessment.required ? !!derivedResult(q, a) : hasAnswer(q, a))
  )
}
