import { DomainError } from "./domain-error.js";
import { err, ok, type Result } from "./result.js";

/**
 * A currency of the ISO 4217 table with localizable names and its
 * minor-unit exponent (INV-DIN-04). The table is the single source of
 * truth for ISO codes, their names and their scales.
 */
export interface Iso4217Currency {
  readonly code: string;
  readonly nameEn: string;
  readonly nameEs: string;
  readonly minorUnitExponent: number;
}

// ISO 4217 table: [code, nameEn, nameEs, minorUnitExponent?] — exponent
// defaults to 2 when omitted. Covers circulating currencies plus the
// fund/metal/supranational entries of the published table.
const ISO_4217_TABLE: readonly (readonly [string, string, string, number?])[] = [
  ["AED", "UAE Dirham", "Dírham de los Emiratos Árabes Unidos"],
  ["AFN", "Afghani", "Afgani"],
  ["ALL", "Lek", "Lek"],
  ["AMD", "Armenian Dram", "Dram armenio"],
  ["ANG", "Netherlands Antillean Guilder", "Florín antillano neerlandés"],
  ["AOA", "Kwanza", "Kwanza"],
  ["ARS", "Argentine Peso", "Peso argentino"],
  ["AUD", "Australian Dollar", "Dólar australiano"],
  ["AWG", "Aruban Florin", "Florín arubeño"],
  ["AZN", "Azerbaijan Manat", "Manat azerbaiyano"],
  ["BAM", "Convertible Mark", "Marco convertible"],
  ["BBD", "Barbados Dollar", "Dólar de Barbados"],
  ["BDT", "Taka", "Taka"],
  ["BGN", "Bulgarian Lev", "Lev búlgaro"],
  ["BHD", "Bahraini Dinar", "Dinar bareiní", 3],
  ["BIF", "Burundi Franc", "Franco burundés", 0],
  ["BMD", "Bermudian Dollar", "Dólar de Bermudas"],
  ["BND", "Brunei Dollar", "Dólar de Brunéi"],
  ["BOB", "Boliviano", "Boliviano"],
  ["BOV", "Mvdol", "Mvdol"],
  ["BRL", "Brazilian Real", "Real brasileño"],
  ["BSD", "Bahamian Dollar", "Dólar bahameño"],
  ["BTN", "Ngultrum", "Ngultrum"],
  ["BWP", "Pula", "Pula"],
  ["BYN", "Belarusian Ruble", "Rublo bielorruso"],
  ["BZD", "Belize Dollar", "Dólar de Belice"],
  ["CAD", "Canadian Dollar", "Dólar canadiense"],
  ["CDF", "Congolese Franc", "Franco congoleño"],
  ["CHE", "WIR Euro", "Euro WIR"],
  ["CHF", "Swiss Franc", "Franco suizo"],
  ["CHW", "WIR Franc", "Franco WIR"],
  ["CLF", "Unidad de Fomento", "Unidad de Fomento", 4],
  ["CLP", "Chilean Peso", "Peso chileno", 0],
  ["CNY", "Yuan Renminbi", "Yuan renminbi"],
  ["COP", "Colombian Peso", "Peso colombiano"],
  ["COU", "Unidad de Valor Real", "Unidad de Valor Real"],
  ["CRC", "Costa Rican Colon", "Colón costarricense"],
  ["CUP", "Cuban Peso", "Peso cubano"],
  ["CVE", "Cabo Verde Escudo", "Escudo caboverdiano"],
  ["CZK", "Czech Koruna", "Corona checa"],
  ["DJF", "Djibouti Franc", "Franco yibutiano", 0],
  ["DKK", "Danish Krone", "Corona danesa"],
  ["DOP", "Dominican Peso", "Peso dominicano"],
  ["DZD", "Algerian Dinar", "Dinar argelino"],
  ["EGP", "Egyptian Pound", "Libra egipcia"],
  ["ERN", "Nakfa", "Nakfa"],
  ["ETB", "Ethiopian Birr", "Birr etíope"],
  ["EUR", "Euro", "Euro"],
  ["FJD", "Fiji Dollar", "Dólar fiyiano"],
  ["FKP", "Falkland Islands Pound", "Libra malvinense"],
  ["GBP", "Pound Sterling", "Libra esterlina"],
  ["GEL", "Lari", "Lari"],
  ["GHS", "Ghana Cedi", "Cedi ghanés"],
  ["GIP", "Gibraltar Pound", "Libra de Gibraltar"],
  ["GMD", "Dalasi", "Dalasi"],
  ["GNF", "Guinean Franc", "Franco guineano", 0],
  ["GTQ", "Quetzal", "Quetzal"],
  ["GYD", "Guyana Dollar", "Dólar guyanés"],
  ["HKD", "Hong Kong Dollar", "Dólar de Hong Kong"],
  ["HNL", "Lempira", "Lempira"],
  ["HTG", "Gourde", "Gourde"],
  ["HUF", "Forint", "Forint"],
  ["IDR", "Rupiah", "Rupia"],
  ["ILS", "New Israeli Sheqel", "Nuevo séquel israelí"],
  ["INR", "Indian Rupee", "Rupia india"],
  ["IQD", "Iraqi Dinar", "Dinar iraquí", 3],
  ["IRR", "Iranian Rial", "Rial iraní"],
  ["ISK", "Iceland Krona", "Corona islandesa", 0],
  ["JMD", "Jamaican Dollar", "Dólar jamaiquino"],
  ["JOD", "Jordanian Dinar", "Dinar jordano", 3],
  ["JPY", "Yen", "Yen", 0],
  ["KES", "Kenyan Shilling", "Chelín keniano"],
  ["KGS", "Som", "Som"],
  ["KHR", "Riel", "Riel"],
  ["KMF", "Comorian Franc", "Franco comorense", 0],
  ["KPW", "North Korean Won", "Won norcoreano"],
  ["KRW", "Won", "Won", 0],
  ["KWD", "Kuwaiti Dinar", "Dinar kuwaití", 3],
  ["KYD", "Cayman Islands Dollar", "Dólar de las Islas Caimán"],
  ["KZT", "Tenge", "Tenge"],
  ["LAK", "Lao Kip", "Kip laosiano"],
  ["LBP", "Lebanese Pound", "Libra libanesa"],
  ["LKR", "Sri Lanka Rupee", "Rupia de Sri Lanka"],
  ["LRD", "Liberian Dollar", "Dólar liberiano"],
  ["LSL", "Loti", "Loti"],
  ["LYD", "Libyan Dinar", "Dinar libio", 3],
  ["MAD", "Moroccan Dirham", "Dírham marroquí"],
  ["MDL", "Moldovan Leu", "Leu moldavo"],
  ["MGA", "Malagasy Ariary", "Ariari malgache"],
  ["MKD", "Denar", "Denar"],
  ["MMK", "Kyat", "Kyat"],
  ["MNT", "Tugrik", "Tugrik"],
  ["MOP", "Pataca", "Pataca"],
  ["MRU", "Ouguiya", "Uquiya"],
  ["MUR", "Mauritius Rupee", "Rupia de Mauricio"],
  ["MVR", "Rufiyaa", "Rufiyaa"],
  ["MWK", "Malawi Kwacha", "Kwacha malauí"],
  ["MXN", "Mexican Peso", "Peso mexicano"],
  ["MXV", "Mexican Unidad de Inversion (UDI)", "Unidad de Inversión mexicana"],
  ["MYR", "Malaysian Ringgit", "Ringgit malasio"],
  ["MZN", "Mozambique Metical", "Metical mozambiqueño"],
  ["NAD", "Namibia Dollar", "Dólar namibio"],
  ["NGN", "Naira", "Naira"],
  ["NIO", "Cordoba Oro", "Córdoba oro"],
  ["NOK", "Norwegian Krone", "Corona noruega"],
  ["NPR", "Nepalese Rupee", "Rupia nepalí"],
  ["NZD", "New Zealand Dollar", "Dólar neozelandés"],
  ["OMR", "Rial Omani", "Rial omaní", 3],
  ["PAB", "Balboa", "Balboa"],
  ["PEN", "Sol", "Sol"],
  ["PGK", "Kina", "Kina"],
  ["PHP", "Philippine Peso", "Peso filipino"],
  ["PKR", "Pakistan Rupee", "Rupia pakistaní"],
  ["PLN", "Zloty", "Esloti"],
  ["PYG", "Guarani", "Guaraní", 0],
  ["QAR", "Qatari Rial", "Rial catarí"],
  ["RON", "Romanian Leu", "Leu rumano"],
  ["RSD", "Serbian Dinar", "Dinar serbio"],
  ["RUB", "Russian Ruble", "Rublo ruso"],
  ["RWF", "Rwanda Franc", "Franco ruandés", 0],
  ["SAR", "Saudi Riyal", "Riyal saudí"],
  ["SBD", "Solomon Islands Dollar", "Dólar de las Islas Salomón"],
  ["SCR", "Seychelles Rupee", "Rupia de Seychelles"],
  ["SDG", "Sudanese Pound", "Libra sudanesa"],
  ["SEK", "Swedish Krona", "Corona sueca"],
  ["SGD", "Singapore Dollar", "Dólar de Singapur"],
  ["SHP", "Saint Helena Pound", "Libra de Santa Elena"],
  ["SLE", "Leone", "Leone"],
  ["SOS", "Somali Shilling", "Chelín somalí"],
  ["SRD", "Surinam Dollar", "Dólar surinamés"],
  ["SSP", "South Sudanese Pound", "Libra sursudanesa"],
  ["STN", "Dobra", "Dobra"],
  ["SVC", "El Salvador Colon", "Colón salvadoreño"],
  ["SYP", "Syrian Pound", "Libra siria"],
  ["SZL", "Lilangeni", "Lilangeni"],
  ["THB", "Baht", "Baht"],
  ["TJS", "Somoni", "Somoni"],
  ["TMT", "Turkmenistan New Manat", "Nuevo manat turcomano"],
  ["TND", "Tunisian Dinar", "Dinar tunecino", 3],
  ["TOP", "Pa'anga", "Pa'anga"],
  ["TRY", "Turkish Lira", "Lira turca"],
  ["TTD", "Trinidad and Tobago Dollar", "Dólar de Trinidad y Tobago"],
  ["TWD", "New Taiwan Dollar", "Nuevo dólar taiwanés"],
  ["TZS", "Tanzanian Shilling", "Chelín tanzano"],
  ["UAH", "Hryvnia", "Grivna"],
  ["UGX", "Uganda Shilling", "Chelín ugandés", 0],
  ["USD", "US Dollar", "Dólar estadounidense"],
  ["USN", "US Dollar (Next day)", "Dólar estadounidense (día siguiente)"],
  ["UYI", "Uruguay Peso en Unidades Indexadas (UI)", "Peso uruguayo en unidades indexadas", 0],
  ["UYU", "Peso Uruguayo", "Peso uruguayo"],
  ["UYW", "Unidad Previsional", "Unidad Previsional", 4],
  ["UZS", "Uzbekistan Sum", "Som uzbeko"],
  ["VED", "Bolívar Soberano", "Bolívar soberano"],
  ["VES", "Bolívar Soberano", "Bolívar soberano"],
  ["VND", "Dong", "Dong", 0],
  ["VUV", "Vatu", "Vatu", 0],
  ["WST", "Tala", "Tala"],
  ["XAF", "CFA Franc BEAC", "Franco CFA BEAC", 0],
  ["XAG", "Silver", "Plata"],
  ["XAU", "Gold", "Oro"],
  ["XBA", "Bond Markets Unit European Composite Unit (EURCO)", "Unidad compuesta europea (EURCO)"],
  ["XBB", "Bond Markets Unit European Monetary Unit (E.M.U.-6)", "Unidad monetaria europea (E.M.U.-6)"],
  ["XBC", "Bond Markets Unit European Unit of Account 9 (E.U.A.-9)", "Unidad de cuenta europea 9 (E.U.A.-9)"],
  ["XBD", "Bond Markets Unit European Unit of Account 17 (E.U.A.-17)", "Unidad de cuenta europea 17 (E.U.A.-17)"],
  ["XCD", "East Caribbean Dollar", "Dólar del Caribe Oriental"],
  ["XDR", "SDR (Special Drawing Right)", "DEG (Derechos Especiales de Giro)"],
  ["XOF", "CFA Franc BCEAO", "Franco CFA BCEAO", 0],
  ["XPD", "Palladium", "Paladio"],
  ["XPF", "CFP Franc", "Franco CFP", 0],
  ["XPT", "Platinum", "Platino"],
  ["XSU", "Sucre", "Sucre"],
  ["XTS", "Codes specifically reserved for testing", "Códigos reservados para pruebas"],
  ["XUA", "ADB Unit of Account", "Unidad de cuenta del BAD"],
  ["XXX", "No currency", "Sin moneda"],
  ["YER", "Yemeni Rial", "Rial yemení"],
  ["ZAR", "Rand", "Rand"],
  ["ZMW", "Zambian Kwacha", "Kwacha zambiano"],
  ["ZWL", "Zimbabwe Dollar", "Dólar de Zimbabue"],
];

