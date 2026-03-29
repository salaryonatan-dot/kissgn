// Analytics data shapes as stored in Firebase under tenants/{tenantId}/analytics

export interface DailyMetric {
  date: string;           // YYYY-MM-DD
  revenue: number;
  laborCost: number;
  laborPct: number;       // labor / revenue * 100
  foodCost: number;
  foodCostPct: number;
  transactionCount: number;
  avgTicket: number;
  branchId?: string;
}

export interface HourlyMetric {
  date: string;
  hour: number;           // 0-23
  revenue: number;
  laborCost: number;
  transactionCount: number;
  branchId?: string;
}

export interface ProductMetric {
  date: string;
  productName: string;
  quantitySold: number;
  revenue: number;
  category?: string;
  branchId?: string;
}

export interface LaborMetric {
  date: string;
  totalHours: number;
  totalCost: number;
  employeeCount: number;
  costPerHour: number;
  laborPctOfRevenue: number;
  branchId?: string;
}

export interface PurchaseMetric {
  date: string;
  supplierName: string;
  amount: number;
  category?: string;
  branchId?: string;
}

export interface StoredBaseline {
  metric: string;
  baselineType: string;
  dayOfWeek?: number;     // 0=Sun..6=Sat
  hour?: number;
  value: number;
  sampleSize: number;
  stdDev?: number;
  computedAt: string;
  validUntil: string;
  branchId?: string;
}

export interface StoredAnomaly {
  id?: string;
  metric: string;
  date: string;
  severity: "low" | "medium" | "high";
  currentValue: number;
  baselineValue: number;
  deviationPct: number;
  explanation: string;
  detectedAt: string;
  branchId?: string;
}
