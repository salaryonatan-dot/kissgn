// Browser entry of the generated Financial Core artifact (fincore/v1). The browser runs
// the SAME compiled source as the server — there is no hand-maintained browser engine.
import * as decimal from "../finance/decimal.js";
import * as cells from "../finance/cells.js";
import * as businessDate from "../finance/businessDate.js";
import * as normalize from "../finance/normalize.js";
import * as purchaseBasis from "../finance/purchaseBasis.js";
import * as labor from "../finance/labor.js";
import * as costTimeline from "../metrics/costTimeline.js";
import * as report from "../metrics/report.js";
import * as projected from "../metrics/projected.js";
import * as legacyNumber from "../metrics/adapters/legacyNumber.js";
import * as configCompat from "../metrics/adapters/configCompat.js";
import * as policyRegistry from "../policy/registry.js";
import * as policyEvaluate from "../policy/evaluate.js";
import * as productPurchaseBasis from "../policy/purchaseBasis.js";
import * as productLaborSource from "../policy/laborSource.js";
import * as money from "../presenters/money.js";
import * as percent from "../presenters/percent.js";
import * as labels from "../presenters/labels.js";
import * as forecast from "../forecast/revenueForecast.js";
// Slice B1 (AMEND-01): the product composition shared by server and browser.
import * as product from "../policy/productFinance.js";

// Intelligence contracts (owner decision BD-4) are types only in Slice A.
export type {
  IntelligenceLayer, ExpectedExceptionWindow, ScenarioAssumption, RootCauseDriver, RecoverabilityState, RecoverabilityInput, RecoverabilityResult,
} from "../policy/intelligence.js";

const api = Object.freeze({
  versions: Object.freeze({
    fin: report.FINANCIAL_FORMULA_VERSION,
    norm: normalize.NORMALIZATION_VERSION,
    dec: decimal.DECIMAL_CONTRACT_VERSION,
    pb: purchaseBasis.PURCHASE_BASIS_CONTRACT_VERSION,
    labor: labor.LABOR_CONTRACT_VERSION,
    policy: policyRegistry.POLICY_VERSION,
    projection: projected.PROJECTION_FORMULA_VERSION,
    forecast: forecast.REV_FORECAST_FORMULA_ID,
    product: product.PRODUCT_FINANCE_VERSION,
  }),
  finance: Object.freeze({ decimal, cells, businessDate, normalize, purchaseBasis, labor }),
  metrics: Object.freeze({ costTimeline, report, projected, adapters: Object.freeze({ legacyNumber, configCompat }) }),
  policy: Object.freeze({ registry: policyRegistry, evaluate: policyEvaluate, purchaseBasis: productPurchaseBasis, laborSource: productLaborSource }),
  presenters: Object.freeze({ money, percent, labels }),
  forecast,
  product,
});

(globalThis as unknown as { MarjinFinance?: unknown }).MarjinFinance = api;

export default api;
