import type { CreateJobInput } from "job-ops-shared/types/jobs";

const DEFAULT_TOKEN_URL =
  "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const DEFAULT_API_BASE_URL =
  "https://api.francetravail.io/partenaire/offresdemploi/v2";
const TOKEN_SCOPE = "api_offresdemploiv2 o2dsoffre";
const OFFER_DETAIL_URL =
  "https://candidat.francetravail.fr/offres/recherche/detail";

// The search API returns at most 150 offers per call, and refuses ranges
// that start after 1000 or end after 1149.
const PAGE_SIZE = 150;
const MAX_RANGE_START = 1000;
const MAX_RANGE_END = 1149;
const MAX_RATE_LIMIT_RETRIES = 3;
const PUBLISHED_SINCE_VALUES = new Set([1, 3, 7, 14, 31]);

// INSEE codes for the cities users are most likely to type. Any other city
// can be given as an INSEE code directly or through FRANCE_TRAVAIL_COMMUNES.
const COMMUNE_CODES: Record<string, string> = {
  albi: "81004",
  bordeaux: "33063",
  carcassonne: "11069",
  castelnaudary: "11076",
  lille: "59350",
  lyon: "69123",
  marseille: "13055",
  montauban: "82121",
  montpellier: "34172",
  nantes: "44109",
  narbonne: "11262",
  nice: "06088",
  perpignan: "66136",
  rennes: "35238",
  strasbourg: "67482",
  toulouse: "31555",
};

export type FranceTravailProgressEvent =
  | {
      type: "term_start";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
    }
  | {
      type: "term_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      jobsFoundTerm: number;
    };

