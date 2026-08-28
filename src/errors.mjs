export class HarnessError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "HarnessError";
    this.code = code;
    this.details = details;
  }
}

export function assert(condition, code, message, details) {
  if (!condition) throw new HarnessError(code, message, details);
}
