import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTask } from './notes.ts'

test('isTask: true si dueDate está definido', () => {
  assert.equal(
    isTask({ dueDate: '2026-07-01', isImportant: false, status: 'ACTIVE' }),
    true
  )
})

test('isTask: true si isImportant es true', () => {
  assert.equal(
    isTask({ dueDate: null, isImportant: true, status: 'ACTIVE' }),
    true
  )
})

test('isTask: true si status es ACTIVE', () => {
  assert.equal(
    isTask({ dueDate: null, isImportant: false, status: 'ACTIVE' }),
    true
  )
})

test('isTask: true si status es IN_PROGRESS', () => {
  assert.equal(
    isTask({ dueDate: null, isImportant: false, status: 'IN_PROGRESS' }),
    true
  )
})

test('isTask: false si status es DRAFT sin fecha ni importancia', () => {
  assert.equal(
    isTask({ dueDate: null, isImportant: false, status: 'DRAFT' }),
    false
  )
})

test('isTask: false si status es DONE sin fecha ni importancia', () => {
  assert.equal(
    isTask({ dueDate: null, isImportant: false, status: 'DONE' }),
    false
  )
})

test('isTask: false si status es NEEDS_REVIEW sin fecha ni importancia', () => {
  assert.equal(
    isTask({ dueDate: null, isImportant: false, status: 'NEEDS_REVIEW' }),
    false
  )
})

test('isTask: acepta Date además de string ISO en dueDate', () => {
  assert.equal(
    isTask({ dueDate: new Date('2026-07-01'), isImportant: false, status: 'DRAFT' }),
    true
  )
})
