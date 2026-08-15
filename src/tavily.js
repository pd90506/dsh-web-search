/**
 * Tavily provider: the Tavily Search API (`POST {baseURL}/search`) mapped onto
 * the `ctx.web` search vocabulary. Tavily returns `results[]` with
 * `title`/`url`/`content` plus an optional generated `answer`, which is
 * surfaced as the result's `content` (like Perplexity's, unlike Brave's).
 * @module @pd90506/dsh-web-search/tavily
 */
import { WebError } from "@deepseek-ai/dsh-web";
import { errorDetail, isAbortError, resolveApiKey, searchAborted, throwIfSearchAborted } from "./shared.js";

/** Stable id this provider registers under; pin it with `searchProvider: tavily`. */
export const TAVILY_PROVIDER_ID = "tavily";
/** Default API root; `/search` is appended per request. */
export const TAVILY_DEFAULT_BASE_URL = "https://api.tavily.com";
/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = "dsh-web-search/0.2.0";

/**
 * Map a Tavily Search response to the normalized result. Dedupes by URL, reads
 * the snippet from `content` and the timestamp from `published_date` when
 * present, and carries a non-empty `answer` as the result's `content`. The web
 * service owns `maxResults` truncation, so `truncated` is always `false` here.
 *
 * @param {any} response - the parsed Tavily response body.
 * @returns {{content?: string, sources: Array<object>, truncated: false}} the normalized result.
 */
export function mapTavilyResponse(response) {
	const seen = new Set();
	const sources = [];
	for (const item of response?.results ?? []) {
		if (typeof item?.url !== "string" || item.url.length === 0 || seen.has(item.url)) continue;
		seen.add(item.url);
		sources.push({
			url: item.url,
			...typeof item.title === "string" && item.title.length > 0 ? { title: item.title } : {},
			...typeof item.content === "string" && item.content.length > 0 ? { snippet: item.content } : {},
			...typeof item.published_date === "string" && item.published_date.length > 0 ? { publishedAt: item.published_date } : {}
		});
	}
	return {
		...typeof response?.answer === "string" && response.answer.length > 0 ? { content: response.answer } : {},
		sources,
		truncated: false
	};
}

/** The Tavily-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class TavilySearchProvider {
	/** @type {string} */
	id = TAVILY_PROVIDER_ID;
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
	 * Run one search against the Tavily Search API.
	 * @param {{query: string, maxResults?: number}} request - the normalized request.
	 * @param {AbortSignal} [signal] - cancellation for the search.
	 * @returns {Promise<{content?: string, sources: Array<object>, truncated: false}>} the normalized result.
	 */
	async search(request, signal) {
		const options = this.#resolveOptions();
		const apiKey = await resolveApiKey({ ...options, label: "Tavily", configNamespace: "web-search-brave-tavily" }, signal);
		throwIfSearchAborted(signal, "Tavily");
		const endpoint = `${options.baseURL}/search`;
		const maxResults = request.maxResults ?? options.maxResults;
		const body = {
			query: request.query,
			search_depth: options.searchDepth,
			include_answer: options.includeAnswer,
			...Number.isInteger(maxResults) && maxResults > 0 ? { max_results: maxResults } : {}
		};
		let response;
		try {
			response = await fetch(endpoint, {
				method: "POST",
				redirect: "error",
				headers: {
					"authorization": `Bearer ${apiKey}`,
					"content-type": "application/json",
					"accept": "application/json",
					"user-agent": USER_AGENT
				},
				body: JSON.stringify(body),
				...signal !== void 0 ? { signal } : {}
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, "Tavily", error);
			throw new WebError(`Tavily search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			let message = `Tavily API error (HTTP ${response.status})`;
			try {
				const detail = errorDetail(await response.json());
				if (detail !== void 0) message = `Tavily API error (HTTP ${response.status}): ${detail}`;
			} catch (error) {
				if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, "Tavily", error);
			}
			throw new WebError(message, "WEB_PROVIDER_ERROR");
		}
		try {
			return mapTavilyResponse(await response.json());
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, "Tavily", error);
			throw new WebError(`Tavily returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
	}
}
