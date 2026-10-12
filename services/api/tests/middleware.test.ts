import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { NextFunction, Request, Response } from 'express'
import { requireScope } from '../src/middleware.ts'

function invoke(scopes: string[], required: string) {
  let status = 200
  let body: unknown
  let continued = false
  const req = {
    principal: {
      userId: 'user-1', orgId: 'org-1', role: 'member', scopes, via: 'api-key',
    },
  } as unknown as Request
  const res = {
    status(code: number) { status = code; return this },
    json(value: unknown) { body = value; return this },
  } as unknown as Response
  const next = (() => { continued = true }) as NextFunction
  requireScope(required)(req, res, next)
  return { status, body, continued }
}

test('API key scopes allow only explicitly granted capabilities', () => {
  assert.equal(invoke(['read'], 'read').continued, true)
  const denied = invoke(['read'], 'admin')
  assert.equal(denied.continued, false)
  assert.equal(denied.status, 403)
  assert.deepEqual(denied.body, { error: 'API key requires the admin scope' })
})

test('session principals are governed by roles instead of API key scopes', () => {
  let continued = false
  const req = {
    principal: { userId: 'user-1', orgId: 'org-1', role: 'owner', scopes: [], via: 'jwt' },
  } as unknown as Request
  requireScope('admin')(req, {} as Response, (() => { continued = true }) as NextFunction)
  assert.equal(continued, true)
})