export interface RunFranceTravailOptions {
  clientId?: string;
  clientSecret?: string;
  searchTerms?: string[];
  locations?: string[];
  communeCodes?: string[];
  distanceKm?: number;
  contractTypes?: string[];
  publishedSinceDays?: number;
  excludeAlternance?: boolean;
  maxJobsPerTerm?: number;
  tokenUrl?: string;
  apiBaseUrl?: string;
  onProgress?: (event: FranceTravailProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface FranceTravailResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface FranceTravailOffer {
  id?: unknown;
  intitule?: unknown;
  description?: unknown;
  dateCreation?: unknown;
  lieuTravail?: { libelle?: unknown } | null;
  entreprise?: {
    nom?: unknown;
    description?: unknown;
    url?: unknown;
  } | null;
  typeContrat?: unknown;
  typeContratLibelle?: unknown;
  experienceLibelle?: unknown;
  competences?: unknown;
  salaire?: { libelle?: unknown } | null;
  qualificationLibelle?: unknown;
  secteurActiviteLibelle?: unknown;
  nombrePostes?: unknown;
  alternance?: unknown;
  contact?: { urlPostulation?: unknown } | null;
  origineOffre?: { urlOrigine?: unknown } | null;
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toPositiveIntOrFallback(
  value: number | string | undefined,
  fallback: number,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function normalizeCityKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isInseeCode(value: string): boolean {
  return /^(\d{5}|2[AB]\d{3})$/i.test(value.trim());
}

export function resolveCommuneCodes(
  locations: string[] | undefined,
  explicitCodes: string[] | undefined,
): string[] {
  const codes = new Set<string>();
  for (const code of explicitCodes ?? []) {
    if (isInseeCode(code)) codes.add(code.trim().toUpperCase());
  }
  for (const location of locations ?? []) {
    if (isInseeCode(location)) {
      codes.add(location.trim().toUpperCase());
      continue;
    }
    const code = COMMUNE_CODES[normalizeCityKey(location)];
    if (code) codes.add(code);
  }
  return [...codes];
}

// motsCles only accepts letters, digits and a few separators.
function sanitizeKeywords(term: string): string {
  return term
    .replace(/[^\p{L}\p{N}\s+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatLocation(libelle: string | undefined): string | undefined {
  if (!libelle) return undefined;
  const withoutDepartment = libelle.replace(/^\s*\d[\dAB]?\s*-\s*/i, "").trim();
  const city = withoutDepartment || libelle;
  return `${city.charAt(0).toUpperCase()}${city.slice(1).toLowerCase()}, France`;
}

export function mapFranceTravailOffer(
  offer: FranceTravailOffer,
): CreateJobInput | null {
  const sourceJobId = stringOrUndefined(offer.id);
  if (!sourceJobId) return null;

  const jobUrl = `${OFFER_DETAIL_URL}/${encodeURIComponent(sourceJobId)}`;
  const location = formatLocation(
    stringOrUndefined(offer.lieuTravail?.libelle),
  );
  const skills = Array.isArray(offer.competences)
    ? offer.competences
        .map((competence) =>
          competence && typeof competence === "object"
            ? stringOrUndefined((competence as { libelle?: unknown }).libelle)
            : undefined,
        )
        .filter((value): value is string => Boolean(value))
    : [];

  return {
    source: "francetravail",
    sourceJobId,
    title: stringOrUndefined(offer.intitule) ?? "Unknown Title",
    employer: stringOrUndefined(offer.entreprise?.nom) ?? "Unknown Employer",
    employerUrl: stringOrUndefined(offer.entreprise?.url),
    jobUrl,
    applicationLink:
      stringOrUndefined(offer.contact?.urlPostulation) ??
      stringOrUndefined(offer.origineOffre?.urlOrigine) ??
      jobUrl,
    location,
    locationEvidence: location
      ? { location, source: "francetravail" }
      : undefined,
    salary: stringOrUndefined(offer.salaire?.libelle),
    datePosted: stringOrUndefined(offer.dateCreation),
    jobDescription: stringOrUndefined(offer.description),
    jobType:
      stringOrUndefined(offer.typeContratLibelle) ??
      stringOrUndefined(offer.typeContrat),
    jobLevel: stringOrUndefined(offer.qualificationLibelle),
    experienceRange: stringOrUndefined(offer.experienceLibelle),
    companyIndustry: stringOrUndefined(offer.secteurActiviteLibelle),
    companyDescription: stringOrUndefined(offer.entreprise?.description),
    skills: skills.length > 0 ? skills.join(", ") : undefined,
    vacancyCount:
      typeof offer.nombrePostes === "number" ? offer.nombrePostes : undefined,
  };
}

async function fetchAccessToken(args: {
  fetchImpl: typeof fetch;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const response = await args.fetchImpl(args.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: args.clientId,
      client_secret: args.clientSecret,
      scope: TOKEN_SCOPE,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(
      `France Travail authentication failed with ${response.status}`,
    );
  }

  const payload = (await response.json()) as { access_token?: unknown };
  const token = stringOrUndefined(payload.access_token);
  if (!token) {
    throw new Error("France Travail authentication returned no access token.");
  }
  return token;
}

async function fetchSearchPage(args: {
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  apiBaseUrl: string;
  token: string;
  params: URLSearchParams;
  rangeStart: number;
  rangeEnd: number;
}): Promise<FranceTravailOffer[]> {
  const url = new URL(`${args.apiBaseUrl}/offres/search`);
  for (const [key, value] of args.params) url.searchParams.set(key, value);
  url.searchParams.set("range", `${args.rangeStart}-${args.rangeEnd}`);

  for (let attempt = 0; ; attempt += 1) {
    const response = await args.fetchImpl(url.toString(), {
      headers: {
        authorization: `Bearer ${args.token}`,
        accept: "application/json",
      },
    });

    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      await args.sleep(1000 * (attempt + 1));
      continue;
    }
    if (response.status === 204) return [];
    if (!response.ok) {
      throw new Error(`France Travail search failed with ${response.status}`);
    }

    const payload = (await response.json()) as { resultats?: unknown };
    return Array.isArray(payload.resultats)
      ? (payload.resultats as FranceTravailOffer[])
      : [];
  }
}

function buildSearchParams(args: {
  searchTerm: string;
  communeCode: string | null;
  distanceKm: number;
  contractTypes: string[];
  publishedSinceDays: number | undefined;
}): URLSearchParams {
  const params = new URLSearchParams();
  const keywords = sanitizeKeywords(args.searchTerm);
  if (keywords) params.set("motsCles", keywords);
  if (args.communeCode) {
    params.set("commune", args.communeCode);
    params.set("distance", String(args.distanceKm));
  }
  if (args.contractTypes.length > 0) {
    params.set("typeContrat", args.contractTypes.join(","));
  }
  if (
    args.publishedSinceDays !== undefined &&
    PUBLISHED_SINCE_VALUES.has(args.publishedSinceDays)
  ) {
    params.set("publieeDepuis", String(args.publishedSinceDays));
  }
  return params;
}

export async function runFranceTravail(
  options: RunFranceTravailOptions = {},
): Promise<FranceTravailResult> {
  const clientId =
    options.clientId ?? process.env.FRANCE_TRAVAIL_CLIENT_ID?.trim();
  const clientSecret =
    options.clientSecret ?? process.env.FRANCE_TRAVAIL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return {
      success: false,
      jobs: [],
      error:
        "Missing France Travail credentials (FRANCE_TRAVAIL_CLIENT_ID / FRANCE_TRAVAIL_CLIENT_SECRET)",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const searchTerms =
    options.searchTerms && options.searchTerms.length > 0
      ? options.searchTerms
      : ["informatique"];
  const maxJobsPerTerm = Math.min(
    toPositiveIntOrFallback(options.maxJobsPerTerm, 50),
    MAX_RANGE_END + 1,
  );
  const communeCodes = resolveCommuneCodes(
    options.locations,
    options.communeCodes,
  );
  const runCommunes = communeCodes.length > 0 ? communeCodes : [null];
  const distanceKm = toPositiveIntOrFallback(options.distanceKm, 30);
  const contractTypes = (options.contractTypes ?? [])
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  try {
    const token = await fetchAccessToken({
      fetchImpl,
      tokenUrl: options.tokenUrl ?? DEFAULT_TOKEN_URL,
      clientId,
      clientSecret,
    });
    const apiBaseUrl = options.apiBaseUrl ?? DEFAULT_API_BASE_URL;
    const jobs: CreateJobInput[] = [];
    const seen = new Set<string>();

    for (const [index, searchTerm] of searchTerms.entries()) {
      if (options.shouldCancel?.()) return { success: true, jobs };

      options.onProgress?.({
        type: "term_start",
        termIndex: index + 1,
        termTotal: searchTerms.length,
        searchTerm,
      });

      let jobsFoundTerm = 0;
      for (const communeCode of runCommunes) {
        const params = buildSearchParams({
          searchTerm,
          communeCode,
          distanceKm,
          contractTypes,
          publishedSinceDays: options.publishedSinceDays,
        });
        let collectedForCommune = 0;

        for (
          let rangeStart = 0;
          rangeStart <= MAX_RANGE_START && collectedForCommune < maxJobsPerTerm;
          rangeStart += PAGE_SIZE
        ) {
          if (options.shouldCancel?.()) return { success: true, jobs };

          const rangeEnd = Math.min(rangeStart + PAGE_SIZE - 1, MAX_RANGE_END);
          const offers = await fetchSearchPage({
            fetchImpl,
            sleep,
            apiBaseUrl,
            token,
            params,
            rangeStart,
            rangeEnd,
          });

          for (const offer of offers) {
            if (collectedForCommune >= maxJobsPerTerm) break;
            if (options.excludeAlternance && offer.alternance === true)
              continue;
            const mapped = mapFranceTravailOffer(offer);
            if (!mapped) continue;
            const dedupeKey = mapped.sourceJobId || mapped.jobUrl;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            jobs.push(mapped);
            collectedForCommune += 1;
            jobsFoundTerm += 1;
          }

          if (offers.length < rangeEnd - rangeStart + 1) break;
        }
      }

      options.onProgress?.({
        type: "term_complete",
        termIndex: index + 1,
        termTotal: searchTerms.length,
        searchTerm,
        jobsFoundTerm,
      });
    }

    return { success: true, jobs };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unexpected error while running France Travail extractor.";
    return { success: false, jobs: [], error: message };
  }
}
