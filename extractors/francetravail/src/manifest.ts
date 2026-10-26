import { resolveSearchCities } from "job-ops-shared/search-cities";
import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "job-ops-shared/types/extractors";
import { runFranceTravail } from "./run";

function toProgress(event: {
  type: string;
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}): ExtractorProgressEvent {
  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `France Travail: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
    };
  }

  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: event.searchTerm,
    jobPagesEnqueued: event.jobsFoundTerm ?? 0,
    jobPagesProcessed: event.jobsFoundTerm ?? 0,
    detail: `France Travail: completed ${event.termIndex}/${event.termTotal} (${event.searchTerm}) with ${event.jobsFoundTerm ?? 0} jobs`,
  };
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOptionalInt(value: string | undefined): number | undefined {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const manifest: ExtractorManifest = {
  id: "francetravail",
  displayName: "France Travail",
  providesSources: ["francetravail"],
  requiredEnvVars: ["FRANCE_TRAVAIL_CLIENT_ID", "FRANCE_TRAVAIL_CLIENT_SECRET"],
  capabilities: { locationEvidence: true },
  locationCapabilities: {
    francetravail: { supportedCountryKeys: ["france"] },
  },
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    const result = await runFranceTravail({
      searchTerms: context.searchTerms,
      locations: resolveSearchCities({
        list: context.sourceLocationPlan?.requestedCities,
        single:
          context.settings.searchCities ?? context.settings.jobspyLocation,
      }),
      communeCodes: splitList(process.env.FRANCE_TRAVAIL_COMMUNES),
      distanceKm: parseOptionalInt(process.env.FRANCE_TRAVAIL_DISTANCE_KM),
      contractTypes: splitList(process.env.FRANCE_TRAVAIL_CONTRACT_TYPES),
      publishedSinceDays: parseOptionalInt(
        process.env.FRANCE_TRAVAIL_PUBLISHED_SINCE_DAYS,
      ),
      excludeAlternance: process.env.FRANCE_TRAVAIL_EXCLUDE_ALTERNANCE === "1",
      maxJobsPerTerm: parseOptionalInt(context.settings.jobspyResultsWanted),
      shouldCancel: context.shouldCancel,
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.(toProgress(event));
      },
    });

    if (!result.success) {
      return { success: false, jobs: [], error: result.error };
    }

    return { success: true, jobs: result.jobs };
  },
};

export default manifest;
