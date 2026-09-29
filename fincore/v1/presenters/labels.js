// Hebrew labels for provenance shown next to financial figures (consumed from Slice C1).
export const LABELS = Object.freeze({
    basis: Object.freeze({ net_of_vat: "נטו (ללא מע״מ)" }),
    configurationBasis: Object.freeze({
        recorded: "לפי היסטוריית הגדרות",
        attested_retroactive: "הוצהר בדיעבד ע״י הבעלים",
        current_applied_retrospectively: "לפי הגדרות נוכחיות",
    }),
    presence: Object.freeze({ absent: "לא הוזן", invalid: "ערך לא תקין", missingDay: "לא הוזן", closedDay: "יום סגור", currentDay: "היום — מחוץ לבפועל (עד אתמול)" }),
    labor: Object.freeze({
        meaning: "עלות מעסיק מלאה",
        sourceSystem: Object.freeze({ attendance_workforce: "ממערכת הנוכחות", marjin_workforce: "ממודול כוח האדם של מרג'ין", marjin_employee_config: "עובדים גלובליים במרג'ין" }),
        ingestionMethod: Object.freeze({ manual: "הוזן ידנית", integration: "התקבל בחיבור ישיר" }),
        hourly: "עלות מעסיק — עובדים שעתיים",
        global: "עלות מעסיק — עובדים גלובליים (לפי ימי לוח שנה)",
        legacyHourlyPayrollNotCounted: "שדה ישן (hourly_payroll) — לא נספר",
    }),
    incomplete: Object.freeze({
        revenue_missing: "אין הכנסות רשומות",
        incomplete_components: "חסרים נתונים",
        invalid_components: "ערכים לא תקינים",
        empty_window: "אין עדיין יום שהושלם החודש",
    }),
});
