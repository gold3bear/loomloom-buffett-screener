# v11 Skill Package

Built from the v11 Skill directory for the production Listing update.

- ZIP: `loomloom-buffett-screener-v11.zip` (not committed; rebuild with the command below)
- Input schema: `tickerPacket`, `modelAssumptions`, `modelChoice`, `asOf`
- Cloud template: `a390aa6e-20cf-4446-822c-9a1d95c56bb8` v1 `186d2643-6c3b-41c1-bc1c-61c648492a90`
- Package validation: `302c1795-90fd-42e3-8dc7-525835f3e18f` (passed)
- Package archive: `sha256:4ddd77e6240e19c5abc1e116eb851b9f9ec375a81f8dcc5e82cfd11f3360e9a7`

## Rebuild

```bash
cd skill
# Use the script; it excludes internal model/prompt Code.
./release/v11/build-skill-package.sh
```

The package is uploaded separately to the private template via
`loomloom skill package private upload`; the Listing update is a separate review
request.

## Published

- Listing title: `美股价值投资批量筛选`
- Listing version: `01a18bf4-0bf9-79c2-a870-ba261e5d597f`
- Review: approved
- Sale: listed
- Execution: available
- Package: v11, 123266 bytes, validation `302c1795-90fd-42e3-8dc7-525835f3e18f`
- Public package download verified: 4 fields (`tickerPacket`, `modelAssumptions`, `modelChoice`, `asOf`)
- Price: 0.2 CNY/task


## Clean package (IP-safe)

The first v11 ZIP accidentally included internal Python sources (`model/*.py`,
including prompts, audit and model code). The public package must never include
`model/`, `scripts/run-model.mjs` or `scripts/sync-model-code.mjs`.

A clean package was built at 55,074 bytes with zero `.py` files, validation
`2aa03a3e-4215-4ffd-9289-1a39ef8abe61`, archive
`sha256:69e6dcd30a8e6d85d692eebf3bf1e4febc878d3dcdb89e06b5b0abb5be77913c`.
It is pending Market review; until approved the previously published package
(123,266 bytes) is still the downloadable one.
