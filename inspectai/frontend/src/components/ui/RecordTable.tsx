import { Fragment, useState, type ReactNode } from 'react'
export interface RecordColumn<T> {
  key: string
  label: string
  essential?: boolean
  sort?: boolean
  render: (row: T) => ReactNode
}
export function RecordTable<T>({
  label,
  rows,
  columns,
  rowKey,
  sort,
  direction,
  onSort,
}: {
  label: string
  rows: T[]
  columns: RecordColumn<T>[]
  rowKey: (r: T) => string
  sort: string
  direction: string
  onSort: (key: string) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  return (
    <div className="record-table-wrap">
      <table className="record-table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={c.essential ? '' : 'table-secondary'}
                scope="col"
                aria-sort={
                  c.sort === false
                    ? undefined
                    : sort === c.key
                      ? direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                }
              >
                {c.sort === false ? (
                  c.label
                ) : (
                  <button onClick={() => onSort(c.key)}>
                    {c.label}
                    {sort === c.key ? (direction === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                )}
              </th>
            ))}
            <th className="table-expander" scope="col">
              Details
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = rowKey(r)
            return (
              <Fragment key={key}>
                <tr>
                  {columns.map((c) => (
                    <td key={c.key} className={c.essential ? '' : 'table-secondary'}>
                      <div className="record-cell">{c.render(r)}</div>
                    </td>
                  ))}
                  <td className="table-expander">
                    <button
                      className="text-accent min-h-11"
                      aria-label={`Details for ${key}`}
                      aria-expanded={expanded === key}
                      onClick={() => setExpanded(expanded === key ? null : key)}
                    >
                      {expanded === key ? 'Hide' : 'More'}
                    </button>
                  </td>
                </tr>
                {expanded === key && (
                  <tr className="table-mobile-details">
                    <td colSpan={columns.filter(c=>c.essential).length + 1}>
                      <dl>
                        {columns
                          .filter((c) => !c.essential)
                          .map((c) => (
                            <div key={c.key} className="my-2">
                              <dt className="text-xs text-text-2">{c.label}</dt>
                              <dd className="text-sm break-words">{c.render(r)}</dd>
                            </div>
                          ))}
                      </dl>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
