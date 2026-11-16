import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBase, resolveAsset, centsFromInput, nextOccurrence, buildOrderItems, decodeResponse } from '../src/lib/domain.ts'

test('API base allows local LAN and HTTPS endpoints without duplicate api prefix', () => {
  assert.equal(normalizeBase(' http://192.168.1.8:3000/ '), 'http://192.168.1.8:3000/api')
  assert.equal(normalizeBase('https://home.example/api/'), 'https://home.example/api')
  assert.throws(() => normalizeBase('file:///secret'))
})
test('signed asset URLs resolve on the API host without losing their signature', () => {
  assert.equal(resolveAsset('/api/assets/a/file?signature=abc', 'http://192.168.1.8:3000/api'), 'http://192.168.1.8:3000/api/assets/a/file?signature=abc')
})
test('money rejects negative values and excess decimals instead of rounding silently', () => {
  assert.equal(centsFromInput('12.30'), 1230)
  assert.throws(() => centsFromInput('-1'))
  assert.throws(() => centsFromInput('1.235'))
})
test('annual leap-day anniversaries use February 28 in a non leap year', () => {
  assert.equal(nextOccurrence('2024-02-29', true, '2027-02-01'), '2027-02-28')
  assert.equal(nextOccurrence('2024-02-29', true, '2027-03-01'), '2028-02-29')
})
test('an annual anniversary never occurs before its original future date', () => {
  assert.equal(nextOccurrence('2028-06-01',true,'2026-11-17'),'2028-06-01')
})
test('order payload snapshots only selected menu entries and valid quantities', () => {
  assert.deepEqual(buildOrderItems([{id:'a',name:'面条'},{id:'b',name:'茶'}], {a:2,b:0}), [{menuItemId:'a',name:'面条',quantity:2}])
  assert.throws(() => buildOrderItems([{id:'a',name:'面条'}], {a:100}))
})
test('API errors preserve server validation messages and malformed success rejects', () => {
  assert.throws(() => decodeResponse(400, {message:'金额必须大于 0'}), /金额必须大于 0/)
  assert.throws(() => decodeResponse(200, '<html>'), /服务地址/)
  assert.deepEqual(decodeResponse(200, {ok:true}), {ok:true})
})

