/**
 * Cordis plugin registering Brave Search and Tavily as providers on the
 * `ctx.web` seam. Both providers follow the shipped DeepSeek provider's
 * credential chain — literal config `apiKey`, then the credentials service,
 * then the launch environment — so keys stored through the credentials service
 * or exported in the environment work identically across all three.
 *
 * With more than one usable provider registered, the seam requires an explicit
 * selection: set `searchProvider: brave` (or `tavily`) on the `web` service
 * config, or export `DSH_WEB_SEARCH_PROVIDER` at launch.
 * @module @pd90506/dsh-web-search
 */
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { BRAVE_DEFAULT_BASE_URL, BRAVE_PROVIDER_ID, BraveSearchProvider } from "./brave.js";
import { TAVILY_DEFAULT_BASE_URL, TAVILY_PROVIDER_ID, TavilySearchProvider } from "./tavily.js";
import { WebSearchGateway } from "./host-gateway.js";

/** Cordis plugin name used by loader diagnostics. */
export const name = "web-search-brave-tavily";

/** The web seam this plugin registers into, plus the typert registry the settings RPC endpoints mount through. */
export const inject = ["web", "typert"];

/** Default credential reference for the Brave key. */
export const BRAVE_DEFAULT_API_KEY_ENV = "BRAVE_API_KEY";
/** Default credential reference for the Tavily key. */
export const TAVILY_DEFAULT_API_KEY_ENV = "TAVILY_API_KEY";
/** Default per-provider result cap when the request carries no `maxResults`. */
const DEFAULT_MAX_RESULTS = 10;

/**
 * Plugin configuration. `apiKey` fields carry `role("secret")` so they never
 * ride a `describe()` response; `apiKeyEnv` fields name the credential
 * reference the credentials service and launch environment are queried for.
 * Keys without a default are optional and stay `undefined` when unset.
 */
export const Config = z.object({
	braveApiKey: z.string().role("secret"),
	braveApiKeyEnv: z.string().role("credential-ref").default(BRAVE_DEFAULT_API_KEY_ENV),
	braveBaseURL: z.string().default(BRAVE_DEFAULT_BASE_URL),
	tavilyApiKey: z.string().role("secret"),
	tavilyApiKeyEnv: z.string().role("credential-ref").default(TAVILY_DEFAULT_API_KEY_ENV),
	tavilyBaseURL: z.string().default(TAVILY_DEFAULT_BASE_URL),
	tavilySearchDepth: z.string().default("basic"),
	tavilyIncludeAnswer: z.boolean().default(true),
	maxResults: z.number().step(1).min(1).default(DEFAULT_MAX_RESULTS)
});

/**
 * Build the deferred credential lookup shared by both providers: the
 * credentials service when the profile mounts one, otherwise the launch
 * environment (inherited process env > invocation `.env` > `$DSH_HOME/.env`).
 * @param {object} ctx - plugin context supplying the credential and environment planes.
 * @param {string} apiKeyEnv - the credential reference to resolve.
 * @returns {() => Promise<string | undefined>} a resolver for one search's key.
 */
function envKeyResolver(ctx, apiKeyEnv) {
	const ref = credentialRef(apiKeyEnv);
	return async () => {
		const credentials = ctx.get("credentials");
		if (credentials !== void 0) return (await credentials.resolve(ref))?.value;
		const ambient = launchEnvironmentOf(ctx).get(ref);
		return ambient !== void 0 && ambient.value.length > 0 ? ambient.value : void 0;
	};
}

/** Register the Brave and Tavily search providers with `ctx.web`. */
export function apply(ctx, config = {}) {
	const braveOptions = () => ({
		...config.braveApiKey !== void 0 && config.braveApiKey.length > 0 ? { apiKey: config.braveApiKey } : {},
		resolveApiKey: envKeyResolver(ctx, config.braveApiKeyEnv ?? BRAVE_DEFAULT_API_KEY_ENV),
		apiKeyEnv: config.braveApiKeyEnv ?? BRAVE_DEFAULT_API_KEY_ENV,
		baseURL: config.braveBaseURL ?? BRAVE_DEFAULT_BASE_URL,
		maxResults: config.maxResults ?? DEFAULT_MAX_RESULTS
	});
	const tavilyOptions = () => ({
		...config.tavilyApiKey !== void 0 && config.tavilyApiKey.length > 0 ? { apiKey: config.tavilyApiKey } : {},
		resolveApiKey: envKeyResolver(ctx, config.tavilyApiKeyEnv ?? TAVILY_DEFAULT_API_KEY_ENV),
		apiKeyEnv: config.tavilyApiKeyEnv ?? TAVILY_DEFAULT_API_KEY_ENV,
		baseURL: config.tavilyBaseURL ?? TAVILY_DEFAULT_BASE_URL,
		searchDepth: config.tavilySearchDepth ?? "basic",
		includeAnswer: config.tavilyIncludeAnswer ?? true,
		maxResults: config.maxResults ?? DEFAULT_MAX_RESULTS
	});
	ctx.web.registerSearchProvider(new BraveSearchProvider(braveOptions));
	ctx.web.registerSearchProvider(new TavilySearchProvider(tavilyOptions));
	// The settings tab's host half. Constructed directly on this fiber's
	// context: Service registration via ctx.reflect.provide is globally visible
	// and unregisters automatically when this fiber unloads (e.g. when the web
	// service restarts after a provider-pin switch, remounting us moments later).
	new WebSearchGateway(ctx);
}

export { BRAVE_PROVIDER_ID, TAVILY_PROVIDER_ID };
