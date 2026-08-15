/**
 * Build the browser bundle `lib/client.js` in dsh's `__ModuleLoader__`
 * factory format: a CJS body wrapped in a factory whose `require` resolves
 * platform seeds (`react`, `react/jsx-runtime`) and other client modules.
 * The host-side `ClientModuleRegistry` content-hashes this file as the boot
 * graph revision, and `dsh-client-hmr` re-serves it on change.
 */
import { build } from "esbuild";

const banner = `window.__ModuleLoader__.load({
	id: "@pd90506/dsh-web-search",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;`;

const footer = `		return module.exports;
	}
});`;

await build({
	entryPoints: ["src/client/index.jsx"],
	outfile: "lib/client.js",
	bundle: true,
	format: "cjs",
	platform: "browser",
	target: "es2022",
	jsx: "automatic",
	external: ["react", "react/jsx-runtime"],
	banner: { js: banner },
	footer: { js: footer },
	logLevel: "info"
});
