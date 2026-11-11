// The demo dataset: a fake restaurant group with 18 months of AP history.
//
// Pure and deterministic apart from "today" and record ids. `pnpm seed` writes
// it to Postgres; `pnpm eval` replays it against the linker and the reason
// rules, because the generator knows the right answer for every credit (which
// invoice it really corrects, and why it was issued).

import { randomUUID } from "node:crypto";
import { addDays, daysBetween, type PlainDate } from "../src/lib/dates";
import { divRound } from "../src/lib/money";
import { createRng } from "../src/lib/random";
import type { CreditReasonKey } from "../src/lib/reasons";

export const DEMO_COMPANY = "Bluebird Hospitality Group";
const MONTHS = 18;
const SEED = 20_261_021;
// Catalog prices are per unit for a single restaurant; the group buys for 3.
const PRICE_SCALE = 3;

type Catalog = Array<[description: string, unitCents: number, maxQty: number]>;

export interface Profile {
  name: string;
  rawNames: string[];
  currency: string;
  prefix: string;
  perMonth: number;
  /** Credit memos to generate over the whole window. */
  credits: number;
  reasons: Array<[CreditReasonKey, number]>;
  catalog: Catalog;
  taxBps: number;
  terms: string;
  resolveDays: [number, number];
}

const FOOD: Catalog = [
  ["Chicken breast, 40 lb case", 11_850, 12],
  ["Russet potatoes, 50 lb", 2_895, 10],
  ["Canola oil, 35 lb jug", 4_120, 8],
  ["Yellow onions, 50 lb", 3_210, 6],
  ["Heavy cream, 1/2 gal x 6", 3_640, 10],
  ["All-purpose flour, 50 lb", 2_475, 8],
];