const DEFAULT_MINOR_UNIT = 2;
const ISO_4217_PATTERN = /^[A-Z]{3}$/;

const ISO_4217_INDEX: ReadonlyMap<string, Iso4217Currency> = new Map(
  ISO_4217_TABLE.map(([code, nameEn, nameEs, exponent]) => [
    code,
    { code, nameEn, nameEs, minorUnitExponent: exponent ?? DEFAULT_MINOR_UNIT },
  ]),
);

const ISO_4217_CATALOG: readonly Iso4217Currency[] = Object.freeze(
  [...ISO_4217_INDEX.values()],
);

export class CurrencyCode {
  private constructor(readonly code: string) {}

  static create(raw: string): Result<CurrencyCode, DomainError> {
    if (!ISO_4217_PATTERN.test(raw)) {
      return err(
        new DomainError(
          "CURRENCY_INVALID_CODE",
          `Currency code must be a 3-letter ISO 4217 code, got: ${JSON.stringify(raw)}`,
        ),
      );
    }
    return ok(new CurrencyCode(raw));
  }

  /** Whether the code is present in the ISO 4217 table (INV-MON-01). */
  static isKnownIso4217(code: string): boolean {
    return ISO_4217_INDEX.has(code);
  }

  /** The full ISO 4217 table with localizable names (S12, L20/L21). */
  static iso4217Catalog(): readonly Iso4217Currency[] {
    return ISO_4217_CATALOG;
  }

  get minorUnitExponent(): number {
    return (
      ISO_4217_INDEX.get(this.code)?.minorUnitExponent ?? DEFAULT_MINOR_UNIT
    );
  }

  equals(other: CurrencyCode): boolean {
    return this.code === other.code;
  }

  toString(): string {
    return this.code;
  }
}
