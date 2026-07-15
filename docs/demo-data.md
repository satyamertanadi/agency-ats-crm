# Indonesian demo dataset

The reusable `DEMO-IDN-V1` fixture is generated at runtime so real consultant emails never enter source control.

```powershell
npm.cmd run demo:generate -- --anchor-date 2026-07-15 --owners "one@example.org,two@example.org,three@example.org,four@example.org,five@example.org,six@example.org"
```

For safer local handling, pass `--owners-file <ignored-json-file>` containing an array of exactly six active member emails. Generated CSVs and `manifest.json` are written to the ignored `outputs/demo-indonesia-v1/` directory.

Use the manifest's `importOrder` through the authenticated Data Imports page. Stage every file first and require zero failed rows before committing in order. If any commit fails, roll back completed demo batches in the manifest's reverse `rollbackOrder` and stop.

The fixture uses fictional Indonesian people and businesses, reserved `.example` addresses, blank phone numbers, no uploaded documents, no outbound delivery, and interviews with Calendar synchronization disabled.