export const PROFILES: Profile[] = [
  {
    name: "Acme Supply",
    rawNames: ["ACME Supply, Inc.", "Acme Supply", "Acme Supply Co."],
    currency: "USD", prefix: "AS-", perMonth: 10, credits: 28,
    reasons: [["pricing_error", 10], ["quantity_error", 2], ["duplicate_billing", 0.5], ["damaged_or_defective", 1]],
    catalog: [
      ["Copy paper, 10 ream case", 4_299, 20],
      ["Nitrile gloves, box of 100", 1_250, 40],
      ["Paper towels, 12 roll case", 3_475, 25],
      ["Toner cartridge HP 26A", 8_999, 6],
      ["Food storage containers, 50 ct", 2_690, 15],
      ["Degreaser concentrate, 4 x 1 gal", 5_440, 10],
    ],
    taxBps: 825, terms: "Net 30", resolveDays: [10, 75],
  },
  {
    name: "Harbor Produce Co.",
    rawNames: ["Harbor Produce Co.", "Harbor Produce Company", "HARBOR PRODUCE"],
    currency: "USD", prefix: "HP", perMonth: 13, credits: 22,
    reasons: [["damaged_or_defective", 4], ["quantity_error", 3], ["pricing_error", 2], ["return", 1]],
    catalog: [
      ["Romaine lettuce, case of 24", 3_850, 10],
      ["Roma tomatoes, 25 lb", 3_125, 10],
      ["Lemons, 115 ct case", 4_460, 6],
      ["Avocados, 48 ct case", 6_975, 6],
      ["Mixed berries, 12 x 6 oz", 3_990, 8],
      ["Fresh herbs assortment", 2_150, 6],
    ],
    taxBps: 0, terms: "Net 15", resolveDays: [3, 30],
  },
  {
    name: "Summit Foodservice Distributors",
    rawNames: ["Summit Foodservice Distributors", "Summit Foodservice Distributors, LLC"],
    currency: "USD", prefix: "SFD", perMonth: 16, credits: 18,
    reasons: [["pricing_error", 3], ["quantity_error", 3], ["rebate_or_promo", 2], ["damaged_or_defective", 1]],
    catalog: FOOD, taxBps: 0, terms: "Net 30", resolveDays: [7, 60],
  },
  {
    name: "Pacific Linen Service",
    rawNames: ["Pacific Linen Service", "Pacific Linen Service Inc."],
    currency: "USD", prefix: "PLS-", perMonth: 4, credits: 10,
    reasons: [["service_failure", 3], ["quantity_error", 2], ["pricing_error", 1]],
    catalog: [
      ["Napkin rental, per 100", 1_800, 30],
      ["Tablecloth rental, 52in", 425, 80],
      ["Chef coat laundering", 375, 60],
      ["Delivery and pickup fee", 2_500, 1],
    ],
    taxBps: 825, terms: "Net 30", resolveDays: [14, 90],
  },
  {
    // Deliberately not caught by loose matching ("Svc" vs "Service"): merge it by hand.
    name: "Pacific Linen Svc",
    rawNames: ["Pacific Linen Svc"],
    currency: "USD", prefix: "PLS-B", perMonth: 1, credits: 2,
    reasons: [["service_failure", 1], ["quantity_error", 1]],
    catalog: [
      ["Napkin rental, per 100", 1_800, 30],
      ["Tablecloth rental, 52in", 425, 80],
    ],
    taxBps: 825, terms: "Net 30", resolveDays: [14, 90],
  },
  {
    name: "Bright Spark Electric",
    rawNames: ["Bright Spark Electric LLC", "Bright Spark Electric"],
    currency: "USD", prefix: "BSE", perMonth: 1, credits: 1,
    reasons: [["pricing_error", 1]],
    catalog: [
      ["Electrician labor, per hour", 12_500, 8],
      ["Breaker replacement", 18_900, 2],
    ],
    taxBps: 0, terms: "Due on receipt", resolveDays: [10, 40],
  },
  {
    name: "Coastal Seafood Traders",
    rawNames: ["Coastal Seafood Traders", "Coastal Seafood Traders Inc"],
    currency: "USD", prefix: "CST", perMonth: 9, credits: 14,
    reasons: [["damaged_or_defective", 3], ["pricing_error", 2], ["quantity_error", 2], ["return", 1]],
    catalog: [
      ["Atlantic salmon fillet, 10 lb", 15_490, 6],
      ["Shrimp 16/20, 5 lb", 7_450, 8],
      ["Sea scallops U10, 5 lb", 18_975, 4],
      ["Littleneck clams, 100 ct", 6_200, 4],
    ],
    taxBps: 0, terms: "Net 7", resolveDays: [3, 25],
  },
  {
    name: "Greenleaf Disposables",
    rawNames: ["Greenleaf Disposables", "GreenLeaf Disposables Corp."],
    currency: "USD", prefix: "GL", perMonth: 5, credits: 6,
    reasons: [["pricing_error", 2], ["rebate_or_promo", 2], ["quantity_error", 1]],
    catalog: [
      ["Compostable clamshell 9in, 200 ct", 7_850, 10],
      ["Paper straws, 3000 ct", 4_590, 4],
      ["Kraft to-go bags, 500 ct", 6_125, 6],
    ],
    taxBps: 825, terms: "Net 30", resolveDays: [10, 60],
  },
  {
    name: "Metro Waste Solutions",
    rawNames: ["Metro Waste Solutions"],
    currency: "USD", prefix: "MWS", perMonth: 2, credits: 4,
    reasons: [["service_failure", 2], ["duplicate_billing", 1], ["pricing_error", 1]],
    catalog: [
      ["Dumpster service, 6 yd weekly", 48_500, 1],
      ["Recycling pickup", 16_000, 1],
      ["Grease trap pumping", 27_500, 1],
    ],
    taxBps: 0, terms: "Net 30", resolveDays: [20, 100],
  },
  {
    name: "Crystal Clear Window Cleaning",
    rawNames: ["Crystal Clear Window Cleaning"],
    currency: "USD", prefix: "CC", perMonth: 1, credits: 0, reasons: [],
    catalog: [["Window cleaning, monthly", 32_000, 1]],
    taxBps: 0, terms: "Net 15", resolveDays: [10, 30],
  },
  {
    name: "Ironclad Kitchen Equipment",
    rawNames: ["Ironclad Kitchen Equipment Corp.", "Ironclad Kitchen Equipment"],
    currency: "USD", prefix: "IKE-", perMonth: 2, credits: 5,
    reasons: [["damaged_or_defective", 2], ["return", 2], ["pricing_error", 1]],
    catalog: [
      ["Stainless prep table 48in", 38_900, 2],
      ["Commercial blender", 54_900, 1],
      ["Sheet pan rack", 21_450, 2],
      ["Induction burner", 32_995, 2],
    ],
    taxBps: 825, terms: "Net 30", resolveDays: [10, 80],
  },
  {
    name: "Brewline Beverage Co.",
    rawNames: ["Brewline Beverage Co.", "Brewline Beverage Company"],
    currency: "USD", prefix: "BB", perMonth: 7, credits: 8,
    reasons: [["rebate_or_promo", 3], ["pricing_error", 2], ["quantity_error", 1], ["damaged_or_defective", 1]],
    catalog: [
      ["Craft IPA, 1/2 bbl keg", 18_900, 4],
      ["Cold brew concentrate, 5 gal", 9_450, 3],
      ["Sparkling water, 24 x 12 oz", 2_280, 10],
    ],
    taxBps: 0, terms: "Net 30", resolveDays: [10, 60],
  },
  {
    name: "Northstar Dairy",
    rawNames: ["Northstar Dairy", "North Star Dairy"],
    currency: "USD", prefix: "ND", perMonth: 9, credits: 6,
    reasons: [["quantity_error", 2], ["damaged_or_defective", 2], ["pricing_error", 1]],
    catalog: [
      ["Whole milk, 4 x 1 gal", 1_996, 12],
      ["Unsalted butter, 36 lb", 14_220, 3],
      ["Shredded mozzarella, 4 x 5 lb", 6_780, 6],
      ["Large eggs, 15 dozen", 4_350, 8],
    ],
    taxBps: 0, terms: "Net 14", resolveDays: [3, 30],
  },
  {
    name: "Golden Grain Bakery",
    rawNames: ["Golden Grain Bakery"],
    currency: "USD", prefix: "GGB", perMonth: 8, credits: 3,
    reasons: [["quantity_error", 1], ["damaged_or_defective", 1]],
    catalog: [
      ["Brioche buns, 48 ct", 2_640, 10],
      ["Sourdough loaves, 12 ct", 3_180, 8],
      ["Croissants, 36 ct", 4_320, 4],
    ],
    taxBps: 0, terms: "Net 14", resolveDays: [3, 20],
  },
  {
    name: "TableTop POS Systems",
    rawNames: ["TableTop POS Systems Inc", "TableTop POS Systems"],
    currency: "USD", prefix: "TT", perMonth: 1, credits: 2,
    reasons: [["service_failure", 2], ["duplicate_billing", 1]],
    catalog: [
      ["POS software subscription, 6 terminals", 89_400, 1],
      ["Payment terminal lease", 4_900, 6],
    ],
    taxBps: 825, terms: "Net 30", resolveDays: [15, 60],
  },
  {
    name: "Evergreen Landscaping",
    rawNames: ["Evergreen Landscaping"],
    currency: "USD", prefix: "EVL", perMonth: 1, credits: 0, reasons: [],
    catalog: [["Grounds maintenance, monthly", 42_500, 1]],
    taxBps: 0, terms: "Net 30", resolveDays: [10, 30],
  },
  {
    name: "Sunrise Coffee Roasters",
    rawNames: ["Sunrise Coffee Roasters"],
    currency: "USD", prefix: "SCR", perMonth: 3, credits: 2,
    reasons: [["rebate_or_promo", 1], ["pricing_error", 1]],
    catalog: [
      ["House espresso blend, 5 lb", 6_250, 10],
      ["Decaf blend, 5 lb", 6_750, 3],
    ],
    taxBps: 0, terms: "Net 30", resolveDays: [10, 40],
  },
  {
    name: "Valley Uniform Rentals",
    rawNames: ["Valley Uniform Rentals"],
    currency: "USD", prefix: "VUR", perMonth: 2, credits: 4,
    reasons: [["pricing_error", 2], ["quantity_error", 1], ["duplicate_billing", 1]],
    catalog: [
      ["Uniform rental, per employee", 1_150, 40],
      ["Floor mat service", 950, 8],
    ],
    taxBps: 825, terms: "Net 30", resolveDays: [20, 90],
  },
  {
    name: "Precision Pest Control",
    rawNames: ["Precision Pest Control"],
    currency: "USD", prefix: "PPC", perMonth: 1, credits: 0, reasons: [],
    catalog: [["Monthly pest service", 18_500, 1]],
    taxBps: 0, terms: "Net 15", resolveDays: [10, 30],
  },
  {
    name: "Blue Flame Gas & Propane",
    rawNames: ["Blue Flame Gas & Propane", "Blue Flame Gas and Propane"],
    currency: "USD", prefix: "BFG", perMonth: 2, credits: 2,
    reasons: [["pricing_error", 1], ["duplicate_billing", 1]],
    catalog: [["Propane delivery, per gallon", 389, 200]],
    taxBps: 0, terms: "Net 30", resolveDays: [15, 60],
  },
  {
    name: "Prime Cuts Meat Purveyors",
    rawNames: ["Prime Cuts Meat Purveyors", "Prime Cuts Meat Purveyors Ltd"],
    currency: "USD", prefix: "PC", perMonth: 7, credits: 6,
    reasons: [["pricing_error", 2], ["quantity_error", 2], ["damaged_or_defective", 1]],
    catalog: [
      ["Ribeye, choice, 12 lb", 21_480, 4],
      ["Ground chuck 80/20, 10 lb", 5_890, 8],
      ["Pork belly, 10 lb", 6_450, 4],
    ],
    taxBps: 0, terms: "Net 14", resolveDays: [5, 40],
  },
  {
    name: "Orchard Hill Wines",
    rawNames: ["Orchard Hill Wines"],
    currency: "USD", prefix: "OHW", perMonth: 2, credits: 1,
    reasons: [["damaged_or_defective", 1]],
    catalog: [
      ["House red, case of 12", 14_400, 6],
      ["Sauvignon blanc, case of 12", 15_600, 6],
    ],
    taxBps: 0, terms: "Net 30", resolveDays: [10, 40],
  },
  {
    name: "Maison Dupont Fromagerie",
    rawNames: ["Maison Dupont Fromagerie SARL", "Maison Dupont Fromagerie"],
    currency: "EUR", prefix: "MDF-", perMonth: 2, credits: 3,
    reasons: [["damaged_or_defective", 1], ["pricing_error", 1]],
    catalog: [
      ["Comté 18 mois, 5 kg", 14_250, 3],
      ["Brie de Meaux, 3 kg", 8_970, 3],
    ],
    taxBps: 550, terms: "30 jours fin de mois", resolveDays: [15, 60],
  },
  {
    name: "Thames Tea Company",
    rawNames: ["Thames Tea Company Ltd", "Thames Tea Company"],
    currency: "GBP", prefix: "TTC", perMonth: 1, credits: 2,
    reasons: [["pricing_error", 1], ["return", 1]],
    catalog: [
      ["Earl Grey loose leaf, 1 kg", 3_850, 6],
      ["English breakfast, 500 bags", 4_200, 4],
    ],
    taxBps: 2000, terms: "Net 30", resolveDays: [15, 60],
  },
  {
    name: "Maple Leaf Syrup Co.",
    rawNames: ["Maple Leaf Syrup Co."],
    currency: "CAD", prefix: "MLS", perMonth: 0.5, credits: 1,
    reasons: [["quantity_error", 1]],
    catalog: [["Maple syrup grade A, 4 x 1 gal", 18_800, 4]],
    taxBps: 0, terms: "Net 30", resolveDays: [15, 60],
  },
];

