// WhatsApp message formatters — Hebrew, emoji-rich, RTL-friendly

const fmt = (n, decimals=0) => 
  Number(n).toLocaleString("he-IL", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const pct = (n) => `${fmt(n,1)}%`;

// ── Daily Report ─────────────────────────────────────────────────────────────
export function dailyReportMessage({ bizName, date, entry, targets = {} }) {
  const vat     = 1.18;
  const sales   = (entry.total_sales || 0) / vat;
  const food    = entry.food_cost    || 0;
  const payroll = entry.payroll      || 0;
  const foodPct = sales > 0 ? (food / sales) * 100 : 0;
  const laborPct= sales > 0 ? (payroll / sales) * 100 : 0;

  const foodAlert  = foodPct  > (targets.foodCostPct  || 33) ? "⚠️" : "✅";
  const laborAlert = laborPct > (targets.laborCostPct || 27) ? "⚠️" : "✅";

  return `
📊 *דוח יומי — ${bizName}*
📅 ${date}
━━━━━━━━━━━━━━━━
💰 *מחזור נטו:* ₪${fmt(sales)}
🍽️ *עלות מזון:* ${foodAlert} ${pct(foodPct)} (יעד: ${pct(targets.foodCostPct||33)})
👥 *עלות עבודה:* ${laborAlert} ${pct(laborPct)} (יעד: ${pct(targets.laborCostPct||27)})
━━━━━━━━━━━━━━━━
_נוצר אוטומטית ע"י Marjin_`.trim();
}

// ── Anomaly Alert ─────────────────────────────────────────────────────────────
export function anomalyAlertMessage({ bizName, date, type, value, target, unit="%" }) {
  const labels = {
    foodCost:  { emoji:"🍽️", name:"עלות מזון"  },
    laborCost: { emoji:"👥", name:"עלות עבודה" },
    lowSales:  { emoji:"📉", name:"מחזור נמוך" },
  };
  const { emoji, name } = labels[type] || { emoji:"⚠️", name: type };
  return `
🚨 *התראת חריגה — ${bizName}*
📅 ${date}
${emoji} *${name}:* ${fmt(value,1)}${unit}
🎯 יעד: ${fmt(target,1)}${unit}
📈 חריגה: ${fmt(value - target, 1)}${unit}
━━━━━━━━━━━━━━━━
_נוצר אוטומטית ע"י Marjin_`.trim();
}

// ── Shift Completion ──────────────────────────────────────────────────────────
export function shiftCompletionMessage({ bizName, managerName, shiftType, date, completedTasks, totalTasks, incidents = [] }) {
  const pctDone = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const statusEmoji = pctDone === 100 ? "✅" : pctDone >= 80 ? "🟡" : "🔴";
  const incidentText = incidents.length > 0
    ? `\n📋 *אירועים:*\n${incidents.map(i => `  • ${i}`).join("\n")}`
    : "";

  return `
${statusEmoji} *סיום משמרת — ${bizName}*
📅 ${date} | ${shiftType}
👤 מנהל: ${managerName || "לא צוין"}
📝 *משימות:* ${completedTasks}/${totalTasks} (${pctDone}%)${incidentText}
━━━━━━━━━━━━━━━━
_נוצר אוטומטית ע"י Marjin_`.trim();
}

// ── Daily Digest (Phase 2 — Proactive AI) ────────────────────────────────────
export function dailyDigestMessage({ bizName, date, topInsights = [], totalDetected = 0, totalSuppressed = 0 }) {
  if (topInsights.length === 0) {
    return `
✅ *סיכום יומי — ${bizName}*
📅 ${date}
━━━━━━━━━━━━━━━━
אין תובנות חדשות היום — הכל תקין!
━━━━━━━━━━━━━━━━
_נוצר אוטומטית ע"י Marjin_`.trim();
  }

  const insightTypeLabels = {
    revenue_underperformance: { emoji: "📉", name: "ירידת הכנסות" },
    labor_inefficiency: { emoji: "👥", name: "חריגת כוח אדם" },
    weak_day_pattern: { emoji: "📅", name: "יום חלש" },
    weak_hour_pattern: { emoji: "🕐", name: "שעה חלשה" },
    purchases_without_revenue: { emoji: "🛒", name: "רכישות ללא תמיכה" },
    forecast_risk: { emoji: "📊", name: "סיכון תחזית" },
  };

  const severityEmoji = { high: "🔴", medium: "🟡", low: "🟢" };

  const insightLines = topInsights.map((insight, i) => {
    const label = insightTypeLabels[insight.type] || { emoji: "⚠️", name: insight.type };
    const sev = severityEmoji[insight.severity] || "⚠️";
    return `${i + 1}. ${sev} ${label.emoji} *${label.name}* — ציון השפעה: ${fmt(insight.impactScore, 2)}`;
  }).join("\n");

  return `
🧠 *סיכום יומי — ${bizName}*
📅 ${date}
━━━━━━━━━━━━━━━━
${insightLines}
━━━━━━━━━━━━━━━━
📊 סה"כ: ${totalDetected} תובנות נבדקו | ${totalSuppressed} סוננו
━━━━━━━━━━━━━━━━
_נוצר אוטומטית ע"י Marjin_`.trim();
}

// ── Weekly Proactive Summary (Phase 2) ───────────────────────────────────────
export function weeklyProactiveSummaryMessage({ bizName, weekStr, highlights = [], chronicPatterns = [], totalGenerated = 0, totalSuppressed = 0 }) {
  const insightTypeLabels = {
    revenue_underperformance: { emoji: "📉", name: "ירידת הכנסות" },
    labor_inefficiency: { emoji: "👥", name: "חריגת כוח אדם" },
    weak_day_pattern: { emoji: "📅", name: "יום חלש" },
    weak_hour_pattern: { emoji: "🕐", name: "שעה חלשה" },
    purchases_without_revenue: { emoji: "🛒", name: "רכישות ללא תמיכה" },
    forecast_risk: { emoji: "📊", name: "סיכון תחזית" },
  };

  const severityEmoji = { high: "🔴", medium: "🟡", low: "🟢" };

  let body = `
🧠 *סיכום שבועי פרואקטיבי — ${bizName}*
📅 ${weekStr}
━━━━━━━━━━━━━━━━`;

  if (highlights.length > 0) {
    body += "\n*תובנות מובילות:*";
    for (let i = 0; i < highlights.length; i++) {
      const h = highlights[i];
      const label = insightTypeLabels[h.type] || { emoji: "⚠️", name: h.type };
      const sev = severityEmoji[h.severity] || "⚠️";
      body += `\n${i + 1}. ${sev} ${label.emoji} *${label.name}* (${h.recurrenceCount > 1 ? `חזר ${h.recurrenceCount} פעמים` : "פעם אחת"})`;
    }
  } else {
    body += "\nאין תובנות בולטות השבוע — הכל תקין!";
  }

  if (chronicPatterns.length > 0) {
    body += "\n━━━━━━━━━━━━━━━━\n⚠️ *בעיות כרוניות:*";
    for (const cp of chronicPatterns) {
      const label = insightTypeLabels[cp.type] || { emoji: "⚠️", name: cp.type };
      body += `\n  ${label.emoji} ${label.name}: ${cp.occurrenceCount} חזרות, סטייה ממוצעת ${fmt(cp.avgDeviationPct, 1)}%`;
    }
  }

  body += `
━━━━━━━━━━━━━━━━
📊 סה"כ: ${totalGenerated} תובנות | ${totalSuppressed} סוננו
━━━━━━━━━━━━━━━━
_נוצר אוטומטית ע"י Marjin_`;

  return body.trim();
}

// ── Weekly Summary ────────────────────────────────────────────────────────────
export function weeklySummaryMessage({ bizName, weekStr, totalSales, avgFoodPct, avgLaborPct, targets = {}, daysCount }) {
  const foodAlert  = avgFoodPct  > (targets.foodCostPct  || 33) ? "⚠️" : "✅";
  const laborAlert = avgLaborPct > (targets.laborCostPct || 27) ? "⚠️" : "✅";

  return `
📊 *סיכום שבועי — ${bizName}*
📅 ${weekStr} (${daysCount} ימים)
━━━━━━━━━━━━━━━━
💰 *מחזור כולל:* ₪${fmt(totalSales)}
📈 *ממוצע יומי:* ₪${fmt(daysCount > 0 ? totalSales / daysCount : 0)}
🍽️ *עלות מזון ממוצעת:* ${foodAlert} ${pct(avgFoodPct)}
👥 *עלות עבודה ממוצעת:* ${laborAlert} ${pct(avgLaborPct)}
━━━━━━━━━━━━━━━━
_נוצר אוטומטית ע"י Marjin_`.trim();
}
