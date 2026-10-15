export class ActionGate {
  epoch = 0;
  allowed = false;
  tail = Promise.resolve();
  pause() { this.allowed = false; this.epoch++; this.controller?.abort(); }
  enable() { this.allowed = true; this.epoch++; }
  async idle() { await this.tail; }
  run(action, expectedEpoch = this.epoch) {
    const job = this.tail.then(async () => {
      if (!this.allowed || expectedEpoch !== this.epoch) throw new Error('Desktop action cancelled or not authorized by this ping');
      const controller = this.controller = new AbortController();
      try { return await action(controller.signal); }
      finally { if (this.controller === controller) this.controller = null; }
    });
    this.tail = job.catch(() => {});
    return job;
  }
}
