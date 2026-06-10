import { describe, it, expect } from 'vitest';
import { isExampleContext, isExampleFile } from '../lib/example-content.js';

describe('isExampleContext', () => {
  it('is false for empty input', () => {
    expect(isExampleContext('')).toBe(false);
  });

  it('detects example/placeholder indicators', () => {
    expect(isExampleContext('this is an example value')).toBe(true);
    expect(isExampleContext('YOUR_API_KEY')).toBe(true);
    expect(isExampleContext('value = xxxxxx')).toBe(true);
    expect(isExampleContext('a placeholder here')).toBe(true);
    expect(isExampleContext('test_token = ...')).toBe(true);
    expect(isExampleContext('<your-key>')).toBe(true);
  });

  it('is false for ordinary code/text', () => {
    expect(isExampleContext('const total = sum(values)')).toBe(false);
  });
});

describe('isExampleFile', () => {
  it('is false for empty input', () => {
    expect(isExampleFile('')).toBe(false);
  });

  it('matches example basenames', () => {
    expect(isExampleFile('/repo/.env.example')).toBe(true);
    expect(isExampleFile('template.env')).toBe(true);
  });

  it('matches example suffixes', () => {
    expect(isExampleFile('config.yaml.sample')).toBe(true);
    expect(isExampleFile('settings.dist')).toBe(true);
  });

  it('is false for real config files', () => {
    expect(isExampleFile('/repo/.env')).toBe(false);
    expect(isExampleFile('index.js')).toBe(false);
  });
});
