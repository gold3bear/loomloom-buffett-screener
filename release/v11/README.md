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
zip -qr ../release/v11/loomloom-buffett-screener-v11.zip \
  loomloom-019fad3b-8831-7986-bdd0-db4620e261b8 \
  -x "*.DS_Store" -x "*/__pycache__/*" -x "*.pyc" \
  -x "*/model/fixtures/*" -x "*/model/test_*.py" \
  -x "*/scripts/*.test.mjs" -x "*/scripts/dev/*"
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
