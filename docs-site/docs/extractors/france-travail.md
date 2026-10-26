---
id: france-travail
title: France Travail Extractor
description: France job search through the official France Travail Offres d'emploi v2 API.
sidebar_position: 12
---

## What it is

Original website: [France Travail](https://candidat.francetravail.fr/offres/emploi)

This extractor calls the official France Travail "Offres d'emploi v2" API with OAuth2 client credentials and maps offers into the job-ops schema.

Implementation split:

1. `extractors/francetravail/src/run.ts` authenticates, resolves cities to INSEE commune codes, paginates `/offres/search` and maps offers into `CreateJobInput`.
2. `extractors/francetravail/src/manifest.ts` adapts pipeline settings and environment options, emits progress updates, and registers the source for runtime discovery.

## Why it exists

France Travail publishes most French job offers, including offers relayed from partner boards, through a free official API. Using the API avoids scraping and anti-bot issues.

## How to use it

1. Create an application on [francetravail.io](https://francetravail.io) and subscribe it to **Offres d'emploi v2**.
2. Set `FRANCE_TRAVAIL_CLIENT_ID` and `FRANCE_TRAVAIL_CLIENT_SECRET` in `.env`.
3. Open **Run jobs**, choose **Automatic**, select **France** and enable **France Travail** in **Sources**.
4. Optional environment controls:
   - `FRANCE_TRAVAIL_DISTANCE_KM`: radius around each selected city (default 30).
   - `FRANCE_TRAVAIL_CONTRACT_TYPES`: for example `CDI,CDD`.
   - `FRANCE_TRAVAIL_COMMUNES`: extra INSEE codes for cities not resolved by name.
   - `FRANCE_TRAVAIL_PUBLISHED_SINCE_DAYS`: `1`, `3`, `7`, `14` or `31`.
   - `FRANCE_TRAVAIL_EXCLUDE_ALTERNANCE=1`: drop work-study offers.

## Common problems

### Authentication failed with 401

- Check the client id and secret, and that the application is subscribed to **Offres d'emploi v2**.

### A city returns offers from all of France

- The city name was not resolved to an INSEE code. Add its code to `FRANCE_TRAVAIL_COMMUNES` or type the code as the city.

## Related pages

- [Extractors Overview](/docs/next/extractors/overview)
- [Add an Extractor](/docs/next/workflows/add-an-extractor)
