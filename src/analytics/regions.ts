/**
 * Static region taxonomy for Israeli geographic + alert clustering.
 *
 * Two levels:
 *   - Region (גוש)            ~ 13 broad areas covering the country.
 *   - SubRegion (תת-גוש)      ~ 3–5 finer slices per region.
 *
 * Each SubRegion has:
 *   - oref_areas: a list of substrings that should be matched against
 *     the `data`/`area` field of each Oref alert. Matching is permissive
 *     (substring `.includes`), so e.g. "תל אביב" matches both
 *     "תל אביב - מרכז העיר" and "תל אביב - דרום העיר".
 *   - center: approximate lat/lon for the sub-region centroid, used by
 *     the map picker's auto-suggest ("which sub-region is closest to
 *     where you tapped?").
 *
 * The taxonomy is deliberately pragmatic, not exhaustive. Oref publishes
 * ~180 distinct alert areas; we group them so a restaurant owner can
 * say "I'm in the Sharon" without naming every kibbutz on every side.
 * Refinements happen in this file only — no other code knows the names.
 */

export interface SubRegion {
  id: string;             // unique slug (kebab-case ASCII)
  name: string;           // Hebrew display name
  oref_areas: string[];   // substrings to match against Oref data field
  center: { lat: number; lon: number };
}

export interface Region {
  id: string;
  name: string;
  description?: string;   // shown as a hint under the region label in the UI
  sub: SubRegion[];
}

// Sub-region ID convention: `{region_id}__{slug}` so resolver can recover
// the parent region cheaply without a second lookup.

