/**
 * NecroTalk interpreter error type.
 * Always carries the source line and column where the error occurred.
 * The message is pre-formatted via formatError.
 */
export class NecroTalkError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(message);
    this.name = 'NecroTalkError';
  }
}

/**
 * Format an error message in the steering format: "Line N: msg."
 * The msg argument must NOT itself end with a period.
 */
export function formatError(line: number, _column: number, msg: string): string {
  return `Line ${line}: ${msg}.`;
}
