# Local model decoders

Vendored from `three@0.186.1`, pinned in `package.json` and `pnpm-lock.yaml`:

- `draco/*.{js,wasm}`: `three/examples/jsm/libs/draco/gltf/` (Apache-2.0).
- `basis/*.{js,wasm}`: `three/examples/jsm/libs/basis/` (Apache-2.0).
- Meshopt is imported from `three/addons/libs/meshopt_decoder.module.js` and bundled into the lazy Three.js chunk (MIT; embedded upstream notice retained).

The package's MIT license is retained in `THREE-LICENSE.txt`. Each decoder directory retains its upstream README and Apache license. `manifest.json` records SHA-256 hashes of the shipped decoder files. Do not format or lint upstream distribution files. When updating Three.js, update these files from the same installed version and regenerate the manifest; retain the upstream licenses.

Decoder requests use the application's own base URL, never a CDN. Model resource URLs are separately restricted to object URLs created by the active import. The decoders are copied by Vite into desktop and mobile bundles.