export const STATED_REASONS: Record<CreditReasonKey, string[]> = {
  pricing_error: ["Price billed above contract rate", "Pricing error", "Incorrect unit price charged"],
  quantity_error: ["Short shipped", "Billed quantity exceeds delivered quantity", "Quantity correction"],
  damaged_or_defective: ["Product arrived damaged", "Defective item", "Spoiled on arrival"],
  duplicate_billing: ["Duplicate invoice", "Invoice billed twice"],
  return: ["Customer return", "Returned goods"],
  rebate_or_promo: ["Quarterly volume rebate", "Promotional allowance"],
  service_failure: ["Missed service visit", "Service credit per SLA"],
  other: ["Goodwill credit"],
};

export interface DemoLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface DemoVendor {
  id: string;
  profile: Profile;
}

export interface DemoInvoice {
  id: string;
  vendorId: string;
  profile: Profile;
  /** The spelling of the vendor's name printed on this document. */
  rawName: string;
  number: string;
  date: PlainDate;
  subtotalCents: number;
  totalCents: number;
  lines: DemoLine[];
  confirmedOn: PlainDate;
}

export interface DemoCredit {
  id: string;
  vendorId: string;
  profile: Profile;
  rawName: string;
  number: string;
  date: PlainDate;
  amountCents: number;
  description: string;
  /** Ground truth: why the vendor issued it. */
  reason: CreditReasonKey;
  statedReason: string | null;
  /** The invoice number printed on the memo, when it prints one. */
  reference: string | null;
  /** Ground truth: the invoice this credit really corrects. */
  trueInvoiceId: string;
  status: "open" | "applied" | "written_off";
  statusChangedOn: PlainDate | null;
}

