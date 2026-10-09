'use strict';
// A circuit breaker shared by health checks and crash events. Passing through a
// successful launch must not erase a crash loop; reset only after stable uptime.
class RecoveryBudget {
  constructor({ now = Date.now, delays = [1000, 3000, 10000, 30000, 60000], stableMs = 300000 } = {}) {
    this.now = now; this.delays = delays; this.stableMs = stableMs; this.reset();
  }
  reset() { this.attempts = 0; this.nextAt = 0; this.stableSince = null; }
  healthy() {
    if (this.stableSince === null) this.stableSince = this.now();
    if (this.now() - this.stableSince >= this.stableMs) this.reset();
  }
  failure() {
    this.stableSince = null;
    if (!this.nextAt && !this.exhausted) this.nextAt = this.now() + this.delays[this.attempts];
  }
  get exhausted() { return this.attempts >= this.delays.length; }
  get due() { return !!this.nextAt && !this.exhausted && this.now() >= this.nextAt; }
  take() { if (!this.due) return false; this.attempts++; this.nextAt = 0; return true; }
}
module.exports = { RecoveryBudget };
