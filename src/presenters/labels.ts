// Hebrew labels for provenance shown next to financial figures (consumed from Slice C1).
export const LABELS = Object.freeze({
  basis: Object.freeze({ net_of_vat: "נטו (ללא מע״מ)" }),
  configurationBasis: Object.freeze({
    recorded: "לפי היסטוריית הגדרות",
    attested_retroactive: "הוצהר בדיעבד ע״י הבעלים",
    current_applied_retrospectively: "לפי הגדרות נוכחיות",
  }),
  presence: Object.freeze({ absent: "לא הוזן", invalid: "ערך לא תקין", missingDay: "לא הוזן", today: "היום (פתוח)" }),
  labor: Object.freeze({
    meaning: "עלות מעסיק מלאה",
    sourceSystem: Object.freeze({ attendance_workforce: "ממערכת הנוכחות", marjin_workforce: "ממודול כוח האדם של מרג'ין" }),
    ingestionMethod: Object.freeze({ manual: "הוזן ידנית", integration: "התקבל בחיבור ישיר" }),
    grossSalaryNotLabor: "שכר ברוטו אינו עלות מעסיק",
  }),
  incomplete: Object.freeze({
    revenue_missing: "אין הכנסות רשומות",
    incomplete_components: "חסרים נתונים",
    invalid_components: "ערכים לא תקינים",
  }),
});
