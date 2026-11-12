/** A model's advertised OpenRouter input and output rates, in provider-defined units. */
export interface OpenRouterPricing {
  prompt?: string;
  completion?: string;
}

/** Formats exact provider rates without guessing their billing unit. */
export function formatOpenRouterPricing(pricing?: OpenRouterPricing): string {
  const prompt = pricing?.prompt;
  const completion = pricing?.completion;
  if (prompt === undefined && completion === undefined) return 'Pricing unavailable';
  const input = prompt === undefined ? 'input rate unavailable' : `$${prompt} input`;
  const output = completion === undefined ? 'output rate unavailable' : `$${completion} output`;
  return `${input} · ${output} per billing unit`;
}