export const REGIONS: Region[] = [
  // ──────────────────────────────────────────────────────────────────────
  // Far north
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "galil-golan",
    name: "גליל וגולן",
    description: "מהחרמון עד הכנרת — קריית שמונה, נהריה, כרמיאל, צפת, רמת הגולן",
    sub: [
      {
        id: "galil-golan__galil-elyon",
        name: "גליל עליון",
        oref_areas: [
          "קריית שמונה", "מטולה", "כפר גלעדי", "מנרה", "מסעדה", "מרגליות",
          "אביבים", "דובב", "בר יוחאי", "צפת", "ראש פינה", "חצור הגלילית",
          "רוסה פינה", "טובא-זנגריה", "עין זיוון",
        ],
        center: { lat: 33.207, lon: 35.570 },
      },
      {
        id: "galil-golan__galil-maaravi",
        name: "גליל מערבי",
        oref_areas: [
          "נהריה", "שלומי", "רוש הנקרה", "אכזיב", "כברי", "געתון",
          "מעלות-תרשיחא", "פקיעין", "כפר ורדים", "אבן מנחם",
        ],
        center: { lat: 33.018, lon: 35.097 },
      },
      {
        id: "galil-golan__galil-merkazi",
        name: "גליל מרכזי / כרמיאל",
        oref_areas: [
          "כרמיאל", "מג'אר", "סכנין", "עראבה", "דיר אל-אסד",
          "טמרה", "ראמה", "פרוד", "חזון",
        ],
        center: { lat: 32.917, lon: 35.298 },
      },
      {
        id: "galil-golan__golan",
        name: "רמת הגולן",
        oref_areas: [
          "קצרין", "מרום גולן", "אל-רום", "אורטל", "אודם",
          "מסעדה", "מג'דל שמס", "בוקעאתא", "נמרוד", "נוב",
          "יונתן", "אלוני הבשן", "רמות", "אניעם",
        ],
        center: { lat: 32.992, lon: 35.690 },
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────
  // Valleys (Yizrael / Beit Shean / Lower Galilee)
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "amakim",
    name: "עמקים",
    description: "עמק יזרעאל ועמק בית שאן — עפולה, נצרת, טבריה, בית שאן",
    sub: [
      {
        id: "amakim__yizrael",
        name: "עמק יזרעאל וגלבוע",
        oref_areas: [
          "עפולה", "מגדל העמק", "נצרת", "נצרת עילית", "אום אל-פחם",
          "בית שערים", "מרחביה", "כפר ברוך", "נהלל", "גניגר",
          "יזרעאל", "כפר תבור", "דברת", "נורית",
        ],
        center: { lat: 32.608, lon: 35.286 },
      },
      {
        id: "amakim__kineret",
        name: "כנרת וטבריה",
        oref_areas: [
          "טבריה", "מגדל", "כפר נחום", "כינרת", "גינוסר",
          "עין גב", "האון", "מעגן", "דגניה",
        ],
        center: { lat: 32.793, lon: 35.531 },
      },
      {
        id: "amakim__beit-shean",
        name: "עמק בית שאן",
        oref_areas: [
          "בית שאן", "כפר רופין", "מעוז חיים", "שדה אליהו", "טירת צבי",
          "רוויה", "סנדלה", "ניר דוד", "שדה נחום",
        ],
        center: { lat: 32.498, lon: 35.500 },
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────
  // Haifa metro
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "haifa",
    name: "חיפה והקריות",
    description: "חיפה, הקריות, נשר, טירת כרמל, יוקנעם",
    sub: [
      {
        id: "haifa__haifa-city",
        name: "חיפה",
        oref_areas: [
          "חיפה", "נשר", "טירת כרמל", "טירת הכרמל",
          "כרמל הצרפתי", "הדר הכרמל", "רמות אלון",
        ],
        center: { lat: 32.794, lon: 34.989 },
      },
      {
        id: "haifa__krayot",
        name: "הקריות",
        oref_areas: [
          "קריית ים", "קריית ביאליק", "קריית מוצקין", "קריית חיים",
          "קריית אתא", "כפר אתא",
        ],
        center: { lat: 32.838, lon: 35.080 },
      },
      {
        id: "haifa__hofei-hacarmel",
        name: "חופי הכרמל",
        oref_areas: [
          "עתלית", "עין הוד", "כרמלים", "צרופה", "הבונים",
          "מעגן מיכאל", "כפר גלים", "פוריידיס", "ג'סר א-זרקא",
          "זיכרון יעקב", "זכרון יעקב",
        ],
        center: { lat: 32.617, lon: 34.949 },
      },
      {
        id: "haifa__yokneam",
        name: "יוקנעם והסביבה",
        oref_areas: [
          "יוקנעם", "יוקנעם עילית", "רמת ישי", "מבשרת ציון",
          "אלוני יצחק", "טבעון", "קריית טבעון",
        ],
        center: { lat: 32.658, lon: 35.108 },
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────
  // North Sharon — Hadera area (the user's region!)
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "sharon-tzfoni",
    name: "שרון צפוני",
    description: "מצפון לנתניה — חדרה, פרדס חנה, בנימינה, גן שמואל, קציר",
    sub: [
      {
        id: "sharon-tzfoni__hadera",
        name: "חדרה והסביבה",
        oref_areas: [
          "חדרה", "גבעת אולגה", "אור עקיבא", "קיסריה",
          "גן שמואל", "מענית", "להבות חביבה",
        ],
        center: { lat: 32.434, lon: 34.919 },
      },
      {
        id: "sharon-tzfoni__pardes-hana",
        name: "פרדס חנה ובנימינה",
        oref_areas: [
          "פרדס חנה", "כרכור", "פרדס חנה-כרכור", "בנימינה",
          "גבעת עדה", "עמיקם", "עין עירון", "תלמי אלעזר",
        ],
        center: { lat: 32.475, lon: 34.972 },
      },
      {
        id: "sharon-tzfoni__menashe",
        name: "מנשה",
        oref_areas: [
          "קציר", "חריש", "ברקאי", "אליקים", "רגבים",
          "מי עמי", "מצפה אילן",
        ],
        center: { lat: 32.480, lon: 35.025 },
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────
  // South Sharon
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "sharon-dromi",
    name: "שרון דרומי",
    description: "נתניה, כפר סבא, רעננה, הוד השרון, רמת השרון",
    sub: [
      {
        id: "sharon-dromi__netanya",
        name: "נתניה והסביבה",
        oref_areas: [
          "נתניה", "אבן יהודה", "תל מונד", "שדה ורבורג", "צורן",
          "קדימה", "אומץ", "עין החורש", "אליכין",
        ],
        center: { lat: 32.328, lon: 34.857 },
      },
      {
        id: "sharon-dromi__kfar-saba",
        name: "כפר סבא, רעננה והוד השרון",
        oref_areas: [
          "כפר סבא", "רעננה", "הוד השרון", "רמת השרון",
          "קלנסווה", "טירה", "ג'לג'וליה", "כפר ברא",
        ],
        center: { lat: 32.182, lon: 34.907 },
      },
      {
        id: "sharon-dromi__herzliya",
        name: "הרצליה",
        oref_areas: ["הרצליה", "הרצליה פיתוח"],
        center: { lat: 32.166, lon: 34.844 },
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────
  // Tel Aviv metro
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "gush-dan",
    name: "גוש דן",
    description: "תל אביב, רמת גן, גבעתיים, חולון, בת ים, פתח תקווה",
    sub: [
      {
        id: "gush-dan__tel-aviv",
        name: "תל אביב והסביבה הקרובה",
        oref_areas: [
          "תל אביב", "רמת גן", "גבעתיים", "בני ברק",
        ],
        center: { lat: 32.085, lon: 34.781 },
      },
      {
        id: "gush-dan__dan-dromi",
        name: "מטרופולין דן דרומי",
        oref_areas: [
          "חולון", "בת ים", "ראשון לציון", "אזור",
          "צהלה", "כפר עם", "חבת ציון",
        ],
        center: { lat: 32.018, lon: 34.778 },
      },
      {
        id: "gush-dan__petah-tikva",
        name: "מזרח גוש דן",
        oref_areas: [
          "פתח תקווה", "ראש העין", "אלעד", "כפר סירקין",
          "סביון", "גני תקווה", "גבעת שמואל", "קריית אונו", "אור יהודה",
        ],
        center: { lat: 32.087, lon: 34.887 },
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────
  // Coastal plain (Shfela)
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "shfela",
    name: "שפלה",
    description: "ראשון לציון, רחובות, נס ציונה, יבנה, רמלה, לוד",
    sub: [
      {
        id: "shfela__rehovot",
        name: "רחובות, נס ציונה ויבנה",
        oref_areas: [
          "רחובות", "נס ציונה", "יבנה", "מזכרת בתיה",
          "פלמחים", "גן יבנה", "באר טוביה", "קוממיות",
        ],
        center: { lat: 31.892, lon: 34.811 },
      },
      {
        id: "shfela__ramla-lod",
        name: "רמלה, לוד ובסביבה",
        oref_areas: [
          "רמלה", "לוד", "מודיעין", "מודיעין עילית", "כפר טרומן",
          "בן שמן", "אחיסמך", "בית עוזיאל", "צפריה",
        ],
        center: { lat: 31.928, lon: 34.871 },
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────
  // Jerusalem and surroundings
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "yerushalayim",
    name: "ירושלים והסביבה",
    description: "ירושלים, מבשרת ציון, בית שמש, גוש עציון",
    sub: [
      {
        id: "yerushalayim__city",
        name: "ירושלים",
        oref_areas: [
          "ירושלים", "מבשרת ציון", "מוצא", "אבו גוש",
          "צור הדסה", "גבעת זאב",
        ],
        center: { lat: 31.778, lon: 35.220 },
      },
      {
        id: "yerushalayim__beit-shemesh",
        name: "בית שמש והרי יהודה",
        oref_areas: [
          "בית שמש", "ירוחם", "צרעה", "שדרות הקדמה",
          "מטע", "צובה",
        ],
        center: { lat: 31.751, lon: 34.989 },
      },
      {
        id: "yerushalayim__etzion",
        name: "גוש עציון",
        oref_areas: [
          "אלון שבות", "אפרת", "כפר עציון", "נווה דניאל",
          "מגדל עוז", "תקוע",
        ],
        center: { lat: 31.660, lon: 35.139 },
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────
  // Southern coastal plain
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "shfela-dromit",
    name: "שפלה דרומית",
    description: "אשדוד, אשקלון, קריית גת, קריית מלאכי",
    sub: [
      {
        id: "shfela-dromit__ashdod",
        name: "אשדוד והסביבה",
        oref_areas: [
          "אשדוד", "ניצן", "ניצנים", "גן שורק", "ניר ישראל",
          "בית עזרא", "שתולים",
        ],
        center: { lat: 31.802, lon: 34.642 },
      },
      {
        id: "shfela-dromit__ashkelon",
        name: "אשקלון והסביבה",
        oref_areas: [
          "אשקלון", "ברכיה", "כוכב מיכאל", "מבקיעים", "ניצנים",
          "כרמיה", "זיקים", "יד מרדכי", "אורות",
        ],
        center: { lat: 31.668, lon: 34.572 },
      },
      {
        id: "shfela-dromit__kiryat-gat",
        name: "קריית גת וקריית מלאכי",
        oref_areas: [
          "קריית גת", "קריית מלאכי", "ערוגות", "תלמים",
          "אחווה", "נחלה", "באר טוביה",
        ],
        center: { lat: 31.611, lon: 34.769 },
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────
  // Gaza envelope and western Negev
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "otef-aza",
    name: "עוטף עזה ונגב מערבי",
    description: "שדרות, נתיבות, אופקים, ושאר היישובים סביב רצועת עזה",
    sub: [
      {
        id: "otef-aza__sderot",
        name: "שדרות והקיבוצים הסמוכים",
        oref_areas: [
          "שדרות", "ניר עם", "אור הנר", "ארז", "יד מרדכי",
          "מפלסים", "גברעם", "רוחמה", "זיקים",
        ],
        center: { lat: 31.524, lon: 34.595 },
      },
      {
        id: "otef-aza__netivot",
        name: "נתיבות ואופקים",
        oref_areas: [
          "נתיבות", "אופקים", "תקומה", "תפרח", "פטיש",
          "אורים", "מבטחים", "בני נצרים", "שובה",
        ],
        center: { lat: 31.422, lon: 34.589 },
      },
      {
        id: "otef-aza__eshkol",
        name: "מועצה אזורית אשכול",
        oref_areas: [
          "מגן", "כיסופים", "נירים", "ניר עוז", "נירעם",
          "שמיר", "סופה", "כרם שלום", "אבשלום", "מעון",
          "עין השלושה", "ניר יצחק", "צאלים",
        ],
        center: { lat: 31.296, lon: 34.421 },
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────
  // Jordan Valley + West Bank
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "bika-yosh",
    name: "בקעה ויו\"ש",
    description: "ביתר עילית, אריאל, מעלה אדומים, בקעת הירדן",
    sub: [
      {
        id: "bika-yosh__shomron",
        name: "שומרון",
        oref_areas: [
          "אריאל", "אלקנה", "ברקן", "קרני שומרון", "אלפי מנשה",
          "עמנואל", "כדומים", "פדואל", "בית אריה",
        ],
        center: { lat: 32.106, lon: 35.181 },
      },
      {
        id: "bika-yosh__binyamin",
        name: "מטה בנימין",
        oref_areas: [
          "בית אל", "ענתות", "פסגות", "כוכב יעקב",
          "מעלה אדומים", "מעלה מכמש", "פקטמוש",
        ],
        center: { lat: 31.860, lon: 35.232 },
      },
      {
        id: "bika-yosh__bika",
        name: "בקעת הירדן",
        oref_areas: [
          "מצפה שלם", "מחולה", "ייטב", "פצאל", "תומר",
          "ארגמן", "משואה", "נעמ\"ה",
        ],
        center: { lat: 32.103, lon: 35.473 },
      },
      {
        id: "bika-yosh__chevron",
        name: "חברון, קריית ארבע",
        oref_areas: [
          "חברון", "קריית ארבע", "אלון שבות", "מעון", "סוסיה",
          "עתניאל", "תנא עומרים",
        ],
        center: { lat: 31.532, lon: 35.097 },
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────
  // Negev + Eilat
  // ──────────────────────────────────────────────────────────────────────
  {
    id: "negev-eilat",
    name: "נגב ואילת",
    description: "באר שבע, דימונה, ערד, ים המלח, אילת והערבה",
    sub: [
      {
        id: "negev-eilat__beer-sheva",
        name: "באר שבע והסביבה",
        oref_areas: [
          "באר שבע", "להבים", "מיתר", "עומר", "תל שבע",
          "רהט", "חורה", "כסיפה",
        ],
        center: { lat: 31.252, lon: 34.791 },
      },
      {
        id: "negev-eilat__dimona-arad",
        name: "דימונה, ערד וים המלח",
        oref_areas: [
          "דימונה", "ערד", "ים המלח", "מצדה", "עין בוקק",
          "נווה זוהר", "כרם בעל המנחות",
        ],
        center: { lat: 31.071, lon: 35.034 },
      },
      {
        id: "negev-eilat__arava",
        name: "הערבה",
        oref_areas: [
          "צוקים", "פארן", "סוף", "חצבה", "עין יהב",
          "ספיר", "צופר", "פוארה", "אידן",
        ],
        center: { lat: 30.612, lon: 35.247 },
      },
      {
        id: "negev-eilat__eilat",
        name: "אילת",
        oref_areas: ["אילת"],
        center: { lat: 29.557, lon: 34.952 },
      },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────
// Helpful indices — built once at module load.
// ──────────────────────────────────────────────────────────────────────

/** Flat list of all sub-regions with parent reference attached. */
export const ALL_SUBREGIONS: Array<SubRegion & { regionId: string; regionName: string }> =
  REGIONS.flatMap((r) =>
    r.sub.map((s) => ({ ...s, regionId: r.id, regionName: r.name }))
  );

/** All Oref-area substrings used anywhere — useful for "match anything in Israel" debug mode. */
export const ALL_OREF_AREAS: string[] = Array.from(
  new Set(ALL_SUBREGIONS.flatMap((s) => s.oref_areas))
).sort();

/** Lookup helpers (O(1)). */
const REGION_BY_ID = new Map(REGIONS.map((r) => [r.id, r]));
const SUBREGION_BY_ID = new Map(ALL_SUBREGIONS.map((s) => [s.id, s]));

export function getRegion(id: string): Region | undefined {
  return REGION_BY_ID.get(id);
}

export function getSubRegion(id: string): SubRegion | undefined {
  return SUBREGION_BY_ID.get(id);
}
