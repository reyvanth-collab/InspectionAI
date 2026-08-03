import assert from 'node:assert/strict'
import { isValidDate, validateAssetDates } from '../dist/lib/assetValidation.js'

function run(name, fn) {
  fn()
  console.log(`PASS ${name}`)
}

run('accepts real ISO calendar dates', () => {
  assert.equal(isValidDate('2026-02-28'), true)
  assert.equal(isValidDate('2026-02-30'), false)
  assert.equal(isValidDate('28-02-2026'), false)
})

run('allows missing optional asset dates', () => {
  assert.equal(validateAssetDates('', ''), null)
  assert.equal(validateAssetDates('2026-02-01', ''), null)
  assert.equal(validateAssetDates('', '2026-03-01'), null)
})

run('rejects invalid and out-of-order asset dates', () => {
  assert.equal(validateAssetDates('2026-02-30', '2026-03-01'), 'Install date must be a valid date')
  assert.equal(validateAssetDates('2026-03-01', '2026-02-01'), 'Next PM date cannot be before install date')
})
