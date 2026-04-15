import { getDb } from "../firebase/admin.js";

export interface SnapshotData {
  tenantId: string;
  bizId: string;
  bizName: string;
  date: string; // ISO date in Israel timezone
  month: string; // YYYY-MM

  // P&L Metrics
  totalSales: number;
  totalFood: number;
  totalPayroll: number;
  totalOtherExpense: number;
  fixedRegular: number;
  rentAmount: number;
  royaltyAmount: number;
  totalExpenses: number;
  netProfit: number;

  // Percentages
  foodCostPct: number;
  laborPct: number;

  // Time metrics
  daysPassed: number;
  daysInMonth: number;
  daysLeft: number;

  // Forecasts
  dailyAvg: number;
  forecast: number;
  paceRevenue: number;
  paceVsTarget: number; // percentage

  // Targets
  targetSales: number;
  targetFoodCost: number;
  targetLabor: number;

  // Insights
  insights: Array<{
    type: "positive" | "negative" | "warning";
    message: string;
  }>;
}

interface DailyEntry {
  date: string;
  sales: number;
  deliveries: number;
  food_cost: number;
  payroll: number;
  hourly_payroll?: Record<string, number>;
  other_expense: number;
  other_income: number;
  supplier_payments?: Record<string, number>;
}

interface FixedExpense {
  name: string;
  amount: number;
  rentPct?: boolean;
  royaltyPct?: boolean;
  disabled?: boolean;
}

interface Employee {
  name: string;
  type: "global" | "hourly" | "fixed";
  monthlySalary?: number;
}

interface Config {
  rentPct?: number;
  rentType?: "pct" | "fixed";
  rentFixed?: number;
  hasRoyalty?: boolean;
  royaltyPct?: number;
  targetSales: number;
  targetFoodCost: number;
  targetLabor: number;
  employees?: Employee[];
  suppliers?: Array<{ name: string }>;
}

interface Business {
  id: string;
  name: string;
}

function getIsraelDateString(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function getMonthString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function getDayOfMonth(date: Date): number {
  return date.getDate();
}

function parseFirebaseData<T>(value: any): T {
  if (!value) return [] as T;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return [] as T;
    }
  }
  if (value._v) {
    try {
      return JSON.parse(value._v);
    } catch {
      return [] as T;
    }
  }
  return value as T;
}

