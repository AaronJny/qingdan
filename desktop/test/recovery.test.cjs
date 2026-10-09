'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { RecoveryBudget } = require('../src/recovery.cjs');
test('crash recovery uses bounded exponential backoff and never refills on brief success', () => {
  let now = 1000; const budget = new RecoveryBudget({ now: () => now });
  for (const delay of [1000, 3000, 10000, 30000, 60000]) {
    budget.failure(); const due = now + delay; assert.equal(budget.nextAt, due); budget.failure(); assert.equal(budget.nextAt, due);
    now = due - 1; assert.equal(budget.take(), false); now++; assert.equal(budget.take(), true);
    budget.healthy(); now += 5; budget.failure();
  }
  assert.equal(budget.exhausted, true); now += 100000000; assert.equal(budget.take(), false);
  budget.reset(); assert.equal(budget.exhausted, false); assert.equal(budget.attempts, 0);
});
test('five minutes of verified stable uptime permits future recovery', () => {
  let now = 1000; const budget = new RecoveryBudget({ now: () => now });
  budget.failure(); now += 1000; budget.take(); budget.healthy(); now += 299999; budget.healthy(); assert.equal(budget.attempts, 1);
  now++; budget.healthy(); assert.equal(budget.attempts, 0);
});
