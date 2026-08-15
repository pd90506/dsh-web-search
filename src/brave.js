/**
 * Brave Search provider: the Brave Web Search API
 * (`GET {baseURL}/web/search`) mapped onto the `ctx.web` search vocabulary.
 * Brave returns `web.results[]` with `title`/`url`/`description` and an ISO
 * `page_age`; there is no provider-generated answer, so `content` stays unset.
 * @module @pd90506/dsh-web-search/brave
 */
import { WebError } from "@deepseek-ai/dsh-web";
import { errorDetail, isAbortError, resolveApiKey, searchAborted, throwIfSearchAborted } from "./shared.js";

/** Stable id this provider registers under; pin it with `searchProvider: brave`. */
export const BRAVE_PROVIDER_ID = "brave";
/** Default API root; `/web/search` is appended per request. */
export const BRAVE_DEFAULT_BASE_URL = "https://api.search.brave.com/res/v1";
/** Brave's `count` upper bound. */
export const BRAVE_MAX_COUNT = 20;
/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = "dsh-web-search/0.2.0";

/**
 * Map a Brave Web Search response to the normalized result. Dedupes by URL and
 * reads the snippet from `description` and the timestamp from `page_age`
 * (falling back to neither when Brave omits them — the seam prefers honesty
 * over invented fields). The web service owns `maxResults` truncation, so
 * `truncated` is always `false` here.
 *
 * @param {any} response - the parsed Brave response body.
 * @returns {{sources: Array<object>, truncated: false}} the normalized result.
 */
export function mapBraveResponse(response) {
	const seen = new Set();
	const sources = [];
	for (const item of response?.web?.results ?? []) {
		if (typeof item?.url !== "string" || item.url.length === 0 || seen.has(item.url)) continue;
		seen.add(item.url);
		sources.push({
			url: item.url,
			...typeof item.title === "string" && item.title.length > 0 ? { title: item.title } : {},
			...typeof item.description === "string" && item.description.length > 0 ? { snippet: item.description } : {},
			...typeof item.page_age === "string" && item.page_age.length > 0 ? { publishedAt: item.page_age } : {}
		});
	}
	return { sources, truncated: false };
}

/** The Brave-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class BraveSearchProvider {
	/** @type {string} */
	id = BRAVE_PROVIDER_ID;
	/** @type {() => object} */
	#resolveOptions;

	/**
	 * @param {() => object} resolveOptions - the options for the NEXT search,
	 * snapshotted once at each search's entry so one search never mixes two
	 * configurations. A thunk rather than a value so a hot-reloaded plugin
	 * never serves a stale endpoint.
	 */
	constructor(resolveOptions) {
		this.#resolveOptions = resolveOptions;
	}

	/** Cheap local usability check; makes no network calls. */
	available() {
		const options = this.#resolveOptions();
		return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== void 0) && URL.canParse(options.baseURL);
	}

	/**
	 * Run one search against the Brave Web Search API.
	 * @param {{query: string, maxResults?: number}} request - the normalized request.
	 * @param {AbortSignal} [signal] - cancellation for the search.
	 * @returns {Promise<{sources: Array<object>, truncated: false}>} the normalized result.
	 */
	async search(request, signal) {
		const options = this.#resolveOptions();
		const apiKey = await resolveApiKey({ ...options, label: "Brave", configNamespace: "web-search-brave-tavily" }, signal);
		throwIfSearchAborted(signal, "Brave");
		const url = new URL(`${options.baseURL}/web/search`);
		url.searchParams.set("q", request.query);
		const count = Math.min(request.maxResults ?? options.maxResults, BRAVE_MAX_COUNT);
		if (Number.isInteger(count) && count > 0) url.searchParams.set("count", String(count));
		let response;
		try {
			response = await fetch(url, {
				method: "GET",
				redirect: "error",
				headers: {
					// No manual accept-encoding: undici negotiates compression
					// itself and only auto-decompresses when it owns the header.
					"accept": "application/json",
					"x-subscription-token": apiKey,
					"user-agent": USER_AGENT
				},
				...signal !== void 0 ? { signal } : {}
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, "Brave", error);
			throw new WebError(`Brave search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			let message = `Brave API error (HTTP ${response.status})`;
			try {
				const detail = errorDetail(await response.json());
				if (detail !== void 0) message = `Brave API error (HTTP ${response.status}): ${detail}`;
			} catch (error) {
				if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, "Brave", error);
			}
			throw new WebError(message, "WEB_PROVIDER_ERROR");
		}
		try {
			return mapBraveResponse(await response.json());
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, "Brave", error);
			throw new WebError(`Brave returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
	}
}
