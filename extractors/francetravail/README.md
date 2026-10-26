# France Travail Extractor

Extractor for the official France Travail "Offres d'emploi v2" API.

## Notes

- Requires `FRANCE_TRAVAIL_CLIENT_ID` and `FRANCE_TRAVAIL_CLIENT_SECRET` from an application created on https://francetravail.io and subscribed to "Offres d'emploi v2".
- Only runs for France. Selected cities are resolved to INSEE codes and searched with `FRANCE_TRAVAIL_DISTANCE_KM` (default 30 km); without a known city it searches all of France.
- Optional filters: `FRANCE_TRAVAIL_CONTRACT_TYPES`, `FRANCE_TRAVAIL_COMMUNES`, `FRANCE_TRAVAIL_PUBLISHED_SINCE_DAYS`, `FRANCE_TRAVAIL_EXCLUDE_ALTERNANCE`.
- The API caps a single search at 1,150 offers (ranges of 150).
