// Browser entry of the generated Financial Core artifact (fincore/v1). The browser runs
// the SAME compiled source as the server — there is no hand-maintained browser engine.
import * as decimal from "../finance/decimal.js";
import * as cells from "../finance/cells.js";
import * as businessDate from "../finance/businessDate.js";
import * as normalize from "../finance/normalize.js";
import * as purchaseBasis from "../finance/purchaseBasis.js";
import * as costTimeline from "../metrics/costTimeline.js";
import * as report from "../metrics/report.js";
import * as projected from "../metrics/projected.js";
import * as legacyNumber from "../metrics/adapters/legacyNumber.js";
import * as configCompat from "../metrics/adapters/configCompat.js";
import * as policyRegistry from "../policy/registry.js";
import * as policyEvaluate from "../policy/evaluate.js";
import * as productPurchaseBasis from "../policy/purchaseBasis.js";
import * as money from "../presenters/money.js";
import * as percent from "../presenters/percent.js";
import * as labels from "../presenters/labels.js";
import * as forecast from "../forecast/revenueForecast.js";
const api = Object.freeze({
    versions: Object.freeze({
        fin: report.FINANCIAL_FORMULA_VERSION,
        norm: normalize.NORMALIZATION_VERSION,
        dec: decimal.DECIMAL_CONTRACT_VERSION,
        pb: purchaseBasis.PURCHASE_BASIS_CONTRACT_VERSION,
        policy: policyRegistry.POLICY_VERSION,
        projection: projected.PROJECTION_FORMULA_VERSION,
        forecast: forecast.REV_FORECAST_FORMULA_ID,
    }),
    finance: Object.freeze({ decimal, cells, businessDate, normalize, purchaseBasis }),
    metrics: Object.freeze({ costTimeline, report, projected, adapters: Object.freeze({ legacyNumber, configCompat }) }),
    policy: Object.freeze({ registry: policyRegistry, evaluate: policyEvaluate, purchaseBasis: productPurchaseBasis }),
    presenters: Object.freeze({ money, percent, labels }),
    forecast,
});
globalThis.MarjinFinance = api;
export default api;
