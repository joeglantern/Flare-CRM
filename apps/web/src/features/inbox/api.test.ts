import { describe, expect, it } from 'vitest';
import type { ChannelDto } from '@crm/shared';
import { countPlaceholders, templatesOf } from './api';

function channelWith(config: Record<string, unknown>): ChannelDto {
  return {
    id: 'c1',
    type: 'whatsapp',
    name: 'Test channel',
    externalId: null,
    config,
    hasSecrets: false,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('countPlaceholders', () => {
  it('counts the distinct {{n}} placeholders in a template body', () => {
    expect(countPlaceholders('Hi {{1}}, your order {{2}} shipped.')).toBe(2);
    expect(countPlaceholders('No placeholders here.')).toBe(0);
    expect(countPlaceholders('{{1}} appears twice: {{1}}')).toBe(1);
    expect(countPlaceholders(undefined)).toBe(0);
    expect(countPlaceholders(42)).toBe(0);
  });
});

describe('templatesOf', () => {
  it('reads templates recorded on the channel, deriving params from the body', () => {
    const channel = channelWith({
      templates: [{ name: 'order_update', language: 'en', body: 'Order {{1}} is {{2}}.' }],
    });
    expect(templatesOf(channel)).toEqual([
      { name: 'order_update', language: 'en', body: 'Order {{1}} is {{2}}.', params: 2 },
    ]);
  });

  it('defaults the language and trusts an explicit params count over the body', () => {
    const channel = channelWith({ templates: [{ name: 'no_lang', params: 5 }] });
    expect(templatesOf(channel)).toEqual([{ name: 'no_lang', language: 'en', params: 5 }]);
  });

  it('drops entries with no usable name rather than fabricating one', () => {
    const channel = channelWith({ templates: [{ language: 'en' }, 'not an object', 42, null] });
    expect(templatesOf(channel)).toEqual([]);
  });

  it('returns nothing for an undefined channel or a config with no templates array', () => {
    expect(templatesOf(undefined)).toEqual([]);
    expect(templatesOf(channelWith({}))).toEqual([]);
    expect(templatesOf(channelWith({ templates: 'not an array' }))).toEqual([]);
  });
});