export async function buildSnapshotForBiz(
  tenantId: string,
  bizId: string
): Promise<SnapshotData> {
  const db = getDb();

  // Get current date in Israel timezone
  const now = new Date();
  const israelDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  const currentDateStr = getIsraelDateString(israelDate);
  const currentMonth = getMonthString(israelDate);
  const currentDayOfMonth = getDayOfMonth(israelDate);
  const daysInCurrentMonth = getDaysInMonth(israelDate);

  // Fetch all required data
  const [entriesSnap, fixedSnap, configSnap, businessSnap] = await Promise.all([
    db.ref(`tenants/${tenantId}/biz:${bizId}:entries`).once("value"),
    db.ref(`tenants/${tenantId}/biz:${bizId}:fixed`).once("value"),
    db.ref(`tenants/${tenantId}/biz:${bizId}:config`).once("value"),
    db.ref(`tenants/${tenantId}/app/business`).once("value"),
  ]);

  const entries = parseFirebaseData<DailyEntry[]>(entriesSnap.val());
  const fixedExpenses = parseFirebaseData<FixedExpense[]>(fixedSnap.val());
  const config = parseFirebaseData<Config>(configSnap.val());
  const businesses = parseFirebaseData<Business[]>(businessSnap.val());

  // Find business name
  const business = businesses.find((b) => b.id === bizId);
  const bizName = business?.name || "Unknown";

  // Filter entries for current month
  const monthEntries = entries.filter((e) => e.date?.startsWith(currentMonth));

  // Initialize metrics
  let totalSales = 0;
  let totalFood = 0;
  let totalPayroll = 0;
  let totalOtherExpense = 0;
  let totalSupplierPayments = 0;
  let totalHourlyPayroll = 0;

  // Aggregate entries
  for (const entry of monthEntries) {
    totalSales += entry.sales || 0;
    totalSales += entry.deliveries || 0;
    totalSales += entry.other_income || 0;

    totalFood += entry.food_cost || 0;
    totalSupplierPayments += Object.values(entry.supplier_payments || {}).reduce(
      (sum, val) => sum + (val || 0),
      0
    );

    totalPayroll += entry.payroll || 0;
    totalHourlyPayroll += Object.values(entry.hourly_payroll || {}).reduce(
      (sum, val) => sum + (val || 0),
      0
    );

    totalOtherExpense += entry.other_expense || 0;
  }

  // Use supplier_payments if available, otherwise food_cost
  if (totalSupplierPayments > 0) {
    totalFood = totalSupplierPayments;
  }

  // Calculate prorated global employees for the month
  let globalEmployeePayroll = 0;
  const employees = config.employees || [];
  const globalEmployees = employees.filter((e) => e.type === "global");
  const globalMonthlyTotal = globalEmployees.reduce((a, e) => a + (e.monthlySalary || 0), 0);
  globalEmployeePayroll = daysInCurrentMonth > 0
    ? Math.round(globalMonthlyTotal * (monthEntries.length / daysInCurrentMonth))
    : 0;

  totalPayroll += globalEmployeePayroll;
  totalPayroll += totalHourlyPayroll;

  // Calculate fixed expenses (excluding rent and royalty)
  let fixedRegular = 0;
  for (const fixed of fixedExpenses) {
    if (fixed.disabled) continue;
    if (fixed.rentPct || fixed.royaltyPct) continue;

    if (fixed.amount) {
      fixedRegular += fixed.amount;
    }
  }

  // Calculate rent
  let rentAmount = 0;
  if (config.rentType === "pct" && config.rentPct) {
    rentAmount = totalSales * (config.rentPct / 100);
  } else if (config.rentFixed) {
    rentAmount = config.rentFixed;
  }

  // Calculate royalty
  let royaltyAmount = 0;
  if (config.hasRoyalty && config.royaltyPct) {
    royaltyAmount = totalSales * (config.royaltyPct / 100);
  }

  // Calculate totals
  const totalExpenses =
    totalFood + totalPayroll + totalOtherExpense + fixedRegular + rentAmount + royaltyAmount;
  const netProfit = totalSales - totalExpenses;

  // Calculate percentages
  const foodCostPct = totalSales > 0 ? (totalFood / totalSales) * 100 : 0;
  const laborPct = totalSales > 0 ? (totalPayroll / totalSales) * 100 : 0;

  // Time metrics — use actual entries count (days with data entered)
  const daysPassed = monthEntries.length;
  const daysLeft = daysInCurrentMonth - currentDayOfMonth;

  // Forecasts
  const dailyAvg = daysPassed > 0 ? netProfit / daysPassed : 0;
  const forecast = netProfit + dailyAvg * daysLeft;
  const paceRevenue = daysPassed > 0 ? (totalSales / daysPassed) * daysInCurrentMonth : 0;
  const paceVsTarget = config.targetSales > 0
    ? ((paceRevenue - config.targetSales) / config.targetSales) * 100
    : 0;

  // Generate insights
  const insights: Array<{ type: "positive" | "negative" | "warning"; message: string }> = [];

  // Food cost insight
  if (foodCostPct > (config.targetFoodCost || 33) + 3) {
    insights.push({
      type: "negative",
      message: `עלות המזון גבוהה מהיעד: ${foodCostPct.toFixed(1)}% (יעד: ${config.targetFoodCost}%)`,
    });
  } else if (foodCostPct < (config.targetFoodCost || 33) - 3) {
    insights.push({
      type: "positive",
      message: `עלות המזון נמוכה מהיעד: ${foodCostPct.toFixed(1)}% (יעד: ${config.targetFoodCost}%)`,
    });
  }

  // Labor insight
  if (laborPct > (config.targetLabor || 27) + 3) {
    insights.push({
      type: "negative",
      message: `עלות העובדים גבוהה מהיעד: ${laborPct.toFixed(1)}% (יעד: ${config.targetLabor}%)`,
    });
  } else if (laborPct < (config.targetLabor || 27) - 3) {
    insights.push({
      type: "positive",
      message: `עלות העובדים נמוכה מהיעד: ${laborPct.toFixed(1)}% (יעד: ${config.targetLabor}%)`,
    });
  }

  // Revenue pace insight
  if (paceRevenue < (config.targetSales || 700000) * 0.9) {
    insights.push({
      type: "negative",
      message: `קצב ההכנסות נמוך מהיעד: ₪${Math.round(paceRevenue).toLocaleString("he-IL")} (יעד: ₪${Math.round(config.targetSales || 700000).toLocaleString("he-IL")})`,
    });
  } else if (paceRevenue > (config.targetSales || 700000) * 1.05) {
    insights.push({
      type: "positive",
      message: `קצב ההכנסות גבוה מהיעד: ₪${Math.round(paceRevenue).toLocaleString("he-IL")} (יעד: ₪${Math.round(config.targetSales || 700000).toLocaleString("he-IL")})`,
    });
  }

  // Net profit insight
  if (netProfit < 0) {
    insights.push({
      type: "negative",
      message: `רווח נקי שלילי: ₪${Math.round(netProfit).toLocaleString("he-IL")}`,
    });
  } else if (netProfit > config.targetSales * 0.15) {
    insights.push({
      type: "positive",
      message: `רווח נקי חזק: ₪${Math.round(netProfit).toLocaleString("he-IL")}`,
    });
  }

  return {
    tenantId,
    bizId,
    bizName,
    date: currentDateStr,
    month: currentMonth,
    totalSales,
    totalFood,
    totalPayroll,
    totalOtherExpense,
    fixedRegular,
    rentAmount,
    royaltyAmount,
    totalExpenses,
    netProfit,
    foodCostPct,
    laborPct,
    daysPassed,
    daysInMonth: daysInCurrentMonth,
    daysLeft,
    dailyAvg,
    forecast,
    paceRevenue,
    paceVsTarget,
    targetSales: config.targetSales || 700000,
    targetFoodCost: config.targetFoodCost || 33,
    targetLabor: config.targetLabor || 27,
    insights,
  };
}

