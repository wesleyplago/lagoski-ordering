/**
 * Contrato: os eventos que este serviço produz validam contra os JSON Schemas
 * publicados no lagoski-contracts (Published Language). Roda com
 * CONTRACTS_DIR apontando para um checkout do repositório de contratos; sem
 * ele, o teste é pulado (o CI sempre define).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { contractSamples } from '../src/contracts/samples.js';

const dir = process.env.CONTRACTS_DIR;

describe.skipIf(!dir)('contratos de eventos (ordering)', () => {
  const ajv = new Ajv2020.default({ allErrors: true, strict: false });
  addFormats.default(ajv);

  if (contractSamples().length === 0) it('não publica eventos', () => expect(contractSamples()).toEqual([]));

  for (const sample of contractSamples()) {
    it(`${sample.type} segue o schema publicado`, () => {
      const validateEnvelope = ajv.getSchema('cloudevent') ?? (ajv.addSchema(JSON.parse(readFileSync(join(dir!, 'schemas', 'cloudevent.json'), 'utf8')), 'cloudevent'), ajv.getSchema('cloudevent')!);
      const [, context, ...rest] = sample.type.split('.');
      const version = rest.pop();
      const file = join(dir!, 'schemas', context!, `${rest.join('.')}.${version}.json`);
      expect(existsSync(file), `schema ${file} existe`).toBe(true);
      const validateData = ajv.compile(JSON.parse(readFileSync(file, 'utf8')));
      expect(validateEnvelope(sample), JSON.stringify(validateEnvelope.errors)).toBe(true);
      expect(validateData(sample.data), JSON.stringify(validateData.errors)).toBe(true);
    });
  }
});
