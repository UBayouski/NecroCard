import { describe, expect, it } from 'vitest';
import { parseOrigins, readConfig } from './config.js';

describe('readConfig', () => {
  it('uses the defaults for an empty environment', () => {
    expect(readConfig({})).toEqual({
      apiKey: null,
      model: 'gemini-3.5-flash-lite',
      dailyCap: 100,
      perIpCap: 10,
      allowedOrigins: ['http://localhost:5173', 'http://localhost:5174'],
      port: 8787,
    });
  });

  it('reads every variable', () => {
    expect(
      readConfig({
        GEMINI_API_KEY: ' k ', GEMINI_MODEL: 'gemini-3.8-flash', DAILY_CAP: '5', PER_IP_CAP: '0',
        ALLOWED_ORIGINS: 'https://necrocard.onrender.com/, http://localhost:5173', PORT: '10000',
      }),
    ).toEqual({
      apiKey: 'k',
      model: 'gemini-3.8-flash',
      dailyCap: 5,
      perIpCap: 0,
      allowedOrigins: ['https://necrocard.onrender.com', 'http://localhost:5173'],
      port: 10000,
    });
  });

  it('an empty key is missing', () => {
    expect(readConfig({ GEMINI_API_KEY: '  ' }).apiKey).toBeNull();
  });

  it('warns and falls back on invalid values', () => {
    const warnings: string[] = [];
    const config = readConfig(
      { GEMINI_MODEL: '../x', DAILY_CAP: '-1', PER_IP_CAP: '2.5', PORT: '70000' },
      m => warnings.push(m),
    );
    expect(config).toMatchObject({ model: 'gemini-3.5-flash-lite', dailyCap: 100, perIpCap: 10, port: 8787 });
    expect(warnings).toHaveLength(4);
  });

  it('parseOrigins drops empty entries', () => {
    expect(parseOrigins(' , a ,,b/ ')).toEqual(['a', 'b']);
    expect(readConfig({ ALLOWED_ORIGINS: '' }).allowedOrigins).toEqual([]);
  });
});
