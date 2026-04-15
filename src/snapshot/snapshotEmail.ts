import { sendEmail } from "../../lib/sendEmail.js";
import { SnapshotData } from "./snapshotBuilder.js";

function formatCurrency(value: number): string {
  return `₪${new Intl.NumberFormat("he-IL").format(Math.round(value))}`;
}

function getInsightEmoji(type: "positive" | "negative" | "warning"): string {
  switch (type) {
    case "positive":
      return "🟢";
    case "negative":
      return "🔴";
    case "warning":
      return "🟡";
  }
}

function getHebrewDateString(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const months = [
    "ינואר",
    "פברואר",
    "מרץ",
    "אפריל",
    "מאי",
    "יוני",
    "יולי",
    "אוגוסט",
    "ספטמבר",
    "אוקטובר",
    "נובמבר",
    "דצמבר",
  ];
  const monthNum = parseInt(month) - 1;
  return `${day} ${months[monthNum]} ${year}`;
}

export async function sendSnapshotEmail(
  to: string,
  snapshot: SnapshotData
): Promise<void> {
  const hebrewDate = getHebrewDateString(snapshot.date);
  const subject = `📊 ${snapshot.bizName} — דוח בוקר ${hebrewDate} | רווח: ${formatCurrency(snapshot.netProfit)}`;

  // Progress bar calculation
  const progressPercent = (snapshot.daysPassed / snapshot.daysInMonth) * 100;

  // Build KPI rows
  const kpiRows = [
    {
      label: "הכנסות",
      value: snapshot.totalSales,
      pct: 100,
      target: snapshot.targetSales,
    },
    {
      label: "קניות (מזון)",
      value: snapshot.totalFood,
      pct: snapshot.foodCostPct,
      target: snapshot.targetFoodCost,
    },
    {
      label: "עלות עובדים",
      value: snapshot.totalPayroll,
      pct: snapshot.laborPct,
      target: snapshot.targetLabor,
    },
    {
      label: "הוצאות קבועות",
      value: snapshot.fixedRegular,
      pct: snapshot.totalSales > 0 ? (snapshot.fixedRegular / snapshot.totalSales) * 100 : 0,
      target: null,
    },
    {
      label: "שכר דירה",
      value: snapshot.rentAmount,
      pct: snapshot.totalSales > 0 ? (snapshot.rentAmount / snapshot.totalSales) * 100 : 0,
      target: null,
    },
    {
      label: "תמלוגים",
      value: snapshot.royaltyAmount,
      pct: snapshot.totalSales > 0 ? (snapshot.royaltyAmount / snapshot.totalSales) * 100 : 0,
      target: null,
    },
    {
      label: "רווח נקי",
      value: snapshot.netProfit,
      pct: snapshot.totalSales > 0 ? (snapshot.netProfit / snapshot.totalSales) * 100 : 0,
      target: null,
    },
  ];

  // Build insights HTML
  let insightsHtml = "";
  for (const insight of snapshot.insights) {
    const emoji = getInsightEmoji(insight.type);
    insightsHtml += `
      <div style="margin: 12px 0; padding: 12px; background-color: #f9fafb; border-right: 4px solid ${
        insight.type === "positive"
          ? "#10b981"
          : insight.type === "negative"
            ? "#ef4444"
            : "#f59e0b"
      }; border-radius: 4px; text-align: right;">
        <span style="font-size: 16px; margin-left: 8px;">${emoji}</span>
        <span style="color: #374151; font-size: 14px;">${insight.message}</span>
      </div>
    `;
  }

  const htmlBody = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      direction: rtl;
      margin: 0;
      padding: 0;
      background-color: #f3f4f6;
    }
    .container {
      max-width: 600px;
      margin: 20px auto;
      background-color: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #111827 0%, #1f2937 100%);
      color: white;
      padding: 32px 24px;
      text-align: center;
    }
    .header-title {
      font-size: 28px;
      font-weight: bold;
      margin: 0 0 12px 0;
    }
    .header-subtitle {
      font-size: 14px;
      opacity: 0.9;
      margin: 0;
    }
    .content {
      padding: 24px;
    }
    .date-line {
      text-align: center;
      margin-bottom: 24px;
      padding-bottom: 12px;
      border-bottom: 1px solid #e5e7eb;
    }
    .date-line-date {
      font-size: 16px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 4px;
    }
    .date-line-day {
      font-size: 12px;
      color: #6b7280;
    }
    .progress-section {
      margin-bottom: 24px;
    }
    .progress-label {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 8px;
      text-align: right;
    }
    .progress-bar-container {
      width: 100%;
      height: 8px;
      background-color: #e5e7eb;
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      background-color: #3b82f6;
      transition: width 0.3s ease;
    }
    .progress-stats {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      font-size: 12px;
      color: #6b7280;
    }
    .kpi-section {
      margin-bottom: 24px;
    }
    .kpi-title {
      font-size: 14px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 12px;
      text-align: right;
    }
    .kpi-table {
      width: 100%;
      border-collapse: collapse;
    }
    .kpi-row {
      border-bottom: 1px solid #e5e7eb;
    }
    .kpi-row:last-child {
      border-bottom: none;
      background-color: #f9fafb;
      font-weight: 600;
    }
    .kpi-cell {
      padding: 12px 8px;
      font-size: 13px;
      text-align: right;
    }
    .kpi-label {
      color: #374151;
    }
    .kpi-value {
      color: #1f2937;
      font-weight: 500;
      text-align: left;
    }
    .kpi-pct {
      color: #6b7280;
      font-size: 12px;
      text-align: left;
    }
    .pace-section {
      margin-bottom: 24px;
      padding: 16px;
      background-color: #eff6ff;
      border-radius: 6px;
      border-right: 4px solid #3b82f6;
    }
    .pace-title {
      font-size: 14px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 12px;
      text-align: right;
    }
    .pace-row {
      display: flex;
      justify-content: space-between;
      margin: 8px 0;
      font-size: 13px;
    }
    .pace-label {
      color: #374151;
    }
    .pace-value {
      color: #1f2937;
      font-weight: 500;
    }
    .forecast-section {
      margin-bottom: 24px;
      padding: 16px;
      background-color: #fef3c7;
      border-radius: 6px;
      border-right: 4px solid #f59e0b;
    }
    .forecast-title {
      font-size: 14px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 12px;
      text-align: right;
    }
    .forecast-value {
      font-size: 20px;
      font-weight: bold;
      color: #1f2937;
      text-align: right;
    }
    .forecast-label {
      font-size: 12px;
      color: #6b7280;
      margin-top: 4px;
      text-align: right;
    }
    .insights-section {
      margin-bottom: 24px;
    }
    .insights-title {
      font-size: 14px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 12px;
      text-align: right;
    }
    .insight-item {
      margin: 12px 0;
      padding: 12px;
      background-color: #f9fafb;
      border-right: 4px solid #cbd5e1;
      border-radius: 4px;
      text-align: right;
    }
    .insight-positive {
      border-right-color: #10b981;
    }
    .insight-negative {
      border-right-color: #ef4444;
    }
    .insight-warning {
      border-right-color: #f59e0b;
    }
    .insight-emoji {
      font-size: 16px;
      margin-left: 8px;
    }
    .insight-text {
      color: #374151;
      font-size: 14px;
    }
    .footer {
      background-color: #f9fafb;
      padding: 16px 24px;
      text-align: center;
      border-top: 1px solid #e5e7eb;
    }
    .footer-text {
      font-size: 12px;
      color: #6b7280;
      margin: 4px 0;
    }
    .footer-link {
      color: #3b82f6;
      text-decoration: none;
    }
    .footer-link:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-title">📊 דוח בוקר יומי — Marjin</div>
      <div class="header-subtitle">${snapshot.bizName}</div>
    </div>

    <div class="content">
      <div class="date-line">
        <div class="date-line-date">${hebrewDate}</div>
        <div class="date-line-day">יום ${snapshot.daysPassed} מתוך ${snapshot.daysInMonth} ימים בחודש</div>
      </div>

      <div class="progress-section">
        <div class="progress-label">התקדמות החודש</div>
        <div class="progress-bar-container">
          <div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
        </div>
        <div class="progress-stats">
          <span>${snapshot.daysLeft} ימים נותרים</span>
          <span>${progressPercent.toFixed(0)}%</span>
        </div>
      </div>

      <div class="kpi-section">
        <div class="kpi-title">📊 מדדי ביצוע עיקריים</div>
        <table class="kpi-table">
          <tbody>
            ${kpiRows
              .map(
                (row, idx) => `
              <tr class="kpi-row">
                <td class="kpi-cell kpi-label" style="width: 40%;">${row.label}</td>
                <td class="kpi-cell kpi-value" style="width: 35%; text-align: left;">${formatCurrency(row.value)}</td>
                <td class="kpi-cell kpi-pct" style="width: 25%; text-align: left;">
                  ${row.pct.toFixed(1)}%${
                    row.target !== null
                      ? ` (יעד: ${row.target.toFixed(1)}%)`
                      : ""
                  }
                </td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>

      <div class="pace-section">
        <div class="pace-title">📈 קצב חודשי חזוי</div>
        <div class="pace-row">
          <span class="pace-value">${formatCurrency(snapshot.paceRevenue)}</span>
          <span class="pace-label">הכנסה חזויה לחודש</span>
        </div>
        <div class="pace-row">
          <span class="pace-value" style="color: ${snapshot.paceVsTarget >= 0 ? "#10b981" : "#ef4444"};">${snapshot.paceVsTarget >= 0 ? "+" : ""}${snapshot.paceVsTarget.toFixed(1)}%</span>
          <span class="pace-label">ביחס ליעד (₪${formatCurrency(snapshot.targetSales)})</span>
        </div>
      </div>

      <div class="forecast-section">
        <div class="forecast-title">🎯 תחזוקה לסוף החודש</div>
        <div class="forecast-value" style="color: ${snapshot.forecast >= 0 ? "#10b981" : "#ef4444"};">${formatCurrency(snapshot.forecast)}</div>
        <div class="forecast-label">רווח נקי חזוי בסיום החודש</div>
      </div>

      ${
        snapshot.insights.length > 0
          ? `
      <div class="insights-section">
        <div class="insights-title">💡 התראות חכמות</div>
        ${snapshot.insights
          .map((insight) => {
            const typeClass =
              insight.type === "positive"
                ? "insight-positive"
                : insight.type === "negative"
                  ? "insight-negative"
                  : "insight-warning";
            return `
          <div class="insight-item ${typeClass}">
            <span class="insight-emoji">${getInsightEmoji(insight.type)}</span>
            <span class="insight-text">${insight.message}</span>
          </div>
        `;
          })
          .join("")}
      </div>
      `
          : ""
      }
    </div>

    <div class="footer">
      <div class="footer-text">
        <a href="https://app.marjin.app" class="footer-link">🔗 לחץ כאן לחזרה לאפליקציה</a>
      </div>
      <div class="footer-text">דוח זה נשלח אליך אוטומטית על ידי מערכת Marjin</div>
    </div>
  </div>
</body>
</html>
  `;

  await sendEmail(to, subject, htmlBody);
}
