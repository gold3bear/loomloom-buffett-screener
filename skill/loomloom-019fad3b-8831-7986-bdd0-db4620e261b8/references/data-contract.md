# Local Data Contract

Each input object represents one ticker and contains `identityPacket`, `financialPacket`, `qualitativePacket`. The three fields may be JSON objects or serialized JSON strings; when generating the Market request they are uniformly serialized as strings.

## Identity and Sources

`identityPacket` must contain at least:

```json
{
  "ticker": "AAPL",
  "companyName": "Apple Inc.",
  "industry": "Technology Hardware",
  "dataAsOf": "2026-07-29",
  "fiscalPeriod": "FY2025",
  "sources": ["https://www.sec.gov/..."]
}
```

- `ticker` uses the uppercase US equity symbol.
- `dataAsOf` is an ISO date and must not be later than the check date.
- `sources` contains at least one HTTPS link. Prefer SEC filings, company IR, exchanges, or other primary sources.
- `fiscalPeriod` states the current primary reporting basis; data from different periods must not be disguised as the same period.

## Financials and Valuation

`financialPacket.marketSnapshot` must contain at least:

```json
{
  "price": 200.0,
  "currency": "USD",
  "asOf": "2026-07-29T20:00:00Z",
  "pe": 30.5
}
```

- `price` must be a positive number and is bound to a timestamp and currency.
- A market snapshot older than 7 days is a hard failure.
- When a loss-making company or a meaningless metric makes `pe` irrelevant, set it to `null` and explain in `financialPacket.unknowns`.
- Do not mix intraday, closing, and pre-split prices.

`financialPacket.annualHistory` must provide at least three valid fiscal years:

```json
{
  "fiscalYearEnd": ["2023-09-30", "2024-09-28", "2025-09-27"],
  "revenue": [383285, 391035, 416161],
  "netIncome": [96995, 93736, 112010],
  "freeCashFlow": [99584, 108807, 98767]
}
```

- All history arrays must have the same length as `fiscalYearEnd`.
- Units go next to the field or in a packet-level `units` field; never omitted.
- Keep GAAP, non-GAAP, and locally derived metrics separate.
- Derived values keep the formula and input keys; the cloud only interprets, it does not back-fill missing facts.

Also recommended: ROE / ROIC, operating cash flow, capex, cash, total debt, lease obligations, diluted share count, buybacks, stock-based compensation, free-cash-flow yield, and historical valuation context.

## Business Quality and Risk

The following fields must all be arrays:

```text
businessModel
moatEvidence
managementCulture
capitalAllocation
riskFactors
contraryEvidence
unknowns
```

Each fact in the first five groups uses this shape:

```json
{
  "fact": "A verifiable atomic fact",
  "source": "https://...",
  "date": "2026-07-29",
  "sourceType": "SEC filing"
}
```

- One entry expresses one fact.
- Source and date must be present; qualitative evidence older than 550 days must be refreshed or downgraded.
- Management self-reporting alone does not prove a moat, culture, or competitive advantage.
- Capture supporting evidence, contrary evidence, and unknowns at the same time.

## Freshness and Unknowns

- Identity data is in principle no more than 45 days old.
- Market price no more than 7 days old.
- Missing facts must be left empty or written to `unknowns`; never dress up estimates as facts.
- Without normalized owner earnings, a historical valuation range, or a stated opportunity cost, the row must NOT be marked "margin of safety sufficient".
