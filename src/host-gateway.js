/**
 * Host half of the Web Search settings surface: a cordis service (`webSearch`)
 * whose two methods back the settings tab, exposed to the browser as strict
 * typert endpoints `webSearch/getState` and `webSearch/setDefaultProvider`.
 *
 * Endpoints are registered at runtime through the shared `typert` registry
 * service (`ctx.typert.register`, fiber-scoped so they withdraw when this
 * plugin unloads) rather than via `@Remote` decorators: decorator markers
 * live in a module-private table of whichever dsh-typert-protocol copy
 * attached them, and an out-of-tree plugin's nested copy is not the API
 * gateway's — while the registry path is a runtime service call, immune to
 * module identity, and is re-read on every claim.
 *
 * The default-provider write path edits the profile's own `cordis.patch.yml`
 * — the layer composed after every bundle — and the loader's patch-file HMR
 * recomposes and restarts the `web` entry with the new pin, so a switch is
 * durable across restarts and live without one. Keys are never handled here;
 * the tab stores those through the official `credentials.*` RPC plane.
 * @module @pd90506/dsh-web-search/host-gateway
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { isMap, isSeq, parseDocument } from "yaml";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { credentialRef } from "@deepseek-ai/dsh-credentials";

/** Cordis service key; also the typert wire namespace. */
export const WEB_SEARCH_SERVICE = "webSearch";

/** Package identity for the strict typert contribution. */
const TYPERT_PACKAGE = "@pd90506/dsh-web-search";

/**
 * Providers the settings tab can offer, in display order. `deepseek-official`
 * carries no `keyRef`: its key is shared with the model provider and managed
 * from the Models page, not from the Web Search tab.
 */
export const SEARCH_PROVIDERS = Object.freeze([
	Object.freeze({ id: "deepseek-official" }),
	Object.freeze({ id: "brave", keyRef: "BRAVE_API_KEY" }),
	Object.freeze({ id: "tavily", keyRef: "TAVILY_API_KEY" })
]);
const SEARCH_PROVIDER_IDS = SEARCH_PROVIDERS.map((provider) => provider.id);

/** The profile-layer patch filename, resolved against the loader's baseUrl. */
const PROFILE_PATCH_FILENAME = "cordis.patch.yml";

/** The strict typert contribution backing `webSearch/*` endpoints. */
function typertContribution() {
	const shared = {
		namespace: WEB_SEARCH_SERVICE,
		service: WEB_SEARCH_SERVICE,
		invocation: { kind: "direct" },
		result: { mode: "src-json" }
	};
	return {
		package: TYPERT_PACKAGE,
		face: "host",
		schemas: [],
		invocations: [
			{ ...shared, id: `${TYPERT_PACKAGE}#getState`, method: "getState", parameters: [] },
			{
				...shared,
				id: `${TYPERT_PACKAGE}#setDefaultProvider`,
				method: "setDefaultProvider",
				parameters: [{ name: "providerId", wire: "providerId", source: "json", codec: { mode: "src-json" } }]
			}
		]
	};
}

/** The web seam's module name — the stable identity of the entry holding the provider pin (runtime entry ids vary by include nesting, e.g. "include:web"). */
const WEB_MODULE_NAME = "@deepseek-ai/dsh-web";

/**
 * Service backing the Web Search settings tab. Extends TypertRemoteService
 * for its `typertRemote` binding — a plain instance property the gateway
 * validates on every invocation (`validateBinding`), readable across module
 * copies. No `@Remote` decorators: the endpoint metadata lives in the strict
 * contribution registered with the shared typert registry below.
 */
export class WebSearchGateway extends TypertRemoteService {
	constructor(ctx) {
		super(ctx, WEB_SEARCH_SERVICE);
		const typert = ctx.get("typert");
		if (typert === void 0) throw new Error("webSearch: the typert registry service is unavailable");
		typert.register(typertContribution());
	}

