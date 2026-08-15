/**
 * Shared cancellation and error helpers for the search providers in this
 * package, mirroring the semantics of `@deepseek-ai/dsh-web-search-deepseek`:
 * caller aborts surface as `WEB_ABORTED`, credential gaps as
 * `WEB_PROVIDER_CREDENTIAL_MISSING`, and every backend failure as
 * `WEB_PROVIDER_ERROR`. Consumers route on the `code`, never the message.
 * @module @pd90506/dsh-web-search/shared
 */
import { WebError } from "@deepseek-ai/dsh-web";

/**
 * Throw the provider's stable cancellation error when the caller already aborted.
 * @param {AbortSignal | undefined} signal - the surrounding search's signal.
 * @param {string} label - provider label used in the error message.
 */
export function throwIfSearchAborted(signal, label) {
	if (signal?.aborted === true) throw searchAborted(signal, label);
}

/**
 * Build the provider's stable cancellation error while retaining the caller's reason.
 * @param {AbortSignal | undefined} signal - the aborted signal.
 * @param {string} label - provider label used in the error message.
 * @param {unknown} [fallback] - cause when the signal carries no reason.
 * @returns {WebError} the abort error to throw.
 */
export function searchAborted(signal, label, fallback) {
	return new WebError(`${label} search aborted`, "WEB_ABORTED", {
		cause: signal?.aborted === true ? signal.reason : fallback
	});
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
export function isAbortError(error) {
	return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Race a same-process asynchronous preflight against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become unhandled.
 * @param {Promise<T>} operation - the preflight to race.
 * @param {AbortSignal | undefined} signal - the surrounding search's signal.
 * @param {string} label - provider label used in the abort error.
 * @returns {Promise<T>} the operation's settlement, or an abort rejection.
 * @template T
 */
export function abortable(operation, signal, label) {
	if (signal === void 0) return operation;
	if (signal.aborted) return Promise.reject(searchAborted(signal, label));
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			reject(searchAborted(signal, label));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		operation.then((value) => {
			signal.removeEventListener("abort", onAbort);
			resolve(value);
		}, (error) => {
			signal.removeEventListener("abort", onAbort);
			reject(new Error(String(error).replace(/^Error: /u, ""), { cause: error }));
		});
	});
}

/**
 * Resolve one search's credential without retaining it: a literal config key
 * wins, then the resolver (credentials service, then launch environment).
 * @param {object} options - one search's option snapshot.
 * @param {string} [options.apiKey] - literal key from plugin config.
 * @param {() => Promise<string | undefined>} [options.resolveApiKey] - deferred key lookup.
 * @param {string} options.apiKeyEnv - the credential reference name, for the error message.
 * @param {string} options.label - provider label used in error messages.
 * @param {string} options.configNamespace - the plugin config namespace named in the error.
 * @param {AbortSignal | undefined} signal - the surrounding search's signal.
 * @returns {Promise<string>} the resolved key.
 * @throws {WebError} `WEB_PROVIDER_CREDENTIAL_MISSING` when no layer holds a key.
 */
export async function resolveApiKey(options, signal) {
	throwIfSearchAborted(signal, options.label);
	if (options.apiKey !== void 0 && options.apiKey.length > 0) return options.apiKey;
	let resolved;
	try {
		resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(void 0), signal, options.label);
	} catch (error) {
		if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, options.label, error);
		throw new WebError(`${options.label} search credential resolution failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
	}
	if (resolved !== void 0 && resolved.length > 0) return resolved;
	throw new WebError(`${options.label} search has no API key for "${options.apiKeyEnv}"; store it through the credentials service, export it in the launching environment, or set a literal "apiKey" in the ${options.configNamespace} config`, "WEB_PROVIDER_CREDENTIAL_MISSING");
}

/**
 * Extract a human-readable detail from an error response body, tolerating the
 * different shapes Brave (`{error: {message}}` / `{message}`) and Tavily
 * (`{detail: {error}}` / `{detail}` / `{message}`) return.
 * @param {unknown} parsed - the parsed error body.
 * @returns {string | undefined} the detail, when one is present.
 */
export function errorDetail(parsed) {
	if (parsed === null || typeof parsed !== "object") return void 0;
	const body = /** @type {Record<string, any>} */ (parsed);
	if (typeof body.error === "string" && body.error.length > 0) return body.error;
	if (typeof body.error?.message === "string" && body.error.message.length > 0) return body.error.message;
	if (typeof body.detail === "string" && body.detail.length > 0) return body.detail;
	if (typeof body.detail?.error === "string" && body.detail.error.length > 0) return body.detail.error;
	if (typeof body.message === "string" && body.message.length > 0) return body.message;
	return void 0;
}
