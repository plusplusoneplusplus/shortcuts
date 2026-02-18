import { describe, it, expect } from 'vitest';
import {
  nonEmptyString,
  portNumber,
  filePath,
  absolutePath,
  withDefaults
} from '../../src/validation/schemas';

describe('validation schemas', () => {
  describe('nonEmptyString', () => {
    it('accepts non-empty strings', () => {
      expect(nonEmptyString.parse('hello')).toBe('hello');
    });

    it('rejects empty strings', () => {
      expect(() => nonEmptyString.parse('')).toThrow();
    });

    it('rejects non-string types', () => {
      expect(() => nonEmptyString.parse(123)).toThrow();
      expect(() => nonEmptyString.parse(null)).toThrow();
    });
  });

  describe('portNumber', () => {
    it('accepts valid port numbers', () => {
      expect(portNumber.parse(80)).toBe(80);
      expect(portNumber.parse(8080)).toBe(8080);
      expect(portNumber.parse(1)).toBe(1);
      expect(portNumber.parse(65535)).toBe(65535);
    });

    it('rejects port 0', () => {
      expect(() => portNumber.parse(0)).toThrow();
    });

    it('rejects ports above 65535', () => {
      expect(() => portNumber.parse(70000)).toThrow();
    });

    it('rejects non-integer ports', () => {
      expect(() => portNumber.parse(80.5)).toThrow();
    });

    it('rejects negative ports', () => {
      expect(() => portNumber.parse(-1)).toThrow();
    });
  });

  describe('filePath', () => {
    it('accepts non-empty file paths', () => {
      expect(filePath.parse('./src/index.ts')).toBe('./src/index.ts');
      expect(filePath.parse('/absolute/path')).toBe('/absolute/path');
    });

    it('rejects empty strings', () => {
      expect(() => filePath.parse('')).toThrow();
    });
  });

  describe('absolutePath', () => {
    it('accepts Unix absolute paths', () => {
      expect(absolutePath.parse('/usr/bin')).toBe('/usr/bin');
      expect(absolutePath.parse('/home/user/file.txt')).toBe('/home/user/file.txt');
    });

    it('accepts Windows absolute paths', () => {
      expect(absolutePath.parse('C:\\Users')).toBe('C:\\Users');
      expect(absolutePath.parse('D:\\Projects\\app')).toBe('D:\\Projects\\app');
    });

    it('rejects relative paths', () => {
      expect(() => absolutePath.parse('./relative')).toThrow();
      expect(() => absolutePath.parse('relative/path')).toThrow();
      expect(() => absolutePath.parse('../parent')).toThrow();
    });

    it('rejects empty strings', () => {
      expect(() => absolutePath.parse('')).toThrow();
    });
  });

  describe('withDefaults', () => {
    it('applies default values when undefined', () => {
      const schema = withDefaults(portNumber, 3000);
      expect(schema.parse(undefined)).toBe(3000);
    });

    it('uses provided value over default', () => {
      const schema = withDefaults(portNumber, 3000);
      expect(schema.parse(8080)).toBe(8080);
    });

    it('works with string schemas', () => {
      const schema = withDefaults(nonEmptyString, 'default');
      expect(schema.parse(undefined)).toBe('default');
      expect(schema.parse('custom')).toBe('custom');
    });
  });
});