	/**
	 * The effective default provider: the composed `web` entry's configured
	 * pin, else the launch environment's `DSH_WEB_SEARCH_PROVIDER`, else null
	 * (the seam then requires exactly one usable provider). Null rather than
	 * undefined so the strict src-json boundary accepts the result.
	 * @returns {string | null} the provider id the next search would use.
	 */
	readDefaultProvider() {
		for (const entry of this.ctx.loader.entries()) {
			if (entry.options?.name !== WEB_MODULE_NAME) continue;
			const configured = entry.options?.config?.searchProvider;
			if (typeof configured === "string" && configured.length > 0) return configured;
		}
		const ambient = process.env.DSH_WEB_SEARCH_PROVIDER;
		return typeof ambient === "string" && ambient.length > 0 ? ambient : null;
	}

	/**
	 * Snapshot for the tab: the current default plus, for each provider that
	 * owns a key, the credential posture (`configured`/`source`/`writable`)
	 * straight from the credentials service — never the key material itself.
	 * @returns {Promise<{defaultProvider: string | null, providers: Array<object>}>}
	 */
	async getState() {
		const credentials = this.ctx.get("credentials");
		const providers = [];
		for (const provider of SEARCH_PROVIDERS) {
			const row = { id: provider.id };
			if (provider.keyRef !== void 0) {
				row.keyRef = provider.keyRef;
				if (credentials !== void 0) {
					const info = await credentials.describe(credentialRef(provider.keyRef));
					row.credential = {
						configured: info.configured,
						...info.source === void 0 ? {} : { source: info.source },
						writable: info.writable
					};
				}
			}
			providers.push(row);
		}
		return { defaultProvider: this.readDefaultProvider(), providers };
	}

	/**
	 * Pin the default provider durably: merge the pin into the profile patch
	 * file and let the loader's patch HMR apply it (the `web` entry restarts
	 * with the new `searchProvider`). Returns immediately; the live entry
	 * converges within about a second.
	 * @param {string} providerId - one of {@linkcode SEARCH_PROVIDERS}' ids.
	 * @returns {Promise<{defaultProvider: string}>} the pin just written.
	 */
	async setDefaultProvider(providerId) {
		if (!SEARCH_PROVIDER_IDS.includes(providerId)) {
			throw new Error(`webSearch: unknown provider "${providerId}"; expected one of ${SEARCH_PROVIDER_IDS.join(", ")}`);
		}
		const baseUrl = this.ctx.baseUrl;
		if (typeof baseUrl !== "string") {
			throw new Error("webSearch: ctx.baseUrl is unset — cannot locate the profile patch file");
		}
		upsertSearchProviderPin(join(fileURLToPath(baseUrl), PROFILE_PATCH_FILENAME), providerId);
		return { defaultProvider: providerId };
	}
}

/**
 * Merge `searchProvider: providerId` into the `web` patch entry of the file
 * at `patchPath`, preserving comments, every sibling patch entry, and any
 * sibling keys of the entry's `config` (matching loader semantics, where a
 * patch replaces the row's config wholesale — so the merge happens here, on
 * the document). When no `web` override exists yet, one is appended; a
 * flow-style empty root (`[]`) is promoted to a block list. Exported for
 * tests.
 * @param {string} patchPath - absolute path of a profile `cordis.patch.yml`.
 * @param {string} providerId - the provider id to pin.
 */
export function upsertSearchProviderPin(patchPath, providerId) {
	const document = parseDocument(readFileSync(patchPath, "utf8"));
	if (!isSeq(document.contents)) {
		throw new Error(`webSearch: ${patchPath} root is not a YAML array of patch entries`);
	}
	let target;
	for (const item of document.contents.items) {
		if (isMap(item) && item.get("insert") === void 0 && item.get("id") === "web") {
			target = item;
			break;
		}
	}
	if (target === void 0) {
		document.contents.flow = false;
		document.contents.items.push(document.createNode({ id: "web", config: { searchProvider: providerId } }));
	} else {
		const config = target.get("config", true);
		if (isMap(config)) config.set("searchProvider", providerId);
		else target.set("config", document.createNode({ searchProvider: providerId }));
	}
	writeFileSync(patchPath, document.toString(), "utf8");
}
