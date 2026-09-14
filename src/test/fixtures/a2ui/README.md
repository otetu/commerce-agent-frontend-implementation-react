# CPD activity replay fixtures

These generic fixtures exercise A2UI/SSE lifecycle sequences using fictional products, sequential activity IDs, and reserved example.com URLs. They contain no customer names, catalog records, environment identifiers, prompts, credentials, or internal issue references.

- `populated.json`: a carousel placeholder is replaced by a surface with 12 example products.
- `empty-carousel.json`: a carousel placeholder is cleared by an empty replacement while next actions remain.
- `no-match.json`: a bundle placeholder is cleared by the same mechanism.

The fixtures preserve operation ordering, valueMap binding structure, product counts, and activity/surface identity relationships needed for regression coverage. Business content and identifiers are synthetic; these files are not raw response captures.

An identified activity snapshot replaces its complete operations list (including an empty list); independent activities remain present. Carousel placeholders can omit isLoading. RUN_FINISHED marks completion. Additional tests cover explicit loading flags and other supported operation sequences.
