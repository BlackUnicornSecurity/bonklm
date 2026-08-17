import type { ResponseExtractor } from './types.js';

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

function hasCallable(payload: object, key: PropertyKey): boolean {
  return key in payload && typeof (payload as Record<PropertyKey, unknown>)[key] === 'function';
}

export function isUninspectableResponsePayload(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  if (hasCallable(payload, 'pipe') || hasCallable(payload, 'getReader')) return true;
  if (hasCallable(payload, Symbol.asyncIterator)) return true;
  return hasCallable(payload, 'arrayBuffer') && hasCallable(payload, 'text') && 'body' in payload;
}

export const defaultResponseExtractor: ResponseExtractor = (payload: unknown): string => {
  if (typeof payload === 'string') return payload;
  if (Buffer.isBuffer(payload) || payload instanceof Uint8Array) return UTF8_DECODER.decode(payload);
  if (payload === null || payload === undefined) return '';
  if (isUninspectableResponsePayload(payload)) {
    throw new TypeError('Streaming and web responses require a custom responseExtractor');
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
};

export function extractRequestContent(body: unknown): string {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return UTF8_DECODER.decode(body);
  if (body === null || body === undefined) return '';
  if (typeof body !== 'object') return String(body);
  const serialized = JSON.stringify(body);
  if (serialized === undefined) throw new Error('Request body could not be serialized for validation');
  return serialized;
}
