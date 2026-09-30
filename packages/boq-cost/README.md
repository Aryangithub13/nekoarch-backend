# BOQ cost V2

A deterministic, offline costing layer over an immutable Phase 14 `ConstructionReport`. It does not measure geometry or modify V1 estimates.

```ts
import { calculateBoqCost, sampleRateBook, sampleCostingPolicy } from '@designflow/boq-cost';
const report = calculateBoqCost(constructionReport, sampleRateBook(), sampleCostingPolicy());
```

The bundled books and labor rules are **SYNTHETIC / NOT CURRENT MARKET DATA**. Their assembly/layer rules are explicit demonstration data, not labor standards. The pure API also validates caller-supplied books; official persisted API creation selects only the source-controlled books.

Physical kg/m³/l rates use `finalExact`. Bag/piece/each rates use the explicit purchase count and validate compatible units and bag mass. Missing prices produce null monetary fields and `UNPRICED` lines. An unmatched labor basis produces `NOT_EVALUATED`, never a zero-cost priced line.

Labor rules explicitly select an assembly/layer, use the existing mm²/mm³/each basis (converted exactly to m²/m³/each), and either supply a direct rate or hours-per-unit and an hourly rate. A rule prices that stated basis once per upstream calculation item; it does not infer wall sides, coats, productivity or geometry. Duplicate rules on the same assembly/layer are rejected.

INR, USD and EUR use two minor digits in this version. Rates/productivity accept up to six decimal places. BigInt rational multiplication remains exact; each line rounds half-up once, and subtotals sum emitted amounts. Adjustments have unique codes/orders and explicit MATERIAL, LABOR, DIRECT or RUNNING bases. Only percentage additions, fixed additions and bounded fixed deductions are supported. No tax is inferred.

`FULLY_PRICED` describes supported represented scope only. A partial upstream report, missing material rate or unassessed labor prevents `completeTotalAvailable`. `pricedGrandTotal` is always explicitly separated from `completeRepresentedScopeTotal`. Equipment, transport and unrepresented structural/MEP scopes remain excluded even in a fully priced represented report.

The report embeds normalized book/policy snapshots, hashes, stable lines, provenance, exact evidence and deterministic group references. Input/source and report hashes for persisted artifacts remain distinct. Limits apply to input bytes, rate entries, rules, matching work, output lines, warnings, groups and report bytes; excesses raise `COST_RESOURCE_LIMIT`.

See `docs/phase15-design.md`, `docs/PHASE15.md` and `docs/phase15-example.json` for architecture, verification and the persisted synthetic residential example.
