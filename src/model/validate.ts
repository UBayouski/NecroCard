import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import schema from './stack.schema.json';
import type { Stack } from './types.js';

// strictTypes: false — ajv fires on $ref-only root schemas even though the schema is valid
// JSON Schema 2020-12. All other strict checks remain enabled.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
const validateFn = ajv.compile(schema);

export class ValidationError extends Error {
  public readonly errors: ErrorObject[];

  constructor(errors: ErrorObject[]) {
    super(
      'Stack validation failed:\n' +
        errors
          .map((e) => `  ${e.instancePath || '(root)'} ${e.message ?? ''}`)
          .join('\n'),
    );
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/**
 * Validate an unknown value against the Stack JSON schema.
 * Returns a typed Stack if valid; throws ValidationError otherwise.
 */
export function validateStack(value: unknown): Stack {
  if (!validateFn(value)) {
    throw new ValidationError(validateFn.errors ?? []);
  }
  return value as Stack;
}
