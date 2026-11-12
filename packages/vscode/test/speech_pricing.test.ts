import { expect, it } from 'vitest';
import { formatOpenRouterPricing } from '../src/speech_pricing';

it('shows both advertised rates exactly, including zero and very small prices', () => {
  expect(formatOpenRouterPricing({ prompt: '0.000015', completion: '0' })).toBe('$0.000015 input · $0 output per billing unit');
  expect(formatOpenRouterPricing({ prompt: '0.00000062', completion: '0.000000000001' })).toBe(
    '$0.00000062 input · $0.000000000001 output per billing unit',
  );
  expect(formatOpenRouterPricing({ prompt: '0', completion: '0' })).toBe('$0 input · $0 output per billing unit');
});

it('identifies missing rates without treating them as free', () => {
  expect(formatOpenRouterPricing({ completion: '0.0025' })).toBe('input rate unavailable · $0.0025 output per billing unit');
  expect(formatOpenRouterPricing({ prompt: '1e-9' })).toBe('$1e-9 input · output rate unavailable per billing unit');
  expect(formatOpenRouterPricing({})).toBe('Pricing unavailable');
  expect(formatOpenRouterPricing(undefined)).toBe('Pricing unavailable');
});
