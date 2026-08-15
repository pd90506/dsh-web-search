/**
 * Live smoke test: runs one real search per provider against the Brave and
 * Tavily APIs using the keys in this repo's `.env`. Not a unit test — it
 * costs one API call per provider and requires network access.
 *
 *   node test/smoke.mjs [query]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BraveSearchProvider, BRAVE_DEFAULT_BASE_URL } from "../src/brave.js";
import { TavilySearchProvider, TAVILY_DEFAULT_BASE_URL } from "../src/tavily.js";

const QUERY = process.argv[2] ?? "DeepSeek Harness coding agent";

/** Load the repo-root `.env` into process.env without overriding inherited values. */
function loadDotEnv() {
	const path = fileURLToPath(new URL("../.env", import.meta.url));
	let text;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		console.warn(`smoke: no .env at ${path}; relying on inherited environment`);
		return;
	}
	for (const line of text.split(/\r?\n/u)) {
		const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u.exec(line);
		if (match === null || line.trimStart().startsWith("#")) continue;
		if (process.env[match[1]] === void 0) process.env[match[1]] = match[2].replace(/^["']|["']$/gu, "");
	}
}

function envResolver(name) {
	return async () => {
		const value = process.env[name];
		return value !== void 0 && value.length > 0 ? value : void 0;
	};
}

async function exercise(label, provider) {
	if (!provider.available()) throw new Error(`${label}: provider reports unavailable before any network call`);
	const started = Date.now();
	const result = await provider.search({ query: QUERY, maxResults: 5 });
	const elapsed = Date.now() - started;
	console.log(`\n=== ${label} (${elapsed}ms) ===`);
	if (result.content !== void 0) console.log(`answer: ${result.content.slice(0, 300)}`);
	if (result.sources.length === 0) throw new Error(`${label}: returned zero sources for "${QUERY}"`);
	for (const source of result.sources) {
		console.log(`- ${source.title ?? "(no title)"}\n  ${source.url}`);
		if (source.snippet !== void 0) console.log(`  ${source.snippet.slice(0, 160)}`);
		if (source.publishedAt !== void 0) console.log(`  published: ${source.publishedAt}`);
	}
	for (const source of result.sources) {
		if (typeof source.url !== "string" || !URL.canParse(source.url)) throw new Error(`${label}: source with unusable url: ${String(source.url)}`);
	}
	console.log(`${label}: OK — ${result.sources.length} sources`);
}

async function exerciseMissingCredential(label, provider) {
	try {
		await provider.search({ query: "test" });
	} catch (error) {
		if (error?.code === "WEB_PROVIDER_CREDENTIAL_MISSING") {
			console.log(`${label}: missing-credential path OK (WEB_PROVIDER_CREDENTIAL_MISSING)`);
			return;
		}
		throw new Error(`${label}: expected WEB_PROVIDER_CREDENTIAL_MISSING, got ${error?.code ?? error}`);
	}
	throw new Error(`${label}: search without a key did not fail`);
}

loadDotEnv();

const brave = new BraveSearchProvider(() => ({
	resolveApiKey: envResolver("BRAVE_API_KEY"),
	apiKeyEnv: "BRAVE_API_KEY",
	baseURL: BRAVE_DEFAULT_BASE_URL,
	maxResults: 5
}));
const tavily = new TavilySearchProvider(() => ({
	resolveApiKey: envResolver("TAVILY_API_KEY"),
	apiKeyEnv: "TAVILY_API_KEY",
	baseURL: TAVILY_DEFAULT_BASE_URL,
	searchDepth: "basic",
	includeAnswer: true,
	maxResults: 5
}));

// The credential-missing path runs against key-less providers first, so a
// bogus key can never mask a broken guard.
await exerciseMissingCredential("brave", new BraveSearchProvider(() => ({
	apiKeyEnv: "BRAVE_API_KEY",
	baseURL: BRAVE_DEFAULT_BASE_URL,
	maxResults: 5
})));
await exerciseMissingCredential("tavily", new TavilySearchProvider(() => ({
	apiKeyEnv: "TAVILY_API_KEY",
	baseURL: TAVILY_DEFAULT_BASE_URL,
	searchDepth: "basic",
	includeAnswer: true,
	maxResults: 5
})));

await exercise("brave", brave);
await exercise("tavily", tavily);
console.log("\nsmoke: all providers OK");
