These fixtures are mechanically imported from the MIT-licensed Python SDK at
https://github.com/litescrape/litescrape-sdk/tree/9e829101d45299feb07016872b8c3d0f98f8a2f4
(version 0.6.0). The package LICENSE retains the same Litescrape copyright notice.

`allowlists.json` and `paths.json` cover all 35 endpoints. `stores.json` preserves
all 547 Store contract cases. Long boundary strings use `$repeat` or base64-encoded
`$gzip` representations, expanded losslessly by the tests.

Refresh with `node scripts/import-python-fixtures.mjs <python-sdk-checkout>` and
update the source revision here after reviewing contract changes.
