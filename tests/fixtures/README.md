These fixtures are mechanically imported from the MIT-licensed Python SDK at
https://github.com/litescrape/litescrape-sdk/tree/d804725994a4b799605b517ca4af9f05b866dc11
(version 0.5.2). The package LICENSE retains the same Litescrape copyright notice.

`allowlists.json` and `paths.json` cover all 34 endpoints. `stores.json` preserves
all 547 Store contract cases. Long boundary strings use `$repeat` or base64-encoded
`$gzip` representations, expanded losslessly by the tests.

Refresh with `node scripts/import-python-fixtures.mjs <python-sdk-checkout>` and
update the source revision here after reviewing contract changes.
