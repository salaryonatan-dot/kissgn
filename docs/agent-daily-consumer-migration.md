# Agent/Daily consumer migration checkpoint

Base: `8511d7b2d3e4c89659b1ae006f6bdb1e9670b826` (`CHANGES_REQUIRED`). This is a provisional consumer change for later independent review on an approved integration successor. It does not approve or repair the registry, VAT guard, delivery system, or financial core.

## Financial source flow

Before: Agent direct queries averaged or summed daily financial percentages; labor detector averaged daily labor percent; forecast detector used local pace and 28/33 constants; purchase detector split daily positive food costs into two half windows. Alerts computed 7-day ratios from flat analytics docs. Zero revenue was treated as a closed day in suppression.

After: `loadAgentFinancialMonth` binds a canonical `loadCanonicalInputs` read, `canonicalMonthReport`, `canonicalMonthProjection`, and resolved policy to one tenant, business, instant and month. Direct Food Cost and labor queries accept only a whole closed month or current open month Actual through D-1. They use report totals and exact ratios, retaining zero denominator, incomplete and invalid states as unavailable. The Daily labor and forecast-risk detectors use the report and resolved policy; the forecast analyzer displays only a complete canonical forecast. The Daily purchase trend and the legacy alert purchase trend have no authoritative exact two-window report interface, so they emit no financial conclusion and expose a limitation. The legacy weak-day alert lacks exact-window closure evidence and is likewise held with a limitation; the Daily weak-day detector uses completed month revenue and declared closures.

The source has no arbitrary matched-window report. Required shared interface: given `(tenantId,bizId,asOfBusinessDate,from,to)`, return two *explicitly paired*, complete or typed-unavailable purchase and revenue totals over completed business days, with issue-date supplier credits including credit-only dates, the approved cost timeline, declared closures, provenance, and coverage. It must never turn a rejected activation into valid cost history; ordinary edit rejection may preserve previous valid history. This interface belongs to the Core/P1 owner. No local substitute is introduced.

## Verified local formula leads

| Consumer | Old interpretation | Disposition |
|---|---|---|
| `analyzeDirectMetric` | mean daily labor/Food Cost percentages | month report ratio of totals |
| `analyzeAnomaly` | daily labor percentage z-score / 32 and 35 | report ratio and resolved alert policy, only where period matches |
| `analyzeForecast` | MTD revenue / elapsed days × remaining days | canonical projection only |
| `detectLaborInefficiency` | mean daily labor percentages; 28/30/35 | full employer cost report and policy |
| `detectForecastRisk` | private revenue pace and mean labor/Food Cost, 28/33 | canonical projection and report, policy goals |
| `detectPurchasesWithoutRevenueSupport` | two positive-only half windows | held pending exact-window source |
| `checkLaborPct` | 7-day daily labor / revenue | month full employer cost ratio |
| `checkFoodCostPct` | 7-day daily Food Cost / revenue | month net purchases ratio, including credits |
| `checkPurchaseTrend` | two 7-day daily Food Cost sums | held pending exact-window source |

The preparation's nine was a useful lead, not a proof of nine identical formulas. Other reachable revenue/weekday analyses remain local and are listed below.

## Threshold sources and precedence

Four sources were found: `src/policy/registry.ts` (configured targets plus labelled compatibility defaults), `src/alerts/types.ts` and `alert_config` per business (owner-facing alert overrides), local constants in Agent/Daily detectors and anomaly rules, and retained `src/insights/rules.ts` thresholds. The policy registry is authoritative for goal and compatibility alert defaults. Alert overrides stored under `tenants/{tid}/alert_config/{bizId}` keep their owner-facing units and precedence for alerts only. A malformed or unreadable override is an error. Daily labor uses resolved report policy; alert labor and Food Cost use owner overrides over registry defaults. This split is an unresolved product precedence question if Daily is expected to obey `alert_config` overrides; this checkpoint does not silently choose a new precedence. Existing strict alert comparison uses `>=`; Daily labor uses its previous `>` semantics. A combined shared finding system needs one boundary decision.

## Detector evidence and suppression

| Conclusion | Minimum trusted inputs | Partial/unavailable outcome |
|---|---|---|
| Revenue underperformance | at least 14 trusted completed revenue points, declared closures removed when current-month calendar exists | no finding; no healthy claim |
| Labor inefficiency | actual month, complete full employer cost ratio, ≥7 revenue days, resolved policy | no finding; digest records labor state |
| Weak day | complete current-month revenue, explicit operating-day zero, declared closures removed, 28 points and per-weekday samples | no finding; coverage insufficiency should be interpreted as unknown |
| Purchase trend | two matched complete windows with credits | no finding; `purchase_trend_exact_window_source_unavailable` |
| Forecast risk | complete canonical projection, complete reported candidate ratio, resolved goal | no unsupported candidate; digest records missing ratio/forecast |
| Legacy weak-day alert | exact-window closure calendar unavailable | non-firing; runner limitation |
| Legacy purchase-trend alert | exact-window credit-inclusive report unavailable | non-firing; runner limitation |

`runForBiz` calls the existing detectors, then the existing confidence/dedup/suppression/storage path, reads today's persisted insights, selects the ranked top three, writes the Daily digest, and verifies readback. Readback mismatch is reported as `digest_persistence_failed`. This is a consumer-side durability check, not an exactly-once job receipt.

## Remaining reachable work and integration decisions

`analyzeTrend`, `analyzeComparison`, `selectBaseline`, the retained `insights-v1` engine, old alert runner/business discovery, and snapshot email have their own revenue/weekday or delivery interpretations. They were not converted to a common finding contract in this checkpoint. In particular, `insights-v1` can remain an owner-visible path unless its pilot reachability is removed or migrated. The old B1 guard pins `src/agent/**` and the snapshot email blob, so requested Agent changes cannot pass GUARD-05 without an authorized later guard transition. GUARD-02's importer manifest also needs a reviewed new consumer entry for the Agent month adapter and alert month checker. Neither guard was weakened here. Acceptance on the approved successor must include these ownership decisions and fresh guard evidence.

No schedule, email, deployed rule, pin or protected source calculation was changed.
