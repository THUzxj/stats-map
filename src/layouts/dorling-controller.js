import { dorlingLayout } from './dorling.js';
import { dorlingWorkerUrl } from './worker-url.js';

export class DorlingSimulation {
  constructor(options = {}) { this.options = {...options}; this.worker = null; this.generation = 0; this.pending = null; }
  start(nodes) {
    this.cancel();
    const generation = ++this.generation;
    return new Promise((resolve, reject) => {
      const request = {generation, nodes, resolve, reject};
      this.pending = request;
      const finish = (result, error) => {
        if (this.pending !== request) return;
        this.pending = null;
        if (this.worker) { this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null; this.worker.terminate(); this.worker = null; }
        if (error) reject(error); else resolve(result);
      };
      if (typeof Worker === 'undefined' || this.options.worker === false) {
        queueMicrotask(() => {
          if (this.pending !== request) return;
          try { finish({status:'done', nodes:dorlingLayout(nodes, this.options)}); }
          catch (error) { finish(null, error); }
        });
        return;
      }
      try {
        const worker = new Worker(dorlingWorkerUrl, {type:'module'});
        this.worker = worker;
        worker.onmessage = event => {
          if (event.data?.requestId !== generation) return;
          if (event.data.status === 'failed') finish(null, new Error(event.data.error));
          else finish(event.data);
        };
        worker.onerror = event => finish(null, event.error ?? new Error(event.message));
        worker.onmessageerror = () => finish(null, new Error('Dorling worker message could not be decoded'));
        worker.postMessage({requestId:generation, nodes, options:this.options});
      } catch (error) { finish(null, error); }
    });
  }
  cancel() {
    this.generation++;
    if (this.worker) { this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null; this.worker.terminate(); this.worker = null; }
    if (this.pending) { const {resolve, nodes} = this.pending; this.pending = null; resolve({status:'cancelled', nodes}); }
  }
  destroy() { this.cancel(); }
}
