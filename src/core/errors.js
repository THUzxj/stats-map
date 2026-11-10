export class StatsMapError extends Error {
  constructor(message, code = 'INVALID_RESOURCE', details = []) {
    super(message); this.name = 'StatsMapError'; this.code = code; this.details = details;
  }
}
export function fail(message, code, details = []) { throw new StatsMapError(message, code, details); }
export function assert(condition, message, code, details) { if (!condition) fail(message, code, details); }
export function refKey(ref) { return `${ref.kind ? `${ref.kind}:` : ''}${ref.id}@${ref.revision}`; }
