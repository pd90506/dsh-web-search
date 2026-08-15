/**
 * Browser half of @pd90506/dsh-web-search: a collapsible card in Settings → Plugins →
 * Plugin configuration (the `settings.plugin.item` slot) holding the
 * default-provider selector and the Brave/Tavily API-key controls. State
 * comes from the host half's `webSearch/*` typert endpoints; keys are written
 * through the official loopback-pinned `credentials.*` RPC plane and never
 * read back — `credentials.describe` exposes only posture, never material.
 *
 * The bundle is built by build.mjs into the `__ModuleLoader__` factory format
 * with `react`/`react/jsx-runtime` externalized to the platform seeds.
 */
import { useCallback, useEffect, useState } from "react";

/** Dictionary namespace owned by this plugin. */
const NS = "settings.web-search";
/** Card id in the `settings.plugin.item` ledger (the deepseek card is "web-search"). */
const CARD_ID = "web-search-brave-tavily";
/** Card order: bash is 0, agent-loop is 10, web-search (deepseek) is 20. */
const CARD_ORDER = 30;

const en = {
	cardTitle: "Brave & Tavily",
	cardDescription: "API keys and the default web search provider.",
	expand: "Expand",
	collapse: "Collapse",
	defaultProvider: "Default provider",
	defaultHint: "Switching writes the profile's cordis.patch.yml and takes effect within about a second — no restart.",
	applying: "Applying…",
	applied: "Default provider updated.",
	appliedPending: "Pin written; still waiting for the runtime to apply it…",
	configured: "configured",
	notConfigured: "not configured",
	source: "source",
	readOnly: "read-only (shadowed by environment)",
	save: "Save",
	changeKey: "Change key",
	removeKey: "Remove key",
	removed: "Key removed.",
	cancel: "Cancel",
	saved: "Key saved.",
	noKey: "no key",
	loading: "Loading…",
	loadFailed: "Failed to load",
	unpinned: "(not pinned)"
};
const zh = {
	cardTitle: "Brave 与 Tavily",
	cardDescription: "API key 与默认网页搜索提供方。",
	expand: "展开",
	collapse: "收起",
	defaultProvider: "默认搜索提供方",
	defaultHint: "切换会写入 profile 的 cordis.patch.yml，约一秒内生效，无需重启。",
	applying: "正在应用…",
	applied: "默认提供方已更新。",
	appliedPending: "配置已写入，等待运行时应用…",
	configured: "已配置",
	notConfigured: "未配置",
	source: "来源",
	readOnly: "只读（已被环境变量覆盖）",
	save: "保存",
	changeKey: "更换 key",
	removeKey: "移除 key",
	removed: "已移除。",
	cancel: "取消",
	saved: "已保存。",
	noKey: "缺少 key",
	loading: "加载中…",
	loadFailed: "加载失败",
	unpinned: "（未固定）"
};

/** Proper nouns stay untranslated; unknown ids render as-is. */
const PROVIDER_LABELS = {
	"deepseek-official": "DeepSeek (official)",
	brave: "Brave Search",
	tavily: "Tavily"
};
function providerLabel(id) {
	return PROVIDER_LABELS[id] ?? id;
}

const styles = {
	cardBox: {
		listStyle: "none",
		border: "1px solid var(--dsw-alias-border-l2)",
		borderRadius: 12,
		color: "var(--dsw-alias-label-primary)",
		fontSize: 13,
		lineHeight: 1.5
	},
	header: {
		display: "flex",
		alignItems: "center",
		gap: 12,
		width: "100%",
		padding: "12px 16px",
		background: "none",
		border: "none",
		font: "inherit",
		color: "inherit",
		cursor: "pointer",
		textAlign: "left"
	},
	headText: { display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 },
	name: { fontSize: 14, fontWeight: 600 },
	description: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" },
	chevron: (open) => ({
		color: "var(--dsw-alias-label-tertiary)",
		transform: open ? "rotate(180deg)" : "none",
		transition: "transform 150ms ease"
	}),
	body: {
		display: "flex",
		flexDirection: "column",
		gap: 20,
		padding: 16,
		borderTop: "1px solid var(--dsw-alias-border-l2)"
	},
	section: { display: "flex", flexDirection: "column", gap: 8 },
	card: {
		display: "flex",
		flexDirection: "column",
		gap: 10,
		paddingTop: 16,
		borderTop: "1px solid var(--dsw-alias-border-l2)"
	},
	row: { display: "flex", alignItems: "center", gap: 10 },
	fieldLabel: { fontWeight: 500 },
	hint: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, margin: 0 },
	error: { color: "var(--dsw-alias-label-critical, #d64545)", margin: 0 },
	notice: { color: "var(--dsw-alias-label-secondary)", margin: 0 },
	select: {
		height: 34,
		padding: "0 10px",
		borderRadius: 8,
		border: "1px solid var(--dsw-alias-border-l2)",
		background: "var(--dsw-alias-bg-layer-3)",
		color: "inherit",
		font: "inherit"
	},
	input: {
		flex: 1,
		height: 34,
		padding: "0 12px",
		borderRadius: 8,
		border: "1px solid var(--dsw-alias-border-l2)",
		background: "var(--dsw-alias-bg-layer-3)",
		color: "inherit",
		font: "inherit"
	},
	button: {
		height: 34,
		padding: "0 14px",
		borderRadius: 8,
		border: "1px solid var(--dsw-alias-border-l2)",
		background: "var(--dsw-alias-bg-layer-3)",
		color: "inherit",
		font: "inherit",
		cursor: "pointer"
	},
	badge: (configured) => ({
		fontSize: 11,
		fontWeight: 500,
		padding: "1px 8px",
		borderRadius: 999,
		background: configured ? "var(--dsw-alias-bg-module-platform)" : "transparent",
		color: configured ? "var(--dsw-alias-label-secondary)" : "var(--dsw-alias-label-tertiary)"
	})
};

