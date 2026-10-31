import { test, expect } from '@playwright/test'
import { policyFixture } from './support/policy-fixture'
test('information-only responses autosave, survive reload and complete without manufactured assessment', async ({
  page,
}) => {
  const state = await policyFixture(page)
  await page.goto('/inspections/wo-policy')
  const question = page.getByRole('region', { name: 'Question 1', exact: true })
  await expect(question.getByRole('button', { name: /Pass$|Fail$|N\/A/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Review & sign', exact: true }).click()
  await page.getByRole('button', { name: 'Save & review', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('A response is required')
  await expect(question.getByLabel('Response', { exact: true })).toBeFocused()
  await expect(question.getByLabel('Response', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  )
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await expect(question).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Question 1: A response is required', exact: true })
    .click()
  await expect(question.getByLabel('Response', { exact: true })).toBeFocused()
  await question.getByLabel('Response', { exact: true }).fill('SYNTHETIC-SERIAL-1')
  await expect(page.getByRole('status')).toHaveText('Saved')
  expect(state.draft.answers['q-info'].result).toBe(null)
  await page.reload()
  await expect(question.getByLabel('Response', { exact: true })).toHaveValue('SYNTHETIC-SERIAL-1')
  await page.getByRole('button', { name: 'Review & sign', exact: true }).click()
  await page.getByRole('button', { name: 'Save & review', exact: true }).click()
  await page.getByRole('button', { name: 'Continue to signature', exact: true }).click()
  await page.getByLabel('Type your signature').fill('Synthetic owner')
  await page.getByRole('button', { name: 'Apply Signature', exact: true }).click()
  await expect(page.getByText('Signed · Completed — no assessed checks')).toBeVisible()
  expect(state.reviewed).toBe(1)
})
test('builder assessment defaults, explicit type changes, duplication, preview and exact-content confirmation', async ({
  page,
}) => {
  const state = await policyFixture(page)
  await page.goto('/library/new')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByLabel('Form reference')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByLabel('Form reference')).toBeFocused()
  await page.getByLabel('Form reference').fill('SYNTHETIC-POLICY')
  await page.getByRole('button', { name: 'Add Text input', exact: true }).click()
  const assessment = page.getByRole('checkbox', {
    name: 'Require Pass/Fail assessment',
    exact: true,
  })
  await expect(assessment).not.toBeChecked()
  await assessment.check()
  // The response type selector preserves the explicit policy.
  const typeSelect = page.getByLabel('Response type', { exact: true })
  await typeSelect.selectOption('date')
  await expect(assessment).toBeChecked()
  await assessment.uncheck()
  await page.getByRole('button', { name: 'Submit for Approval', exact: true }).click()
  await page.getByRole('checkbox', { name: /Independent synthetic reviewer/ }).check()
  await page.getByRole('button', { name: 'Continue to confirmation', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Confirm submission for approval' })).toBeVisible()
  expect(state.submitted).toBe(0)
  expect(JSON.parse(state.saved.checklistItems[0].conditionalJson).assessment.required).toBe(false)
  await page.getByRole('button', { name: 'Preview form', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Inspector preview — Preview mode' })).toBeVisible()
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'PASS', exact: true }),
  ).toHaveCount(0)
  expect(state.submitted).toBe(0)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(page.getByLabel('Form reference')).toHaveValue('SYNTHETIC-POLICY')
  await page.getByRole('button', { name: 'Submit for Approval', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: /Independent synthetic reviewer/ })).toBeChecked()
  // Editing the policy after preview requires a fresh confirmation.
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await assessment.check()
  await page.getByRole('button', { name: 'Submit for Approval', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Continue to confirmation', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Continue to confirmation', exact: true }).click()
  state.failSubmit = true
  await page.getByRole('button', { name: 'Submit for approval', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('concurrent change')
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(assessment).toBeChecked()
})
test('user table searches, filters, paginates and keeps access changes explicit on a phone', async ({
  page,
}) => {
  await policyFixture(page)
  await page.goto('/settings?tab=users')
  await expect(page.getByRole('table', { name: 'Users and access' })).toBeVisible()
  await expect(page.getByText(/27 matching users/)).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText(/Showing 26–27 of 27/)).toBeVisible()
  await page.getByLabel('Search users').fill('person26@')
  await expect(page.getByText(/1 matching users/)).toBeVisible()
  await page.getByLabel('Search users').fill('')
  await page.getByLabel('User capability').selectOption('inspector')
  await expect(page.getByText(/13 matching users/)).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .getByRole('button', { name: /Details for/ })
    .first()
    .click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page
    .getByRole('button', { name: /Manage access for/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Save access', exact: true }).click()
  await expect(page.locator('#access-reason')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('#access-reason')).toBeFocused()
  await page.screenshot({ path: 'test-results/users-access-phone.png', fullPage: true })
})
test('explicit assessment survives duplication and editor reload; confirmed submission prevents duplicate clicks', async ({
  page,
}) => {
  const state = await policyFixture(page)
  await page.goto('/library/new')
  await page.getByLabel('Form reference').fill('SYNTHETIC-SAVED-POLICY')
  await page.getByRole('button', { name: 'Add Text input', exact: true }).click()
  await page.getByRole('button', { name: 'Duplicate question', exact: true }).click()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page).toHaveURL(/\/library\/form-policy$/)
  expect(state.saved.checklistItems).toHaveLength(2)
  expect(
    state.saved.checklistItems.every(
      (q: any) => JSON.parse(q.conditionalJson).assessment.required === false,
    ),
  ).toBe(true)
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click()
  await page.getByRole('button', { name: 'Submit for Approval', exact: true }).click()
  await page.getByRole('checkbox', { name: /Independent synthetic reviewer/ }).check()
  await page.getByRole('button', { name: 'Continue to confirmation', exact: true }).click()
  expect(
    state.saved.checklistItems.every(
      (q: any) => JSON.parse(q.conditionalJson).assessment.required === false,
    ),
  ).toBe(true)
  await page
    .getByRole('button', { name: 'Submit for approval', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click()
      button.click()
    })
  await expect(page).toHaveURL(/\/library\/form-policy$/)
  expect(state.submitted).toBe(1)
})
test('pure checks have one assessment group; new date and signature defaults remain author-configurable', async ({
  page,
}) => {
  await policyFixture(page)
  await page.goto('/library/new')
  await page.getByLabel('Form reference').fill('SYNTHETIC-DEFAULTS')
  await page.getByRole('button', { name: 'Add Pass / Fail / NA', exact: true }).click()
  await expect(
    page.getByRole('checkbox', { name: 'Require Pass/Fail assessment', exact: true }),
  ).toBeChecked()
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'PASS', exact: true }),
  ).toHaveCount(1)
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'FAIL', exact: true }),
  ).toHaveCount(1)
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'N/A', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Require Pass/Fail assessment', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Choose a response type')
  await page.getByLabel('Response type', { exact: true }).selectOption('text')
  await page.getByRole('button', { name: 'Add Date / Time', exact: true }).click()
  await expect(
    page.getByRole('checkbox', { name: 'Require Pass/Fail assessment', exact: true }),
  ).not.toBeChecked()
  await page.getByRole('checkbox', { name: 'Require Pass/Fail assessment', exact: true }).check()
  await page.getByRole('button', { name: 'Add Signature', exact: true }).click()
  await expect(
    page.getByRole('checkbox', { name: 'Require Pass/Fail assessment', exact: true }),
  ).not.toBeChecked()
  await page.getByRole('checkbox', { name: 'Require Pass/Fail assessment', exact: true }).check()
})
test('asset and work-order required errors are visible and focus actionable controls', async ({
  page,
}) => {
  await policyFixture(page)
  await page.goto('/assets')
  await page.getByRole('button', { name: 'Create asset', exact: true }).click()
  await page.getByRole('button', { name: 'Save asset', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Enter an asset number')
  await expect(page.getByLabel('Asset number', { exact: true })).toBeFocused()
  await page.getByLabel('Asset number', { exact: true }).fill('SYNTHETIC-1')
  await expect(page.getByLabel('Asset number', { exact: true })).not.toHaveAttribute(
    'aria-invalid',
    'true',
  )
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.goto('/inspections')
  await page.getByRole('button', { name: 'Create work order', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Create work order', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText('Choose a registered asset')
  await expect(page.getByLabel('Asset', { exact: true })).toBeFocused()
})
