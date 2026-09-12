export const structuredDataSchema = {
  type: 'object', additionalProperties: false,
  required: ['@context', '@type', 'headline', 'datePublished', 'dateModified', 'author', 'description', 'url', 'mainEntityOfPage', 'inLanguage'],
  properties: {
    '@context': { type: 'string', const: 'https://schema.org' },
    '@type': { type: 'string', const: 'NewsArticle' },
    headline: { type: 'string' }, datePublished: { type: ['string', 'null'] },
    dateModified: { type: 'string' },
    author: { type: 'object', additionalProperties: false, required: ['@type', 'name'],
      properties: { '@type': { type: 'string', const: 'Person' }, name: { type: 'string' } } },
    image: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' }, url: { type: 'string' },
    mainEntityOfPage: { type: 'object', additionalProperties: false, required: ['@type', '@id'],
      properties: { '@type': { type: 'string', const: 'WebPage' }, '@id': { type: 'string' } } },
    inLanguage: { type: 'string', const: 'fa-IR' },
  },
} as const;
