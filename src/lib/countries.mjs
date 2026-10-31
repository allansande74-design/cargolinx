/**
 * Country + language pack for East Africa, SADC and COMESA.
 *
 * One row per country: default English plus one popular local language,
 * currency, mobile-money rails, tax regime + platform hook, and the
 * charges a freight quote must carry. Figures are structural (codes,
 * rate names, platform names) — never amounts. Amounts come from the
 * engine or a live lookup, never from this file.
 *
 * Voice (Muse Voice Transcribe) handles all languages below in one model:
 * 25 evaluated languages with code-switching. The chatbot answers in the
 * user's language by passing locale + glossary to the reasoning model —
 * no separate model per language, no separate bot per country.
 */
export const COUNTRIES = {
  KE: {
    name: "Kenya", bloc: ["EAC", "COMESA"],
    languages: ["en", "sw"], localLabel: "Kiswahili",
    currency: "KES", currencyName: "Kenyan shilling",
    mobileMoney: [
      { provider: "M-Pesa", operator: "Safaricom", paybillNote: "paybill/till settlement" },
      { provider: "Airtel Money", operator: "Airtel Kenya" },
      { provider: "T-Kash", operator: "Telkom Kenya" },
    ],
    tax: { vat: "VAT 16%", income: "PAYE + corporate 30%", platform: "KRA iTax", pinRequired: true },
    freightCharges: ["import duty (EAC CET)", "VAT 16%", "railway development levy", "import declaration fee", "clearing", "last-mile"],
    compliance: ["KRA PIN on every invoice", "EAC certificate of origin for preferential duty", "KEBS inspection (PVOC) for regulated goods"],
  },
  UG: {
    name: "Uganda", bloc: ["EAC", "COMESA"],
    languages: ["en", "lg"], localLabel: "Luganda",
    currency: "UGX", currencyName: "Ugandan shilling",
    mobileMoney: [
      { provider: "MTN MoMo", operator: "MTN Uganda" },
      { provider: "Airtel Money", operator: "Airtel Uganda" },
    ],
    tax: { vat: "VAT 18%", income: "PAYE + corporate 30%", platform: "URA web portal", pinRequired: true },
    freightCharges: ["import duty (EAC CET)", "VAT 18%", "withholding tax on imports", "clearing", "last-mile"],
    compliance: ["URA TIN on every invoice", "UNBS inspection for regulated goods"],
  },
  TZ: {
    name: "Tanzania", bloc: ["EAC", "SADC"],
    languages: ["en", "sw"], localLabel: "Kiswahili",
    currency: "TZS", currencyName: "Tanzanian shilling",
    mobileMoney: [
      { provider: "M-Pesa", operator: "Vodacom" },
      { provider: "Tigo Pesa", operator: "Tigo" },
      { provider: "Airtel Money", operator: "Airtel Tanzania" },
    ],
    tax: { vat: "VAT 18%", income: "PAYE + corporate 30%", platform: "TRA online", pinRequired: true },
    freightCharges: ["import duty (EAC CET)", "VAT 18%", "railway levy", "clearing (TANSIS)", "last-mile"],
    compliance: ["TRA TIN", "TBS standards check", "TANSIS single-window declaration"],
  },
  RW: {
    name: "Rwanda", bloc: ["EAC", "COMESA"],
    languages: ["en", "fr", "rw"], localLabel: "Kinyarwanda (FR also official)",
    currency: "RWF", currencyName: "Rwandan franc",
    mobileMoney: [
      { provider: "MTN MoMo", operator: "MTN Rwanda" },
      { provider: "Airtel Money", operator: "Airtel Rwanda" },
    ],
    tax: { vat: "VAT 18%", income: "PAYE + corporate 30%", platform: "RRA e-tax", pinRequired: true },
    freightCharges: ["import duty (EAC CET)", "VAT 18%", "infrastructure levy", "clearing", "last-mile"],
    compliance: ["RRA TIN", "RSB standards for regulated goods"],
  },
  ET: {
    name: "Ethiopia", bloc: ["COMESA"],
    languages: ["en", "am"], localLabel: "Amharic",
    currency: "ETB", currencyName: "Ethiopian birr",
    mobileMoney: [
      { provider: "telebirr", operator: "Ethio Telecom" },
      { provider: "M-Pesa Ethiopia", operator: "Safaricom Ethiopia" },
    ],
    tax: { vat: "VAT 15%", income: "employment + business tax", platform: "MoR e-filing", pinRequired: true },
    freightCharges: ["customs duty", "VAT 15%", "surtax", "withholding", "clearing", "last-mile"],
    compliance: ["TIN registration", "ECAE conformity for regulated imports"],
  },
  ZM: {
    name: "Zambia", bloc: ["SADC", "COMESA"],
    languages: ["en", "ny"], localLabel: "Nyanja",
    currency: "ZMW", currencyName: "Zambian kwacha",
    mobileMoney: [
      { provider: "MTN MoMo", operator: "MTN Zambia" },
      { provider: "Airtel Money", operator: "Airtel Zambia" },
    ],
    tax: { vat: "VAT 16%", income: "PAYE + corporate 30%", platform: "ZRA TaxOnline", pinRequired: true },
    freightCharges: ["import duty", "VAT 16%", "clearing (ASYCUDA)", "last-mile"],
    compliance: ["ZRA TPIN", "ZABS standards for regulated goods"],
  },
  ZA: {
    name: "South Africa", bloc: ["SADC"],
    languages: ["en", "zu"], localLabel: "isiZulu",
    currency: "ZAR", currencyName: "South African rand",
    mobileMoney: [
      { provider: "SnapScan / Zapper", operator: "card rails dominate; mobile via banks" },
      { provider: "MTN MoMo", operator: "MTN SA" },
    ],
    tax: { vat: "VAT 15%", income: "PAYE + corporate 27%", platform: "SARS eFiling", pinRequired: true },
    freightCharges: ["import duty", "VAT 15%", "clearing (SARS customs)", "last-mile"],
    compliance: ["SARS tax number", "NRCS/SABS approvals for regulated goods"],
  },
  DRC: {
    name: "DR Congo", bloc: ["SADC", "COMESA", "EAC"],
    languages: ["fr", "ln"], localLabel: "Lingala (FR official)",
    currency: "CDF", currencyName: "Congolese franc",
    mobileMoney: [
      { provider: "M-Pesa", operator: "Vodacom DRC" },
      { provider: "Orange Money", operator: "Orange DRC" },
      { provider: "Airtel Money", operator: "Airtel DRC" },
    ],
    tax: { vat: "VAT 16%", income: "corporate 30%", platform: "DGI declarations", pinRequired: true },
    freightCharges: ["import duty", "VAT 16%", "administrative fees", "clearing", "last-mile"],
    compliance: ["NIF tax number", "OCC inspection for regulated goods"],
  },
};

