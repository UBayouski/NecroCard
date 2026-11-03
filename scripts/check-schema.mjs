import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'fs';

const schema = JSON.parse(readFileSync('./src/model/stack.schema.json', 'utf8'));
// strict: true enables strictTypes which conflicts with $ref + sibling keywords in some versions.
// Use strict mode but disable strictTypes; the schema itself is valid JSON Schema 2020-12.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
try {
  ajv.compile(schema);
  console.log('Schema compiled OK');
} catch (e) {
  console.error('Schema compile error:', e.message);
  process.exit(1);
}
