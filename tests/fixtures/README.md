`allowlists.json`, `paths.json` and `examples.json` are mechanically imported from the Litescrape
v3 API's OpenAPI contract (`/api/openapi.json`, API version 3.0.0) and cover all 139 endpoints:
each endpoint's path, its accepted parameters (plus `timeout`), the documented example request, and
which endpoints accept only JSON POST bodies. Refresh with
`node scripts/import-v3-catalog.mjs <openapi.json path or URL>` after reviewing contract changes.

`stores.json` is imported from the MIT-licensed Python SDK at
https://github.com/litescrape/litescrape-sdk/tree/9e829101d45299feb07016872b8c3d0f98f8a2f4
(version 0.6.0). The package LICENSE retains the same Litescrape copyright notice. It preserves
all 547 Store contract cases. Long boundary strings use `$repeat` or base64-encoded `$gzip`
representations, expanded losslessly by the tests. Refresh with
`node scripts/import-python-fixtures.mjs <python-sdk-checkout>` and update the source revision here.