export interface DemoData {
  today: PlainDate;
  start: PlainDate;
  vendors: DemoVendor[];
  invoices: DemoInvoice[];
  credits: DemoCredit[];
}

export function generateDemoData(today: PlainDate, newId: () => string = randomUUID): DemoData {
  const rng = createRng(SEED);
  const start = addDays(today, -Math.round(MONTHS * 30.44));

  const randomDate = (from: PlainDate, to: PlainDate): PlainDate =>
    addDays(from, rng.int(0, Math.max(0, daysBetween(from, to))));

  const makeLines = (profile: Profile): DemoLine[] => {
    const count = Math.min(profile.catalog.length, rng.int(1, 4));
    const picked = [...profile.catalog].sort(() => rng.next() - 0.5).slice(0, count);
    return picked.map(([description, unit, maxQty]) => {
      const quantity = rng.int(1, maxQty);
      // Small price drift between invoices, always whole cents.
      const base = unit * PRICE_SCALE;
      const unitPriceCents = base + divRound(base * rng.int(-3, 3), 100);
      return { description, quantity, unitPriceCents, lineTotalCents: unitPriceCents * quantity };
    });
  };

  const creditStatusFor = (creditDate: PlainDate): DemoCredit["status"] => {
    const age = daysBetween(creditDate, today);
    if (age > 120) return rng.weighted([["applied", 78], ["open", 14], ["written_off", 8]] as const);
    if (age > 60) return rng.weighted([["applied", 50], ["open", 45], ["written_off", 5]] as const);
    return rng.weighted([["open", 70], ["applied", 30]] as const);
  };

  const vendors: DemoVendor[] = [];
  const invoices: DemoInvoice[] = [];
  const invoicesByVendor = new Map<string, DemoInvoice[]>();

  for (const profile of PROFILES) {
    const vendorId = newId();
    vendors.push({ id: vendorId, profile });

    const count = Math.max(1, Math.round(profile.perMonth * MONTHS * (0.9 + rng.next() * 0.2)));
    const dates = Array.from({ length: count }, () => randomDate(start, today)).sort();
    const drafts = dates.map((date, i) => {
      const lines = makeLines(profile);
      const subtotalCents = lines.reduce((s, l) => s + l.lineTotalCents, 0);
      const tax = divRound(subtotalCents * profile.taxBps, 10_000);
      return {
        id: newId(),
        number: `${profile.prefix}${10_000 + i}`,
        date,
        subtotalCents,
        totalCents: subtotalCents + tax,
        lines,
      };
    });
    const vendorInvoices: DemoInvoice[] = drafts.map((draft) => {
      const rawName = rng.pick(profile.rawNames);
      const confirmedOn = addDays(draft.date, rng.int(0, 3));
      return { ...draft, vendorId, profile, rawName, confirmedOn };
    });
    invoicesByVendor.set(vendorId, vendorInvoices);
    invoices.push(...vendorInvoices);
  }

  const credits: DemoCredit[] = [];
  for (const [vendorId, vendorInvoices] of invoicesByVendor) {
    const profile = vendorInvoices[0].profile;
    for (let i = 0; i < profile.credits; i++) {
      const reason = rng.weighted(profile.reasons);
      const resolve = rng.int(profile.resolveDays[0], profile.resolveDays[1]);
      const eligible = vendorInvoices.filter((inv) => addDays(inv.date, resolve) <= today);
      if (eligible.length === 0) continue;
      const target = rng.pick(eligible);
      const date = addDays(target.date, resolve);
      const line = rng.pick(target.lines);

      let amount: number;
      let description: string;
      let reference: string | null = rng.chance(0.9) ? target.number : null;
      switch (reason) {
        case "pricing_error": {
          // Wrong rate applied across the invoice, not just one line.
          amount = Math.max(100, divRound(target.subtotalCents * rng.int(4, 18), 100));
          description = `Price correction: ${line.description}`;
          break;
        }
        case "quantity_error": {
          const units = Math.max(1, Math.min(rng.int(1, 4), line.quantity - 1));
          amount = units * line.unitPriceCents;
          description = `Quantity correction: ${line.description} (${units} not delivered)`;
          break;
        }
        case "duplicate_billing":
          amount = target.totalCents;
          description = `Duplicate billing of invoice ${target.number}`;
          break;
        case "damaged_or_defective": {
          const units = rng.int(1, line.quantity);
          amount = units * line.unitPriceCents;
          description = `Damaged on arrival: ${line.description}`;
          break;
        }
        case "return": {
          const units = rng.int(1, line.quantity);
          amount = units * line.unitPriceCents;
          description = `Returned: ${line.description}`;
          break;
        }
        case "service_failure":
          amount = Math.max(100, divRound(target.totalCents * rng.int(10, 30), 100));
          description = `Service credit: missed service week of ${target.date}`;
          break;
        case "rebate_or_promo":
          amount = Math.max(500, divRound(target.totalCents * rng.int(2, 6), 100));
          description = "Quarterly volume rebate";
          reference = null;
          break;
        default:
          amount = 2_500;
          description = "Goodwill credit";
      }
      amount = Math.min(amount, target.totalCents);

      const statedReason = rng.chance(0.75) ? rng.pick(STATED_REASONS[reason]) : null;
      const status = creditStatusFor(date);
      const id = newId();
      const rawName = rng.pick(profile.rawNames);
      const statusChangedOn =
        status === "open" ? null : addDays(date, Math.min(rng.int(5, 60), daysBetween(date, today)));
      credits.push({
        id,
        vendorId,
        profile,
        rawName,
        number: `CM-${profile.prefix}${5_000 + i}`,
        date,
        amountCents: amount,
        description,
        reason,
        statedReason,
        reference,
        trueInvoiceId: target.id,
        status,
        statusChangedOn,
      });
    }
  }

  return { today, start, vendors, invoices, credits };
}