export const DEFAULT_COUNTRY = "KE";

/** Greeting per locale, used by the chat bar before the model answers. */
export const GREETINGS = {
  en: "How can I help with your shipment?",
  sw: "Ninaweza kukusaidia vipi na shehena yako?",
  fr: "Comment puis-je aider avec votre expédition ?",
  rw: "Ndagufasha nte n'imizigo yawe?",
  lg: "Nnyinza ntya okuyamba ku mizigo gyo?",
  am: "ለጭነትዎ እንዴት ልረዳዎ እችላለሁ?",
  ny: "Ningakuthandizeni bwanji ndi katundu wanu?",
  zu: "Ngingakusiza kanjani ngempahla yakho?",
  ln: "Nakoki kosalisa yo ndenge nini na mizigo na yo?",
};

/**
 * Build the chatbot system prompt for a locale. The reasoning model
 * (Spark/Wonder) answers in the user's language; money, lane names and
 * compliance terms stay exactly as the engine computed them.
 */
export function localeSystemPrompt(countryCode = "KE", lang = "en") {
  const c = COUNTRIES[countryCode] || COUNTRIES[DEFAULT_COUNTRY];
  const langName = { en: "English", sw: "Kiswahili", fr: "French", rw: "Kinyarwanda", lg: "Luganda", am: "Amharic", ny: "Nyanja", zu: "isiZulu", ln: "Lingala" }[lang] || "English";
  return [
    `Answer in ${langName}.`,
    `Country context: ${c.name} (${c.currency}, VAT: ${c.tax.vat}, tax platform: ${c.tax.platform}).`,
    `Settlement rails: ${c.mobileMoney.map((m) => `${m.provider} (${m.operator})`).join("; ")}.`,
    "Rules: use ONLY the figures given. Never convert currency without a stated rate. Never invent a tax rate, a fee or a translation of a legal term — quote the official term in English beside the translation.",
  ].join(" ");
}