export async function buildSnapshotForAll(): Promise<SnapshotData[]> {
  const db = getDb();
  const snapshots: SnapshotData[] = [];

  // Try to get proactive_biz_index first
  let activeBusinesses: Array<{ tenantId: string; bizId: string }> = [];

  try {
    const indexSnap = await db.ref("proactive_biz_index").once("value");
    const indexData = indexSnap.val();

    if (indexData && typeof indexData === "object") {
      for (const [key, value] of Object.entries(indexData)) {
        if (
          typeof value === "object" &&
          value !== null &&
          (value as any).active === true
        ) {
          const parts = key.split(":");
          if (parts.length === 2) {
            activeBusinesses.push({
              tenantId: parts[0],
              bizId: parts[1],
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("Error reading proactive_biz_index, falling back to tenant discovery:", error);
  }

  // If no active businesses found, discover from tenants
  if (activeBusinesses.length === 0) {
    try {
      const tenantsSnap = await db.ref("tenants").once("value");
      const tenantsData = tenantsSnap.val();

      if (tenantsData && typeof tenantsData === "object") {
        for (const [tenantId, tenantData] of Object.entries(tenantsData)) {
          if (
            typeof tenantData === "object" &&
            tenantData !== null &&
            (tenantData as any).app?.business
          ) {
            const businesses = parseFirebaseData<Business[]>(
              (tenantData as any).app.business
            );
            for (const biz of businesses) {
              activeBusinesses.push({
                tenantId,
                bizId: biz.id,
              });
            }
          }
        }
      }
    } catch (error) {
      console.error("Error discovering businesses from tenants:", error);
      return snapshots;
    }
  }

  // Build snapshots for each active business
  for (const { tenantId, bizId } of activeBusinesses) {
    try {
      const snapshot = await buildSnapshotForBiz(tenantId, bizId);
      snapshots.push(snapshot);
    } catch (error) {
      console.error(`Error building snapshot for ${tenantId}:${bizId}:`, error);
    }
  }

  return snapshots;
}
