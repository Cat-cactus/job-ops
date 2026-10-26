import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/run", () => ({
  runFranceTravail: vi.fn(),
}));

describe("francetravail manifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("forwards run settings and env options to the runner", async () => {
    vi.stubEnv("FRANCE_TRAVAIL_DISTANCE_KM", "50");
    vi.stubEnv("FRANCE_TRAVAIL_CONTRACT_TYPES", "CDI,CDD");
    vi.stubEnv("FRANCE_TRAVAIL_COMMUNES", "11076");
    vi.stubEnv("FRANCE_TRAVAIL_EXCLUDE_ALTERNANCE", "1");

    const { manifest } = await import("../src/manifest");
    const { runFranceTravail } = await import("../src/run");
    const runMock = vi.mocked(runFranceTravail);
    runMock.mockResolvedValue({ success: true, jobs: [] });

    await manifest.run({
      source: "francetravail",
      selectedSources: ["francetravail"],
      settings: {
        jobspyResultsWanted: "80",
        searchCities: "Toulouse|Carcassonne",
      },
      searchTerms: ["analyste soc"],
      selectedCountry: "france",
    });

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        searchTerms: ["analyste soc"],
        locations: ["Toulouse", "Carcassonne"],
        communeCodes: ["11076"],
        distanceKm: 50,
        contractTypes: ["CDI", "CDD"],
        excludeAlternance: true,
        maxJobsPerTerm: 80,
      }),
    );
  });
});