/** Required services (cordis fiber inject). */
export const inject = ["slots", "locale", "connection", "remote"];

/**
 * Mount the Brave & Tavily plugin-configuration card.
 * @param {object} ctx - the browser plugin context.
 */
export function apply(ctx) {
	const { api, rpc } = ctx.get("connection");
	const t = ctx.locale.bind(NS);
	ctx.effect(() => ctx.locale.register(NS, { zh, en }), "@pd90506/dsh-web-search: dictionaries");

	// rpc.call resolves with the gateway's { ok, value | error } envelope —
	// unwrap it here so the rest of the card deals in payloads only.
	const callGateway = async (endpoint, args) => {
		const result = await rpc.call("/api", endpoint, { args });
		if (result?.ok !== true) {
			const error = result?.error;
			throw new Error(error?.message !== void 0 ? `${endpoint} failed: ${error.code}: ${error.message}` : `${endpoint} failed`);
		}
		return result.value;
	};
	const fetchState = () => callGateway("webSearch/getState", {});
	const saveDefault = (providerId) => callGateway("webSearch/setDefaultProvider", { providerId });

	ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
		name: "settings.plugin.item",
		id: CARD_ID,
		order: CARD_ORDER,
		locale: NS
	}, function WebSearchBraveTavilyCard() {
		const [open, setOpen] = useState(false);
		const [phase, setPhase] = useState("loading");
		const [loadError, setLoadError] = useState();
		const [defaultProvider, setDefaultProvider] = useState();
		const [providers, setProviders] = useState([]);
		const [drafts, setDrafts] = useState({});
		const [editingRef, setEditingRef] = useState();
		const [busyRef, setBusyRef] = useState();
		const [switching, setSwitching] = useState(false);
		const [notice, setNotice] = useState();
		const [actionError, setActionError] = useState();

		const refresh = useCallback(async () => {
			const state = await fetchState();
			setDefaultProvider(state.defaultProvider ?? void 0);
			setProviders(Array.isArray(state.providers) ? state.providers : []);
		}, [fetchState]);

		useEffect(() => {
			let cancelled = false;
			refresh().then(
				() => { if (!cancelled) setPhase("ready"); },
				(error) => { if (!cancelled) { setLoadError(String(error?.message ?? error)); setPhase("error"); } }
			);
			return () => { cancelled = true; };
		}, [refresh]);

		// Key writes from any surface (this card, the Models page, a file edit)
		// invalidate the posture; custom gateway events are not forwarded, so
		// the provider pin itself is refreshed after mutations instead.
		useEffect(() => ctx.remote.$on("credentials/updated", () => {
			refresh().catch(() => {});
		}), [refresh]);

		const onSelectDefault = async (event) => {
			const next = event.target.value;
			if (next === defaultProvider || switching) return;
			const previous = defaultProvider;
			setSwitching(true);
			setNotice(void 0);
			setActionError(void 0);
			setDefaultProvider(next);
			try {
				await saveDefault(next);
				// The patch watcher recomposes and restarts the web entry; our
				// gateway rides the same restart, so tolerate "not found" gaps
				// while polling for the pin to land.
				let landed = false;
				for (let attempt = 0; attempt < 10 && !landed; attempt += 1) {
					await new Promise((resolve) => setTimeout(resolve, 400));
					try {
						const state = await fetchState();
						setProviders(Array.isArray(state.providers) ? state.providers : []);
						landed = state.defaultProvider === next;
						if (state.defaultProvider != null) setDefaultProvider(state.defaultProvider);
					} catch { /* gateway mid-remount; keep polling */ }
				}
				setNotice(t(landed ? "applied" : "appliedPending"));
			} catch (error) {
				setDefaultProvider(previous);
				setActionError(String(error?.message ?? error));
			} finally {
				setSwitching(false);
			}
		};

		const onSaveKey = async (ref) => {
			const value = (drafts[ref] ?? "").trim();
			if (value.length === 0 || busyRef !== void 0) return;
			setBusyRef(ref);
			setNotice(void 0);
			setActionError(void 0);
			try {
				await api.credentials.set({ ref, value });
				setDrafts((current) => ({ ...current, [ref]: "" }));
				setEditingRef(void 0);
				await refresh();
				setNotice(t("saved"));
			} catch (error) {
				setActionError(String(error?.message ?? error));
			} finally {
				setBusyRef(void 0);
			}
		};

		const onRemoveKey = async (ref) => {
			if (busyRef !== void 0) return;
			setBusyRef(ref);
			setNotice(void 0);
			setActionError(void 0);
			try {
				await api.credentials.unset({ ref });
				setEditingRef(void 0);
				await refresh();
				setNotice(t("removed"));
			} catch (error) {
				setActionError(String(error?.message ?? error));
			} finally {
				setBusyRef(void 0);
			}
		};

		const onBeginChange = (ref) => {
			setDrafts((current) => ({ ...current, [ref]: "" }));
			setEditingRef(ref);
			setNotice(void 0);
			setActionError(void 0);
		};

		const onCancelChange = (ref) => {
			setDrafts((current) => ({ ...current, [ref]: "" }));
			setEditingRef(void 0);
		};

		const title = t("cardTitle");
		return (
			<li style={styles.cardBox}>
				<button
					type="button"
					style={styles.header}
					aria-expanded={open}
					aria-label={`${t(open ? "collapse" : "expand")}: ${title}`}
					onClick={() => setOpen(!open)}
				>
					<span style={styles.headText}>
						<span style={styles.name}>{title}</span>
						<span style={styles.description}>{t("cardDescription")}</span>
					</span>
					<span style={styles.chevron(open)}>▾</span>
				</button>
				{open && (
					<div style={styles.body}>
						{phase === "loading" && <p style={styles.hint}>{t("loading")}</p>}
						{phase === "error" && <p style={styles.error}>{t("loadFailed")}: {loadError}</p>}
						{phase === "ready" && (
							<>
								<div style={styles.section}>
									<span style={styles.fieldLabel}>{t("defaultProvider")}</span>
									<div style={styles.row}>
										<select
											style={styles.select}
											value={defaultProvider ?? ""}
											disabled={switching}
											onChange={onSelectDefault}
										>
											{defaultProvider === void 0 && <option value="" disabled>{t("unpinned")}</option>}
											{providers.map((provider) => (
												<option key={provider.id} value={provider.id}>
													{providerLabel(provider.id)}
													{provider.keyRef !== void 0 && provider.credential?.configured !== true ? ` · ${t("noKey")}` : ""}
												</option>
											))}
										</select>
										{switching && <span style={styles.hint}>{t("applying")}</span>}
									</div>
									<p style={styles.hint}>{t("defaultHint")}</p>
								</div>
								{providers.filter((provider) => provider.keyRef !== void 0).map((provider) => {
									const ref = provider.keyRef;
									const credential = provider.credential ?? { configured: false, writable: true };
									const configured = credential.configured === true;
									const editing = editingRef === ref;
									const draft = drafts[ref] ?? "";
									const busy = busyRef !== void 0;
									return (
										<div key={provider.id} style={styles.card}>
											<div style={styles.row}>
												<span style={styles.fieldLabel}>{providerLabel(provider.id)}</span>
												<span style={styles.badge(configured)}>
													{configured ? t("configured") : t("notConfigured")}
												</span>
												{configured && credential.source !== void 0 && (
													<span style={styles.hint}>{t("source")}: {credential.source}</span>
												)}
												{!credential.writable && <span style={styles.hint}>{t("readOnly")}</span>}
											</div>
											{!credential.writable ? null : configured && !editing ? (
												// A stored key is never echoed back: no input until "Change key".
												<div style={styles.row}>
													<button style={styles.button} disabled={busy} onClick={() => onBeginChange(ref)}>{t("changeKey")}</button>
													<button style={styles.button} disabled={busy} onClick={() => onRemoveKey(ref)}>{t("removeKey")}</button>
												</div>
											) : (
												<div style={styles.row}>
													<input
														type="password"
														style={styles.input}
														placeholder={ref}
														value={draft}
														disabled={busy}
														autoComplete="off"
														onChange={(event) => setDrafts((current) => ({ ...current, [ref]: event.target.value }))}
													/>
													<button
														style={styles.button}
														disabled={draft.trim().length === 0 || busy}
														onClick={() => onSaveKey(ref)}
													>{t("save")}</button>
													{editing && (
														<button style={styles.button} disabled={busy} onClick={() => onCancelChange(ref)}>{t("cancel")}</button>
													)}
												</div>
											)}
										</div>
									);
								})}
								{actionError !== void 0 && <p style={styles.error}>{actionError}</p>}
								{notice !== void 0 && <p style={styles.notice}>{notice}</p>}
							</>
						)}
					</div>
				)}
			</li>
		);
	}));
}
