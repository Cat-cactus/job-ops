import { describe, expect, it, vi } from "vitest";
import { resolveCommuneCodes, runFranceTravail } from "../src/run";

function createResponse(status: number, payload?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

const tokenResponse = createResponse(200, { access_token: "test-token" });

function offer(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    intitule: "Analyste SOC H/F",
    description: "Surveillance et qualification des alertes.",
    dateCreation: "2026-10-20T09:00:00.000Z",
    lieuTravail: { libelle: "31 - TOULOUSE" },
    entreprise: { nom: "Acme Cyber" },
    typeContrat: "CDI",
    typeContratLibelle: "Contrat à durée indéterminée",
    experienceLibelle: "Débutant accepté",
    competences: [{ libelle: "Analyser des logs" }, { libelle: "SIEM" }],
    salaire: { libelle: "Annuel de 36000 Euros à 42000 Euros" },
    alternance: false,
    ...overrides,
  };
}

describe("runFranceTravail", () => {
  it("fails fast without credentials", async () => {
    const fetchMock = vi.fn();
    const result = await runFranceTravail({
      clientId: "",
      clientSecret: "",
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("FRANCE_TRAVAIL_CLIENT_ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("authenticates, searches around a city and maps offers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(createResponse(206, { resultats: [offer("1")] }));

    const result = await runFranceTravail({
      clientId: "id",
      clientSecret: "secret",
      searchTerms: ["analyste soc"],
      locations: ["Toulouse"],
      distanceKm: 50,
      contractTypes: ["cdi", "CDD"],
      publishedSinceDays: 7,
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toEqual([
      expect.objectContaining({
        source: "francetravail",
        sourceJobId: "1",
        title: "Analyste SOC H/F",
        employer: "Acme Cyber",
        location: "Toulouse, France",
        jobUrl: "https://candidat.francetravail.fr/offres/recherche/detail/1",
        jobType: "Contrat à durée indéterminée",
        skills: "Analyser des logs, SIEM",
        salary: "Annuel de 36000 Euros à 42000 Euros",
      }),
    ]);

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toContain("realm=%2Fpartenaire");
    expect(String(tokenInit.body)).toContain("grant_type=client_credentials");

    const searchUrl = new URL(fetchMock.mock.calls[1][0]);
    expect(searchUrl.pathname).toBe(
      "/partenaire/offresdemploi/v2/offres/search",
    );
    expect(searchUrl.searchParams.get("motsCles")).toBe("analyste soc");
    expect(searchUrl.searchParams.get("commune")).toBe("31555");
    expect(searchUrl.searchParams.get("distance")).toBe("50");
    expect(searchUrl.searchParams.get("typeContrat")).toBe("CDI,CDD");
    expect(searchUrl.searchParams.get("publieeDepuis")).toBe("7");
    expect(searchUrl.searchParams.get("range")).toBe("0-149");
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe(
      "Bearer test-token",
    );
  });

  it("de-duplicates offers found around several cities and skips alternance", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(
        createResponse(200, {
          resultats: [offer("1"), offer("2", { alternance: true })],
        }),
      )
      .mockResolvedValueOnce(
        createResponse(200, { resultats: [offer("1"), offer("3")] }),
      );

    const result = await runFranceTravail({
      clientId: "id",
      clientSecret: "secret",
      searchTerms: ["csirt"],
      locations: ["Toulouse", "Carcassonne"],
      excludeAlternance: true,
      fetchImpl: fetchMock,
    });

    expect(result.jobs.map((job) => job.sourceJobId)).toEqual(["1", "3"]);
    expect(
      new URL(fetchMock.mock.calls[2][0]).searchParams.get("commune"),
    ).toBe("11069");
  });

  it("paginates until a short page and treats 204 as empty", async () => {
    const fullPage = Array.from({ length: 150 }, (_, index) =>
      offer(`p${index}`),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(createResponse(206, { resultats: fullPage }))
      .mockResolvedValueOnce(createResponse(204));

    const result = await runFranceTravail({
      clientId: "id",
      clientSecret: "secret",
      searchTerms: ["soc"],
      maxJobsPerTerm: 400,
      fetchImpl: fetchMock,
    });

    expect(result.jobs).toHaveLength(150);
    expect(new URL(fetchMock.mock.calls[2][0]).searchParams.get("range")).toBe(
      "150-299",
    );
  });

  it("retries rate-limited searches", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(createResponse(429))
      .mockResolvedValueOnce(createResponse(200, { resultats: [offer("1")] }));

    const result = await runFranceTravail({
      clientId: "id",
      clientSecret: "secret",
      searchTerms: ["soc"],
      fetchImpl: fetchMock,
      sleep,
    });

    expect(result.jobs).toHaveLength(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("reports authentication failures", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(createResponse(401));

    const result = await runFranceTravail({
      clientId: "id",
      clientSecret: "wrong",
      fetchImpl: fetchMock,
    });

    expect(result).toEqual({
      success: false,
      jobs: [],
      error: "France Travail authentication failed with 401",
    });
  });
});

describe("resolveCommuneCodes", () => {
  it("maps known cities, accepts INSEE codes and ignores unknown cities", () => {
    expect(
      resolveCommuneCodes(
        ["Toulouse", "Carcassonne", "Nowhere", "2A004"],
        ["11076"],
      ),
    ).toEqual(["11076", "31555", "11069", "2A004"]);
  });
});
