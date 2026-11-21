import crypto from 'node:crypto';
import { redisService } from './redis.service.js';
import { supabaseService } from './supabase.service.js';
import type {
  DestinationGranularity,
  GeocodedDestination,
  ResolvedStopOption
} from '../types/bus.types.js';

const GEO_CACHE_TTL_SECONDS = 86_400; // 24 hours

export interface DestinationClassification {
  granularity: DestinationGranularity;
  cleanedQuery: string;
  cityName?: string;
  streetName?: string;
  houseNumber?: string;
}

const KNOWN_CITIES: Array<{ canonical: string; regex: RegExp; cityTokenRegex: RegExp }> = [
  { canonical: 'חיפה', regex: /^(?:חיפה|хайф[аеуы]|haifa)$/i, cityTokenRegex: /(?:חיפה|хайф[аеуы]|haifa)/i },
  { canonical: 'טירת כרמל', regex: /^(?:טירת\s*כרמל|тират[- ]?кармел[ьяе]?|tirat\s*carmel)$/i, cityTokenRegex: /(?:טירת\s*כרמל|тират[- ]?кармел[ьяе]?|tirat\s*carmel)/i },
  { canonical: 'נשר', regex: /^(?:נשר|нешер[аеу]?|nesher)$/i, cityTokenRegex: /(?:נשר|нешер[аеу]?|nesher)/i },
  { canonical: 'קרית אתא', regex: /^(?:קרי?ית\s*אתא|кирьят[- ]?ат[аеу]|kiryat\s*ata)$/i, cityTokenRegex: /(?:קרי?ית\s*אתא|кирьят[- ]?ат[аеу]|kiryat\s*ata)/i },
  { canonical: 'קרית ביאליק', regex: /^(?:קרי?ית\s*ביאליק|кирьят[- ]?бьялик[аеу]?|kiryat\s*bialik)$/i, cityTokenRegex: /(?:קרי?ית\s*ביאליק|кирьят[- ]?бьялик[аеу]?|kiryat\s*bialik)/i },
  { canonical: 'קרית מוצקין', regex: /^(?:קרי?ית\s*מוצקין|кирьят[- ]?моцкин[аеу]?|kiryat\s*motzkin)$/i, cityTokenRegex: /(?:קרי?ית\s*מוצקין|кирьят[- ]?моцкин[аеу]?|kiryat\s*motzkin)/i },
  { canonical: 'קרית ים', regex: /^(?:קרי?ית\s*ים|кирьят[- ]?ям[аеу]?|kiryat\s*yam)$/i, cityTokenRegex: /(?:קרי?ית\s*ים|кирьят[- ]?ям[аеу]?|kiryat\s*yam)/i },
  { canonical: 'תל אביב', regex: /^(?:תל[- ]?אביב(?:[-\s]*יפו)?|тель[- ]?авив[аеу]?|tel[- ]?aviv(?:-yafo)?|tlv)$/i, cityTokenRegex: /(?:תל[- ]?אביב|тель[- ]?авив[аеу]?|tel[- ]?aviv|\btlv\b)/i },
  { canonical: 'ירושלים', regex: /^(?:ירושלים|иерусалим[аеу]?|jerusalem)$/i, cityTokenRegex: /(?:ירושלים|иерусалим[аеу]?|jerusalem)/i },
  { canonical: 'ראשון לציון', regex: /^(?:ראשון\s*לציון|ришон[- ]?ле[- ]?цион[аеу]?|rishon\s*lezion)$/i, cityTokenRegex: /(?:ראשון\s*לציון|ришон[- ]?ле[- ]?цион[аеу]?|rishon\s*lezion)/i },
  { canonical: 'רחובות', regex: /^(?:רחובות|реховот[аеу]?|rehovot)$/i, cityTokenRegex: /(?:רחובות|реховот[аеу]?|rehovot)/i },
  { canonical: 'פתח תקווה', regex: /^(?:פתח\s*תקווה|петах[- ]?тикв[аеу]|petah\s*tikva)$/i, cityTokenRegex: /(?:פתח\s*תקווה|петах[- ]?тикв[аеу]|petah\s*tikva)/i },
  { canonical: 'חולון', regex: /^(?:חולון|холон[аеу]?|holon)$/i, cityTokenRegex: /(?:חולון|холон[аеу]?|holon)/i },
  { canonical: 'בת ים', regex: /^(?:בת[-\s]*ים|бат[- ]?ям[аеу]?|bat[- ]?yam)$/i, cityTokenRegex: /(?:בת[-\s]*ים|бат[- ]?ям[аеу]?|bat[- ]?yam)/i },
  { canonical: 'רמת גן', regex: /^(?:רמת[-\s]*גן|рамат[- ]?ган[аеу]?|ramat[- ]?gan)$/i, cityTokenRegex: /(?:רמת[-\s]*גן|рамат[- ]?ган[аеу]?|ramat[- ]?gan)/i },
  { canonical: 'בני ברק', regex: /^(?:בני[-\s]*ברק|бней[- ]?брак[аеу]?|bnei[- ]?brak)$/i, cityTokenRegex: /(?:בני[-\s]*ברק|бней[- ]?брак[аеу]?|bnei[- ]?brak)/i },
  { canonical: 'גבעתיים', regex: /^(?:גבעתיים|гиватаим[аеу]?|givatayim)$/i, cityTokenRegex: /(?:גבעתיים|гиватаим[аеу]?|givatayim)/i },
  { canonical: 'כפר סבא', regex: /^(?:כפר[-\s]*סבא|кфар[- ]?саб[аеу]|kfar[- ]?saba)$/i, cityTokenRegex: /(?:כפר[-\s]*סבא|кфар[- ]?саб[аеу]|kfar[- ]?saba)/i },
  { canonical: 'רעננה', regex: /^(?:רעננה|раанан[аеу]|ra'?anana)$/i, cityTokenRegex: /(?:רעננה|раанан[аеу]|ra'?anana)/i },
  { canonical: 'הרצליה', regex: /^(?:הרצליה|герцли[яию]|herzliya)$/i, cityTokenRegex: /(?:הרצליה|герцли[яию]|herzliya)/i },
  { canonical: 'רמת השרון', regex: /^(?:רמת\s*השרון|рамат[- ]?ха[- ]?шарон[аеу]?|ramat\s*hasharon)$/i, cityTokenRegex: /(?:רמת\s*השרון|рамат[- ]?ха[- ]?шарон[аеу]?|ramat\s*hasharon)/i },
  { canonical: 'הוד השרון', regex: /^(?:הוד\s*השרון|ход[- ]?ха[- ]?шарон[аеу]?|hod\s*hasharon)$/i, cityTokenRegex: /(?:הוד\s*השרון|ход[- ]?ха[- ]?шарон[аеу]?|hod\s*hasharon)/i },
  { canonical: 'מודיעין מכבים רעות', regex: /^(?:מודיעין(?:\s*מכבים\s*רעות)?|модиин[аеу]?|modi'?in)$/i, cityTokenRegex: /(?:מודיעין|модиин[аеу]?|modi'?in)/i },
  { canonical: 'לוד', regex: /^(?:לוד|лод[аеу]?|lod)$/i, cityTokenRegex: /(?:^|\s)(?:לוד|лод[аеу]?|lod)(?=\s|,|$)/i },
  { canonical: 'רמלה', regex: /^(?:רמלה|рамл[аеу]|ramla)$/i, cityTokenRegex: /(?:רמלה|рамл[аеу]|ramla)/i },
  { canonical: 'יבנה', regex: /^(?:יבנה|явне|yavne)$/i, cityTokenRegex: /(?:יבנה|явне|yavne)/i },
  { canonical: 'נס ציונה', regex: /^(?:נס[-\s]*ציונה|нес[- ]?цион[аеу]|ness[- ]?ziona)$/i, cityTokenRegex: /(?:נס[-\s]*ציונה|нес[- ]?цион[аеу]|ness[- ]?ziona)/i },
  { canonical: 'גדרה', regex: /^(?:גדרה|гедер[аеу]|gedera)$/i, cityTokenRegex: /(?:גדרה|гедер[аеу]|gedera)/i },
  { canonical: 'בית שמש', regex: /^(?:בית[-\s]*שמש|бейт[- ]?шемеш[аеу]?|beit[- ]?shemesh)$/i, cityTokenRegex: /(?:בית[-\s]*שמש|бейт[- ]?шемеш[аеу]?|beit[- ]?shemesh)/i },
  { canonical: 'ראש העין', regex: /^(?:ראש\s*העין|рош[- ]?ха[- ]?айн[аеу]?|rosh\s*ha'?ayin)$/i, cityTokenRegex: /(?:ראש\s*העין|рош[- ]?ха[- ]?айн[аеу]?|rosh\s*ha'?ayin)/i },
  { canonical: 'אור יהודה', regex: /^(?:אור\s*יהודה|ор[- ]?йехуд[аеу]|or\s*yehuda)$/i, cityTokenRegex: /(?:אור\s*יהודה|ор[- ]?йехуд[аеу]|or\s*yehuda)/i },
  { canonical: 'יהוד מונוסון', regex: /^(?:יהוד(?:[-\s]*מונוסון)?|йехуд[аеу]?|yehud)$/i, cityTokenRegex: /(?:יהוד|йехуд[аеу]?|yehud)/i },
  { canonical: 'אריאל', regex: /^(?:אריאל|ариэл[ьяю]|ariel)$/i, cityTokenRegex: /(?:אריאל|ариэл[ьяю]|ariel)/i },
  { canonical: 'מעלה אדומים', regex: /^(?:מעלה\s*אדומים|маале[- ]?адумим|ma'?ale\s*adumim)$/i, cityTokenRegex: /(?:מעלה\s*אדומים|маале[- ]?адумим|ma'?ale\s*adumim)/i },
  { canonical: 'נתניה', regex: /^(?:נתניה|нетани[яию]|netanya)$/i, cityTokenRegex: /(?:נתניה|нетани[яию]|netanya)/i },
  { canonical: 'חדרה', regex: /^(?:חדרה|хадер[аеу]|hadera)$/i, cityTokenRegex: /(?:חדרה|хадер[аеу]|hadera)/i },
  { canonical: 'אור עקיבא', regex: /^(?:אור\s*עקיבא|ор[- ]?акив[аеу]|or\s*akiva)$/i, cityTokenRegex: /(?:אור\s*עקיבא|ор[- ]?акив[аеу]|or\s*akiva)/i },
  { canonical: 'קיסריה', regex: /^(?:קיסריה|кесари[яию]|caesarea)$/i, cityTokenRegex: /(?:קיסריה|кесари[яию]|caesarea)/i },
  { canonical: 'פרדס חנה כרכור', regex: /^(?:פרדס\s*חנה(?:[-\s]*כרכור)?|пардес[- ]?хан[аеу]|pardes\s*hana)$/i, cityTokenRegex: /(?:פרדס\s*חנה|пардес[- ]?хан[аеу]|pardes\s*hana)/i },
  { canonical: 'בנימינה', regex: /^(?:בנימינה(?:[-\s]*גבעת\s*עדה)?|биньямин[аеу]|binyamina)$/i, cityTokenRegex: /(?:בנימינה|биньямин[аеу]|binyamina)/i },
  { canonical: 'זכרון יעקב', regex: /^(?:זכרון\s*יעקב|зихрон[- ]?яаков[аеу]?|zikhron\s*ya'?akov)$/i, cityTokenRegex: /(?:זכרון\s*יעקב|зихрон[- ]?яаков[аеу]?|zikhron\s*ya'?akov)/i },
  { canonical: 'עתלית', regex: /^(?:עתלית|атлит[аеу]?|atlit)$/i, cityTokenRegex: /(?:עתלית|атлит[аеу]?|atlit)/i },
  { canonical: 'עכו', regex: /^(?:עכו|акко|acre|akko)$/i, cityTokenRegex: /(?:עכו|\bакко\b|\bacre\b|\bakko\b)/i },
  { canonical: 'נהריה', regex: /^(?:נהריה|нагари[яию]|nahariya)$/i, cityTokenRegex: /(?:נהריה|нагари[яию]|nahariya)/i },
  { canonical: 'מעלות', regex: /^(?:מעלות(?:[-\s]*תרשיחא)?|маалот|ma'?alot)$/i, cityTokenRegex: /(?:מעלות|маалот|ma'?alot)/i },
  { canonical: 'כרמיאל', regex: /^(?:כרמיאל|кармиэл[ьяю]|karmiel)$/i, cityTokenRegex: /(?:כרמיאל|кармиэл[ьяю]|karmiel)/i },
  { canonical: 'צפת', regex: /^(?:צפת|цфат[аеу]?|safed|tzfat)$/i, cityTokenRegex: /(?:צפת|цфат[аеу]?|safed|tzfat)/i },
  { canonical: 'קרית שמונה', regex: /^(?:קרי?ית\s*שמונה|кирьят[- ]?шмон[аеу]|kiryat\s*shmona)$/i, cityTokenRegex: /(?:קרי?ית\s*שמונה|кирьят[- ]?шмон[аеу]|kiryat\s*shmona)/i },
  { canonical: 'קצרין', regex: /^(?:קצרין|кацрин[аеу]?|katzrin)$/i, cityTokenRegex: /(?:קצרין|кацрин[аеу]?|katzrin)/i },
  { canonical: 'טבריה', regex: /^(?:טבריה|твери[яию]|тивери[яию]|tiberias)$/i, cityTokenRegex: /(?:טבריה|твери[яию]|тивери[яию]|tiberias)/i },
  { canonical: 'נוף הגליל', regex: /^(?:נוף\s*הגליל|נצרת\s*עילית|ноф[- ]?ха[- ]?галил|нацерет[- ]?илит|nof\s*hagalil)$/i, cityTokenRegex: /(?:נוף\s*הגליל|נצרת\s*עילית|ноф[- ]?ха[- ]?галил|нацерет[- ]?илит|nof\s*hagalil)/i },
  { canonical: 'נצרת', regex: /^(?:נצרת|назарет[аеу]?|nazareth)$/i, cityTokenRegex: /(?:נצרת(?!\s*עילית)|назарет[аеу]?|nazareth)/i },
  { canonical: 'עפולה', regex: /^(?:עפולה|афул[аеу]|afula)$/i, cityTokenRegex: /(?:עפולה|афул[аеу]|afula)/i },
  { canonical: 'מגדל העמק', regex: /^(?:מגדל\s*העמק|мигдаль[- ]?ха[- ]?эмек[аеу]?|migdal\s*ha'?emek)$/i, cityTokenRegex: /(?:מגדל\s*העמק|мигдаль[- ]?ха[- ]?эмек[аеу]?|migdal\s*ha'?emek)/i },
  { canonical: 'יקנעם עילית', regex: /^(?:יקנעם(?:\s*עילית)?|йокнеам[аеу]?|yokneam)$/i, cityTokenRegex: /(?:יקנעם|йокнеам[аеу]?|yokneam)/i },
  { canonical: 'בית שאן', regex: /^(?:בית[-\s]*שאן|бейт[- ]?шеан[аеу]?|beit[- ]?she'?an)$/i, cityTokenRegex: /(?:בית[-\s]*שאן|бейт[- ]?шеан[аеу]?|beit[- ]?she'?an)/i },
  { canonical: 'אשדוד', regex: /^(?:אשדוד|ашдод[аеу]?|ashdod)$/i, cityTokenRegex: /(?:אשדוד|ашдод[аеу]?|ashdod)/i },
  { canonical: 'אשקלון', regex: /^(?:אשקלון|ашкелон[аеу]?|ashkelon)$/i, cityTokenRegex: /(?:אשקלון|ашкелон[аеу]?|ashkelon)/i },
  { canonical: 'קריית גת', regex: /^(?:קרי?ית\s*גת|кирьят[- ]?гат[аеу]?|kiryat\s*gat)$/i, cityTokenRegex: /(?:קרי?ית\s*גת|кирьят[- ]?гат[аеу]?|kiryat\s*gat)/i },
  { canonical: 'שדרות', regex: /^(?:שדרות|сдерот[аеу]?|sderot)$/i, cityTokenRegex: /(?:שדרות|сдерот[аеу]?|sderot)/i },
  { canonical: 'נתיבות', regex: /^(?:נתיבות|нетивот[аеу]?|netivot)$/i, cityTokenRegex: /(?:נתיבות|нетивот[аеу]?|netivot)/i },
  { canonical: 'אופקים', regex: /^(?:אופקים|офаким[аеу]?|ofakim)$/i, cityTokenRegex: /(?:אופקים|офаким[аеу]?|ofakim)/i },
  { canonical: 'באר שבע', regex: /^(?:באר\s*שבע|беэр[- ]?шев[аеу]|beer\s*sheva)$/i, cityTokenRegex: /(?:באר\s*שבע|беэр[- ]?шев[аеу]|beer\s*sheva)/i },
  { canonical: 'רהט', regex: /^(?:רהט|рахат[аеу]?|rahat)$/i, cityTokenRegex: /(?:רהט|рахат[аеу]?|rahat)/i },
  { canonical: 'דימונה', regex: /^(?:דימונה|димон[аеу]|dimona)$/i, cityTokenRegex: /(?:דימונה|димон[аеу]|dimona)/i },
  { canonical: 'ערד', regex: /^(?:ערד|арад[аеу]?|arad)$/i, cityTokenRegex: /(?:ערד|арад[аеу]?|\barad\b)/i },
  { canonical: 'מצפה רמון', regex: /^(?:מצפה\s*רמון|мицпе[- ]?рамон[аеу]?|mitzpe\s*ramon)$/i, cityTokenRegex: /(?:מצפה\s*רמון|мицпе[- ]?рамон[аеу]?|mitzpe\s*ramon)/i },
  { canonical: 'אילת', regex: /^(?:אילת|эйлат[аеу]?|eilat)$/i, cityTokenRegex: /(?:אילת|эйлат[аеу]?|eilat)/i }
];

const KNOWN_STREET_ROOTS =
  /(?:חורב|horev|хорев|הרצל|herzl|герцл|פרויד|freud|фрейд|מוריה|moriah|мория|רוטשילד|rothschild|ротшильд|דיזנגוף|dizengoff|дизенгоф|ארלוזורוב|arlozorov|арлозоров|יפו|jaffa|яффо|פיק["']?א|pika|пика|אלנבי|allenby|алленби|איינשטיין|einstein|эйнштейн|אבא\s*חושי|abba\s*hushi|аба\s*хуши|ז["']?בוטינסקי|jabotinsky|жаботинск|ויצמן|weizmann|вейцман|נרקיסים|narkisim|наркисим|ההגנה|ha?hagana|ха-?хагана|הנשיא|hanassi|ха-?наси)/i;

const STREET_PREFIX_REGEX =
  /(?:^|\s)(?:улиц[аеуы]|ул\.?|на\s+улицу|проспект|пр-?т|бульвар|шоссе|רחוב|רח׳|שדרות|שד׳|דרך|street|st\.?|ave\.?|avenue|blvd\.?|boulevard|rd\.?|road)(?=\s|$)/i;

const POI_KEYWORD_REGEX =
  /(?:больниц|клиник|поликлиник|госпитал|университет|институт|техн?ион|каньон|торгов|центр(?!\s*улиц)|вокзал|автостанц|тах?ана\s*мерказит|аэропорт|бен[- ]?гурион|рамбам|азриэли|савидор|дизенгоф\s*центр|матам|хоф\s*(?:ха)?кармель|гранд\s*каньон|адар|בית\s*חולים|מרפאה|קופת\s*חולים|אוניברסיט|טכניון|קניון|תחנה\s*מרכזית|ת\.\s*מרכזית|רכבת|נמל\s*תעופה|מרכז\s*חורב|מרכז\s*הכרמל|hospital|clinic|university|technion|mall|station|airport|azrieli|rambam|savidor|matam|hof\s*ha?carmel|grand\s*canyon)/i;

interface GooglePlacesTextSearchResponse {
  status: string;
  results?: Array<{
    name?: string;
    formatted_address?: string;
    geometry?: {
      location?: { lat: number; lng: number };
    };
  }>;
}

interface GoogleGeocodeResponse {
  status: string;
  results?: Array<{
    formatted_address?: string;
    geometry?: {
      location?: { lat: number; lng: number };
    };
  }>;
}

interface NominatimItem {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  type?: string;
  addresstype?: string;
}

interface IsraelLandmark {
  patterns: RegExp[];
  lat: number;
  lon: number;
  place_name: string;
  formatted_address: string;
}

const ISRAEL_GAZETTEER: IsraelLandmark[] = [
  // --- Tel Aviv & Gush Dan Corridor ---
  {
    patterns: [/азриэли|azrieli|עזריאלי|шарона|sarona|שרונה/i],
    lat: 32.0747,
    lon: 34.7920,
    place_name: 'Тель-Авив — Центр Азриэли (עזריאלי, תל אביב)',
    formatted_address: 'Derech Menachem Begin 132, Tel Aviv-Yafo, Israel'
  },
  {
    patterns: [/савидор|savidor|סבידור|арлозоров|arlozorov|ארלוזורוב|ракевет\s*мерказ/i],
    lat: 32.0837,
    lon: 34.7978,
    place_name: 'Тель-Авив — Ракевет Мерказ Савидор (רכבת מרכז סבידור)',
    formatted_address: 'Al Parashat Drakhim 1, Tel Aviv-Yafo, Israel'
  },
  {
    patterns: [/дизенгоф|dizengof|dizengoff|דיזנגוף/i],
    lat: 32.0754,
    lon: 34.7749,
    place_name: 'Тель-Авив — Дизенгоф Центר (דיזנגוף סנטר)',
    formatted_address: 'Dizengoff St 50, Tel Aviv-Yafo, Israel'
  },
  {
    patterns: [/центральн\w*\s*автостанц\w*\s*тель|тах?ана\s*мерказит\s*תל|תחנה\s*מרכזית\s*תל\s*אביב|хагана|ההגנה/i],
    lat: 32.0558,
    lon: 34.7788,
    place_name: 'Тель-Авив — Центральная автостанция (ת. מרכזית תל אביב)',
    formatted_address: 'Levinsky St 108, Tel Aviv-Yafo, Israel'
  },
  {
    patterns: [/тель[- ]?авив|tel[- ]?aviv|תל[- ]?אביב|\btlv\b/i],
    lat: 32.0747,
    lon: 34.7920,
    place_name: 'Тель-Авив (תל אביב-יפו)',
    formatted_address: 'Tel Aviv-Yafo, Israel'
  },

  // --- Jerusalem Corridor ---
  {
    patterns: [/иерусалим|jerusalem|ירושלים|נבון|стена\s*плача|כותל/i],
    lat: 31.7890,
    lon: 35.2030,
    place_name: 'Иерусалим — Центральный вокзал (ירושלים מרכז)',
    formatted_address: 'Jaffa St 208, Jerusalem, Israel'
  },

  // --- Southern & Central Intercity Cities ---
  // --- Northern & Central Intercity Cities ---
  {
    patterns: [/קי?רי?ית\s*גת|кирьят[- ]?гат|kiryat\s*gat/i],
    lat: 31.6095,
    lon: 34.7642,
    place_name: 'Кирьят-Гат — Центральная автостанция (קריית גת - תחנה מרכזית)',
    formatted_address: 'Kiryat Gat Central Bus Station, Israel'
  },
  {
    patterns: [/^חיפה$|^хайф[аеуы]?$|^haifa$/i],
    lat: 32.7934,
    lon: 34.9590,
    place_name: 'Хайфа — ת. מרכזית חוף הכרמל (Haifa)',
    formatted_address: 'Haifa Hof HaCarmel Central Station, Haifa, Israel'
  },
  {
    patterns: [/эйлат|eilat|אילת/i],
    lat: 29.5569,
    lon: 34.9498,
    place_name: 'Эйлат (אילת — תחנה מרכזית)',
    formatted_address: 'Eilat Central Bus Station, Israel'
  },
  {
    patterns: [/ашдод|ashdod|אשדוד/i],
    lat: 31.7978,
    lon: 34.6503,
    place_name: 'Ашдод (אשדוד — תחנה מרכזית / סיטי)',
    formatted_address: 'HaGdud HaIvri St 6, Ashdod, Israel'
  },
  {
    patterns: [/ашкелон|ashkelon|אשקלון/i],
    lat: 31.6688,
    lon: 34.5743,
    place_name: 'Ашкелон (אשקלון)',
    formatted_address: 'HaNassi Blvd, Ashkelon, Israel'
  },
  {
    patterns: [/беэр[- ]?шева|beer\s*sheva|באר\s*שבע/i],
    lat: 31.2439,
    lon: 34.7966,
    place_name: 'Беэр-Шева (באר שבע)',
    formatted_address: 'Yitzhak Rager Blvd, Beer Sheva, Israel'
  },
  {
    patterns: [/димон[аеу]|dimona|דימונה/i],
    lat: 31.0700,
    lon: 35.0330,
    place_name: 'Димона (דימונה — תחנה מרכזית)',
    formatted_address: 'Dimona Central Bus Station, Israel'
  },
  {
    patterns: [/мицпе[- ]?рамон|mitzpe\s*ramon|מצפה\s*רמון/i],
    lat: 30.6100,
    lon: 34.8010,
    place_name: 'Мицпе-Рамон (מצפה רמון)',
    formatted_address: 'Mitzpe Ramon, Israel'
  },
  {
    patterns: [/ришон[- ]?ле[- ]?цион|rishon\s*lezion|ראשון\s*לציון/i],
    lat: 31.9730,
    lon: 34.7925,
    place_name: 'Ришон-ле-Цион (ראשון לציון)',
    formatted_address: 'Herzl St, Rishon LeZion, Israel'
  },
  {
    patterns: [
      /(?:שכונת\s*)?רחובות\s*(?:ה?הולנדית|הולנד)/i,
      /rehovot\s*(?:ha)?hollandit/i,
      /реховот\s*(?:голланд|голландия)/i
    ],
    lat: 31.8913,
    lon: 34.7796,
    place_name: 'רחובות ההולנדית (שכונה)',
    formatted_address: 'Har HaTsofim St, Rehovot Hollandit, Israel'
  },
  {
    patterns: [/реховот|rehovot|רחובות/i],
    lat: 31.8928,
    lon: 34.8113,
    place_name: 'Реховот (רחובות)',
    formatted_address: 'Herzl St, Rehovot, Israel'
  },
  {
    patterns: [/петах[- ]?тиква|petah\s*tikva|פתח\s*תקווה/i],
    lat: 32.0840,
    lon: 34.8878,
    place_name: 'Петах-Тиква (פתח תקווה)',
    formatted_address: 'Jabotinsky Rd, Petah Tikva, Israel'
  },
  {
    patterns: [/хадера|hadera|חדרה/i],
    lat: 32.4340,
    lon: 34.9197,
    place_name: 'Хадера (חדרה)',
    formatted_address: 'HaNassi Weizmann St, Hadera, Israel'
  },
  {
    patterns: [/акко|acre|akko|עכו/i],
    lat: 32.9278,
    lon: 35.0818,
    place_name: 'Акко (עכו)',
    formatted_address: 'Ben Ami St, Acre, Israel'
  },
  {
    patterns: [/нагария|nahariya|נהריה/i],
    lat: 33.0058,
    lon: 35.0989,
    place_name: 'Нагария (נהריה)',
    formatted_address: 'Gaaton Blvd, Nahariya, Israel'
  },
  {
    patterns: [/холон|holon|חולון/i],
    lat: 32.0158,
    lon: 34.7874,
    place_name: 'Холон (חולון)',
    formatted_address: 'Sokolov St, Holon, Israel'
  },
  {
    patterns: [/бат[- ]?ям|bat[- ]?yam|בת[- ]?ים/i],
    lat: 32.0165,
    lon: 34.7503,
    place_name: 'Бат-Ям (בת ים)',
    formatted_address: 'Balfour St, Bat Yam, Israel'
  },
  {
    patterns: [/рамат[- ]?ган|ramat[- ]?gan|רמת[- ]?גן/i],
    lat: 32.0684,
    lon: 34.8248,
    place_name: 'Рамат-Ган (רמת גן)',
    formatted_address: 'Bialik St, Ramat Gan, Israel'
  },
  {
    patterns: [/бней[- ]?брак|bnei[- ]?brak|בני[- ]?ברק/i],
    lat: 32.0834,
    lon: 34.8338,
    place_name: 'Бней-Брак (בני ברק)',
    formatted_address: 'Rabbi Akiva St, Bnei Brak, Israel'
  },
  {
    patterns: [/гиватаим|givatayim|גבעתיים/i],
    lat: 32.0722,
    lon: 34.8125,
    place_name: 'Гиватаим (גבעתיים)',
    formatted_address: 'Katznelson St, Givatayim, Israel'
  },
  {
    patterns: [/кфар[- ]?саб[аеу]|kfar[- ]?saba|כפר[-\s]*סבא/i],
    lat: 32.175,
    lon: 34.9069,
    place_name: 'Кфар-Саба (כפר סבא)',
    formatted_address: 'Weizmann St, Kfar Saba, Israel'
  },
  {
    patterns: [/раанана|ra'?anana|רעננה/i],
    lat: 32.1848,
    lon: 34.8713,
    place_name: 'Раанана (רעננה)',
    formatted_address: 'Ahuza St, Raanana, Israel'
  },
  {
    patterns: [/рамат[- ]?ха[- ]?шарон|ramat\s*hasharon|רמת\s*השרון/i],
    lat: 32.1461,
    lon: 34.8394,
    place_name: 'Рамат-ха-Шарон (רמת השרון)',
    formatted_address: 'Sokolov Blvd, Ramat HaSharon, Israel'
  },
  {
    patterns: [/ход[- ]?ха[- ]?шарон|hod\s*hasharon|הוד\s*השרון/i],
    lat: 32.1502,
    lon: 34.8886,
    place_name: 'Ход-ха-Шарон (הוד השרון)',
    formatted_address: 'Derech Ramatayim, Hod HaSharon, Israel'
  },
  {
    patterns: [/модиин|modi'?in|מודיעין/i],
    lat: 31.8977,
    lon: 35.0104,
    place_name: 'Модиин (מודיעין מכבים רעות)',
    formatted_address: 'Modiin Central Station, Israel'
  },
  {
    patterns: [/(?:^|\s)лод[аеу]?(?=\s|,|$)|\blod\b|^לוד$/i],
    lat: 31.9514,
    lon: 34.8881,
    place_name: 'Лод (לוד)',
    formatted_address: 'Herzl Blvd, Lod, Israel'
  },
  {
    patterns: [/рамл[аеу]|ramla|רמלה/i],
    lat: 31.9292,
    lon: 34.8656,
    place_name: 'Рамла (רמלה)',
    formatted_address: 'Herzl Blvd, Ramla, Israel'
  },
  {
    patterns: [/явне|yavne|יבנה/i],
    lat: 31.8781,
    lon: 34.7398,
    place_name: 'Явне (יבנה)',
    formatted_address: 'HaAtzmaut Blvd, Yavne, Israel'
  },
  {
    patterns: [/нес[- ]?цион|ness[- ]?ziona|נס[-\s]*ציונה/i],
    lat: 31.9293,
    lon: 34.7987,
    place_name: 'Нес-Циона (נס ציונה)',
    formatted_address: 'Weizmann St, Ness Ziona, Israel'
  },
  {
    patterns: [/гедер[аеу]|gedera|גדרה/i],
    lat: 31.8146,
    lon: 34.7796,
    place_name: 'Гедера (גדרה)',
    formatted_address: 'Bilu St, Gedera, Israel'
  },
  {
    patterns: [/бейт[- ]?шемеш|beit[- ]?shemesh|בית[-\s]*שמש/i],
    lat: 31.747,
    lon: 34.9881,
    place_name: 'Бейт-Шемеш (בית שמש)',
    formatted_address: 'HaNassi St, Beit Shemesh, Israel'
  },
  {
    patterns: [/рош[- ]?ха[- ]?айн|rosh\s*ha'?ayin|ראש\s*העין/i],
    lat: 32.0956,
    lon: 34.9566,
    place_name: 'Рош-ха-Айн (ראש העין)',
    formatted_address: 'Begin Blvd, Rosh HaAyin, Israel'
  },
  {
    patterns: [/ор[- ]?йехуд|or\s*yehuda|אור\s*יהודה/i],
    lat: 32.0292,
    lon: 34.8579,
    place_name: 'Ор-Иехуда (אור יהודה)',
    formatted_address: 'Yosef Katz St, Or Yehuda, Israel'
  },
  {
    patterns: [/йехуд|yehud|יהוד/i],
    lat: 32.0332,
    lon: 34.8878,
    place_name: 'Йехуд-Моноссон (יהוד מונוסון)',
    formatted_address: 'Saadia HaTov St, Yehud, Israel'
  },
  {
    patterns: [/ариэл|ariel|אריאל/i],
    lat: 32.1045,
    lon: 35.1743,
    place_name: 'Ариэль (אריאל)',
    formatted_address: 'Ariel Central, Israel'
  },
  {
    patterns: [/маале[- ]?адумим|ma'?ale\s*adumim|מעלה\s*אדומים/i],
    lat: 31.777,
    lon: 35.2974,
    place_name: 'Маале-Адумим (מעלה אדומים)',
    formatted_address: 'Derech Kedem, Maale Adumim, Israel'
  },
  {
    patterns: [/твери|тивери|tiberias|טבריה/i],
    lat: 32.7922,
    lon: 35.5312,
    place_name: 'Тверия (טבריה — תחנה מרכזית)',
    formatted_address: 'HaBanim St, Tiberias, Israel'
  },
  {
    patterns: [/ноф[- ]?ха[- ]?галил|нацерет[- ]?илит|nof\s*hagalil|נוף\s*הגליל|נצרת\s*עילית/i],
    lat: 32.7069,
    lon: 35.3249,
    place_name: 'Ноф-ха-Галиль (נוף הגליל)',
    formatted_address: 'Maale Yitzhak Blvd, Nof HaGalil, Israel'
  },
  {
    patterns: [/назарет|nazareth|נצרת/i],
    lat: 32.7021,
    lon: 35.2978,
    place_name: 'Назарет (נצרת)',
    formatted_address: 'Paulus VI St, Nazareth, Israel'
  },
  {
    patterns: [/афул|afula|עפולה/i],
    lat: 32.6075,
    lon: 35.2895,
    place_name: 'Афула (עפולה — תחנה מרכזית)',
    formatted_address: 'Afula Central Bus Station, Israel'
  },
  {
    patterns: [/кармиэл|karmiel|כרמיאל/i],
    lat: 32.9199,
    lon: 35.2961,
    place_name: 'Кармиэль (כרמיאל)',
    formatted_address: 'HaNassi Blvd, Karmiel, Israel'
  },
  {
    patterns: [/цфат|safed|tzfat|צפת/i],
    lat: 32.9646,
    lon: 35.496,
    place_name: 'Цфат (צפת — תחנה מרכזית)',
    formatted_address: 'HaAtzmaut St, Safed, Israel'
  },
  {
    patterns: [/кирьят[- ]?шмон|kiryat\s*shmona|קרי?ית\s*שמונה/i],
    lat: 33.2073,
    lon: 35.5699,
    place_name: 'Кирьят-Шмона (קרית שמונה — תחנה מרכזית)',
    formatted_address: 'Tel Hai Rd, Kiryat Shmona, Israel'
  },
  {
    patterns: [/кацрин|katzrin|קצרין/i],
    lat: 32.9918,
    lon: 35.6911,
    place_name: 'Кацрин (קצרין)',
    formatted_address: 'Katzrin, Israel'
  },
  {
    patterns: [/маалот|ma'?alot|מעלות/i],
    lat: 33.0169,
    lon: 35.271,
    place_name: 'Маалот-Таршиха (מעלות-תרשיחא)',
    formatted_address: 'Maalot Central Station, Israel'
  },
  {
    patterns: [/мигдаль[- ]?ха[- ]?эмек|migdal\s*ha'?emek|מגדל\s*העמק/i],
    lat: 32.6754,
    lon: 35.2407,
    place_name: 'Мигдаль-ха-Эмек (מגדל העמק)',
    formatted_address: 'Migdal HaEmek, Israel'
  },
  {
    patterns: [/йокнеам|yokneam|יקנעם/i],
    lat: 32.6594,
    lon: 35.1095,
    place_name: 'Йокнеам (יקנעם עילית)',
    formatted_address: 'Yokneam Illit, Israel'
  },
  {
    patterns: [/бейт[- ]?шеан|beit[- ]?she'?an|בית[-\s]*שאן/i],
    lat: 32.4971,
    lon: 35.4975,
    place_name: 'Бейт-Шеан (בית שאן)',
    formatted_address: 'Beit Shean, Israel'
  },
  {
    patterns: [/нешер|nesher|נשר/i],
    lat: 32.7717,
    lon: 35.0394,
    place_name: 'Нешер (נשר)',
    formatted_address: 'Derech HaShalom, Nesher, Israel'
  },
  {
    patterns: [/кирьят[- ]?ат|kiryat\s*ata|קרי?ית\s*אתא/i],
    lat: 32.8058,
    lon: 35.1046,
    place_name: 'Кирьят-Ата (קרית אתא)',
    formatted_address: 'HaAtzmaut St, Kiryat Ata, Israel'
  },
  {
    patterns: [/кирьят[- ]?бьялик|kiryat\s*bialik|קרי?ית\s*ביאליק/i],
    lat: 32.8275,
    lon: 35.0858,
    place_name: 'Кирьят-Бялик (קרית ביאליק)',
    formatted_address: 'HaHistadrut Blvd, Kiryat Bialik, Israel'
  },
  {
    patterns: [/кирьят[- ]?моцкин|kiryat\s*motzkin|קרי?ית\s*מוצקין/i],
    lat: 32.838,
    lon: 35.0776,
    place_name: 'Кирьят-Моцкин (קרית מוצקין)',
    formatted_address: 'Ben Gurion Blvd, Kiryat Motzkin, Israel'
  },
  {
    patterns: [/кирьят[- ]?ям|kiryat\s*yam|קרי?ית\s*ים/i],
    lat: 32.8493,
    lon: 35.0689,
    place_name: 'Кирьят-Ям (קרית ים)',
    formatted_address: 'Jerusalem Blvd, Kiryat Yam, Israel'
  },
  {
    patterns: [/зихрон|zikhron|זכרון\s*יעקב/i],
    lat: 32.5707,
    lon: 34.9537,
    place_name: 'Зихрон-Яаков (זכרון יעקב)',
    formatted_address: 'HaMeyasdim St, Zikhron Yaakov, Israel'
  },
  {
    patterns: [/биньямин|binyamina|בנימינה/i],
    lat: 32.5219,
    lon: 34.9498,
    place_name: 'Биньямина (בנימינה-גבעת עדה)',
    formatted_address: 'Binyamina Train Station, Israel'
  },
  {
    patterns: [/пардес[- ]?хан|pardes\s*hana|פרדס\s*חנה/i],
    lat: 32.4737,
    lon: 34.9713,
    place_name: 'Пардес-Хана (פרדס חנה כרכור)',
    formatted_address: 'Derech HaBanim, Pardes Hana, Israel'
  },
  {
    patterns: [/ор[- ]?акива|or\s*akiva|אור\s*עקיבא/i],
    lat: 32.507,
    lon: 34.9204,
    place_name: 'Ор-Акива (אור עקיבא)',
    formatted_address: 'HaNassi St, Or Akiva, Israel'
  },
  {
    patterns: [/кесари|caesarea|קיסריה/i],
    lat: 32.5189,
    lon: 34.9045,
    place_name: 'Кесария (קיסריה)',
    formatted_address: 'Caesarea, Israel'
  },
  {
    patterns: [/атлит|atlit|עתלית/i],
    lat: 32.6889,
    lon: 34.9385,
    place_name: 'Атлит (עתלית)',
    formatted_address: 'HaZayit St, Atlit, Israel'
  },
  {
    patterns: [/сдерот|sderot|שדרות/i],
    lat: 31.525,
    lon: 34.5955,
    place_name: 'Сдерот (שדרות)',
    formatted_address: 'Begin Blvd, Sderot, Israel'
  },
  {
    patterns: [/нетивот|netivot|נתיבות/i],
    lat: 31.4227,
    lon: 34.5887,
    place_name: 'Нетивот (נתיבות)',
    formatted_address: 'Jerusalem St, Netivot, Israel'
  },
  {
    patterns: [/офаким|ofakim|אופקים/i],
    lat: 31.3141,
    lon: 34.6203,
    place_name: 'Офаким (אופקים)',
    formatted_address: 'Herzl St, Ofakim, Israel'
  },
  {
    patterns: [/рахат|rahat|רהט/i],
    lat: 31.3925,
    lon: 34.7544,
    place_name: 'Рахат (רהט)',
    formatted_address: 'Rahat, Israel'
  },
  {
    patterns: [/арад|arad|ערד/i],
    lat: 31.2588,
    lon: 35.2128,
    place_name: 'Арад (ערד — תחנה מרכזית)',
    formatted_address: 'Arad Central Bus Station, Israel'
  },

  // --- Coastal & Central Hubs ---
  {
    patterns: [/нетания|netanya|נתניה/i],
    lat: 32.3275,
    lon: 34.8565,
    place_name: 'Нетания (נתניה)',
    formatted_address: 'Herzl St, Netanya, Israel'
  },
  {
    patterns: [/герцлия|herzliya|הרצליה/i],
    lat: 32.1633,
    lon: 34.8215,
    place_name: 'Герцлия (הרצליה)',
    formatted_address: 'Ben Gurion St, Herzliya, Israel'
  },
  {
    patterns: [/бен[- ]?гурион|ben[- ]?gurion|נתב"?ג|аэропорт\s*израиль/i],
    lat: 32.0005,
    lon: 34.8705,
    place_name: 'Аэропорт Бен-Гурион (נמל התעופה בן גוריון)',
    formatted_address: 'Terminal 3, Ben Gurion Airport, Israel'
  },

  // --- Haifa & Tirat Carmel Landmarks ---
  {
    patterns: [/университет|university|אוניברסיט/i],
    lat: 32.7620,
    lon: 35.0185,
    place_name: 'Университет Хайфы (אוניברסיטת חיפה)',
    formatted_address: 'Abba Hushi Ave 199, Haifa, Israel'
  },
  {
    patterns: [/рамбам|rambam|רמב"?ם|бат[- ]?галим|bat[- ]?galim|בת[- ]?גלים/i],
    lat: 32.8325,
    lon: 34.9862,
    place_name: 'Больница Рамбам / Бат-Галим (רמב"ם)',
    formatted_address: 'HaAliya HaShniya St 8, Haifa, Israel'
  },
  {
    patterns: [/адар|hadar|הדר|герцль|herzl/i],
    lat: 32.8115,
    lon: 34.9965,
    place_name: 'Район Адар / Герцль (הדר, חיפה)',
    formatted_address: 'Herzl St, Haifa, Israel'
  },
  {
    patterns: [/хорев|horev|חורב|поликлиник|מרפאה|клалит|כללית/i],
    lat: 32.7832,
    lon: 34.9859,
    place_name: 'Центр Хорев / Поликлиника (מרכז חורב)',
    formatted_address: 'Horev St 15, Haifa, Israel'
  },
  {
    patterns: [/техн?ион|technion|טכניון/i],
    lat: 32.7775,
    lon: 35.0215,
    place_name: 'Технион (הטכניון, חיפה)',
    formatted_address: 'Technion City, Haifa, Israel'
  },
  {
    patterns: [/гранд\s*каньон|grand\s*canyon|גרנד\s*קניון/i],
    lat: 32.7892,
    lon: 35.0082,
    place_name: 'Гранд Каньон (גרנד קניון חיפה)',
    formatted_address: 'Derech Simcha Golan 54, Haifa, Israel'
  },
  {
    patterns: [/хоф\s*(ха)?кармель|hof\s*ha?carmel|חוף\s*הכרמל/i],
    lat: 32.7934,
    lon: 34.9592,
    place_name: 'Хоф ха-Кармель (ת. מרכזית חוף הכרמל)',
    formatted_address: 'Sderot HaHagana, Haifa, Israel'
  },
  {
    patterns: [/тират|tirat|טירת/i],
    lat: 32.7615,
    lon: 34.9718,
    place_name: 'Тират-Кармель (טירת כרמל)',
    formatted_address: 'HaHagana St, Tirat Carmel, Israel'
  },
  {
    patterns: [/матам|matam|מת''?מ|хай-?тек/i],
    lat: 32.7902,
    lon: 34.9616,
    place_name: 'Парк МАТАМ (פארק מת״מ, חיפה)',
    formatted_address: 'ATRAM / Matam Park, Haifa, Israel'
  },
  {
    patterns: [/мерказ\s*кармель|центр\s*кармель|carmel\s*center|מרכז\s*הכרמל|кармель/i],
    lat: 32.8018,
    lon: 34.9855,
    place_name: 'Мерказ ха-Кармель (מרכז הכרמל)',
    formatted_address: 'HaNassi Blvd 120, Haifa, Israel'
  }
];

function computeQueryHash(query: string): string {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

async function fetchJsonWithTimeout<T>(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 5000
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function queryGooglePlacesOrGeocoding(
  query: string,
  userLocation: { lat: number; lon: number },
  apiKey: string
): Promise<GeocodedDestination | null> {
  // 1. Try Google Places API Text Search with locationbias
  const placesUrl =
    `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}` +
    `&location=${userLocation.lat},${userLocation.lon}&radius=15000&key=${encodeURIComponent(apiKey)}`;

  const placesData = await fetchJsonWithTimeout<GooglePlacesTextSearchResponse>(placesUrl);
  const firstPlace = placesData?.results?.[0];
  if (
    placesData?.status === 'OK' &&
    firstPlace?.geometry?.location &&
    typeof firstPlace.geometry.location.lat === 'number'
  ) {
    return {
      lat: firstPlace.geometry.location.lat,
      lon: firstPlace.geometry.location.lng,
      place_name: firstPlace.name || query,
      formatted_address: firstPlace.formatted_address || firstPlace.name || query,
      source: 'google_places'
    };
  }

  // 2. Fallback to Google Geocoding API biased to Israel/Haifa bounds
  const geocodeUrl =
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}` +
    `&bounds=${userLocation.lat - 0.15},${userLocation.lon - 0.15}|${userLocation.lat + 0.15},${userLocation.lon + 0.15}` +
    `&region=il&key=${encodeURIComponent(apiKey)}`;

  const geoData = await fetchJsonWithTimeout<GoogleGeocodeResponse>(geocodeUrl);
  const firstGeo = geoData?.results?.[0];
  if (
    geoData?.status === 'OK' &&
    firstGeo?.geometry?.location &&
    typeof firstGeo.geometry.location.lat === 'number'
  ) {
    return {
      lat: firstGeo.geometry.location.lat,
      lon: firstGeo.geometry.location.lng,
      place_name: query,
      formatted_address: firstGeo.formatted_address || query,
      source: 'google_geocoding'
    };
  }

  return null;
}

async function queryNominatim(
  query: string,
  userLocation: { lat: number; lon: number }
): Promise<GeocodedDestination | null> {
  // 1. Search nationwide across Israel
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=il` +
    `&q=${encodeURIComponent(query)}`;

  const items = await fetchJsonWithTimeout<NominatimItem[]>(url, {
    'User-Agent': 'nextBus-Transit-App/1.0'
  });
  if (!items || items.length === 0) return null;

  // Prioritize city / administrative / mall / station / amenity over obscure residential roads
  const preferred =
    items.find((item) =>
      ['city', 'town', 'suburb', 'administrative', 'mall', 'station', 'bus_station', 'amenity'].includes(
        item.addresstype || item.type || ''
      )
    ) ?? items[0];

  const lat = Number(preferred.lat);
  const lon = Number(preferred.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

  return {
    lat,
    lon,
    place_name: preferred.name || query,
    formatted_address: preferred.display_name || query,
    source: 'osm_nominatim'
  };
}

/**
 * Strips common conversational travel prefixes in Russian, Hebrew, and English
 * (e.g. "Хочу поехать в больницу Рамбам" -> "больницу Рамбам") for clean geocoding.
 */
export function stripConversationalPrefix(rawQuery: string): string {
  return rawQuery
    .trim()
    .replace(
      /^(?:(?:я\s+хочу\s+поехать\s+(?:в|на|к)|хочу\s+поехать\s+(?:в|на|к)|поехать\s+(?:в|на|к)|как\s+(?:доехать|добраться)\s+(?:в|до|к|на)|доехать\s+(?:до|в|на)|маршрут\s+(?:в|до|на)|мне\s+нужно\s+(?:в|на|до)|take\s+me\s+to|how\s+to\s+get\s+to|i\s+want\s+to\s+go\s+to|go\s+to|directions\s+to)\s+|(?:אני\s+רוצה\s+לנסוע\s+ל|רוצה\s+לנסוע\s+ל|איך\s+מגיעים\s+ל|איך\s+נוסעים\s+ל|לנסוע\s+ל|מסלול\s+ל)\s*)/i,
      ''
    )
    .trim();
}

function stripLeadingDirectionPreposition(text: string): string {
  const trimmed = text.trim();
  const stripped = trimmed
    .replace(/^(?:в|во|до|на|к|по|to)\s+/i, '')
    .trim();
  if (/^ל(?:רחוב|מרכז)/.test(stripped)) {
    return stripped.slice(1).trim();
  }
  if (
    stripped.startsWith('ל') &&
    stripped.length > 2 &&
    !KNOWN_CITIES.some((c) => c.regex.test(stripped))
  ) {
    const withoutLamed = stripped.slice(1).trim();
    if (KNOWN_CITIES.some((c) => c.regex.test(withoutLamed) || c.cityTokenRegex.test(withoutLamed))) {
      return withoutLamed;
    }
  }
  return stripped || trimmed;
}

/**
 * Classifies free-form destination text into:
 * - "city": city-only query -> resolves to central bus station / transit hub
 * - "address": street + house number -> geocodes coordinates + snaps to nearest stop (~450-500m)
 * - "poi": facility/hospital/mall/university -> geocodes coordinates + snaps to nearest stop
 * - "street": street name only (no house number, no POI) -> picks most popular hub stop on street + alternatives
 */
export function classifyDestinationGranularity(rawQuery: string): DestinationClassification {
  const withoutConv = stripConversationalPrefix(rawQuery);
  const cleanedQuery = stripLeadingDirectionPreposition(withoutConv || rawQuery.trim());

  let detectedCity: string | undefined;
  for (const city of KNOWN_CITIES) {
    if (city.cityTokenRegex.test(cleanedQuery)) {
      detectedCity = city.canonical;
      break;
    }
  }

  // Strip country suffix & leading/trailing punctuation when testing pure city query
  const pureCityCandidate = cleanedQuery
    .replace(/(?:,\s*)?(?:израиль|israel|ישראל)$/i, '')
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
    .trim();
  const candidateWithoutParens = pureCityCandidate.replace(/\s*\([^)]*\)\s*$/, '').trim();

  for (const city of KNOWN_CITIES) {
    if (city.regex.test(pureCityCandidate) || city.regex.test(candidateWithoutParens)) {
      return {
        granularity: 'city',
        cleanedQuery: candidateWithoutParens || pureCityCandidate,
        cityName: city.canonical
      };
    }
  }

  // Check if explicit house number is present alongside non-numeric text (e.g., "Хорев 12, Хайфа", "Herzl 49")
  const hasStreetOrPlaceWord = /[a-zа-яёא-ת]{2,}/i.test(cleanedQuery);
  const houseMatch = hasStreetOrPlaceWord
    ? cleanedQuery.match(/(?:^|\s)(\d{1,4}[אa-z]?)(?:\s*,|\s+|$)/i)
    : null;
  const houseNumber = houseMatch?.[1];
  const hasExplicitPoi = POI_KEYWORD_REGEX.test(cleanedQuery);

  if (houseNumber) {
    const streetCandidate = cleanedQuery
      .replace(new RegExp(`\\b${houseNumber}\\b`, 'i'), ' ')
      .replace(/,/g, ' ')
      .replace(STREET_PREFIX_REGEX, ' ')
      .replace(/(?:חיפה|хайф[аеуы]|haifa|תל[- ]?אביב|тель[- ]?авив[аеу]?|tel[- ]?aviv|ירושלים|иерусалим[аеу]?|jerusalem|טירת\s*כרמל|тират[- ]?кармел[ьяе]?|tirat\s*carmel)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      granularity: 'address',
      cleanedQuery,
      cityName: detectedCity,
      streetName: streetCandidate || undefined,
      houseNumber
    };
  }

  if (hasExplicitPoi) {
    return {
      granularity: 'poi',
      cleanedQuery,
      cityName: detectedCity
    };
  }

  const hasStreetMarker = STREET_PREFIX_REGEX.test(cleanedQuery);
  const hasKnownStreet = KNOWN_STREET_ROOTS.test(cleanedQuery);

  if (hasStreetMarker || hasKnownStreet) {
    const streetPart = cleanedQuery
      .replace(/,/g, ' ')
      .replace(STREET_PREFIX_REGEX, ' ')
      .replace(/(?:^|\s)(?:в\s+городе|города|город|г\.|בחיפה|בתל\s*אביב|בירושלים)\s*/gi, ' ')
      .replace(/(?:חיפה|хайф[аеуы]|haifa|תל[- ]?אביב|тель[- ]?авив[аеу]?|tel[- ]?aviv|ירושלים|иерусалим[аеу]?|jerusalem|טירת\s*כרמל|тират[- ]?кармел[ьяе]?|tirat\s*carmel)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      granularity: 'street',
      cleanedQuery,
      cityName: detectedCity,
      streetName: streetPart || cleanedQuery
    };
  }

  return {
    granularity: 'poi',
    cleanedQuery,
    cityName: detectedCity
  };
}

/**
 * Resolves free-form destination text (Russian / Hebrew / English) into coordinates + GTFS stop metadata:
 * - city -> GTFS central bus station / transit hub (`findCentralStopForCity`)
 * - street -> popular stop on street + alternatives (`findPopularStopOnStreet`)
 * - address / poi -> Google Places/Geocoding -> Gazetteer -> OSM Nominatim + nearest walking-radius GTFS stop
 */
export async function resolveDestinationText(
  query: string,
  userLocation: { lat: number; lon: number }
): Promise<GeocodedDestination> {
  const classification = classifyDestinationGranularity(query);
  const trimmed = classification.cleanedQuery || query.trim();
  if (!trimmed) {
    throw new Error('Destination query cannot be empty');
  }

  const queryHash = computeQueryHash(trimmed);
  const cacheKey = `geo:cache:${queryHash}`;
  const legacyCacheKey = `geo:v2:cache:${queryHash}`;

  const cached =
    (await redisService.getJson<GeocodedDestination>(cacheKey)) ??
    (await redisService.getJson<GeocodedDestination>(legacyCacheKey));
  if (cached) {
    return { ...cached, source: 'cache' };
  }

  let resolved: GeocodedDestination | null = null;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();

  // Layer 1a: City-only -> Central Bus Station / Hub via GTFS/PostGIS (Supabase first)
  if (classification.granularity === 'city' && classification.cityName) {
    const centralStop = await supabaseService.findCentralStopForCity(classification.cityName);
    if (centralStop) {
      resolved = {
        lat: centralStop.lat,
        lon: centralStop.lon,
        place_name: centralStop.stop_name_he || centralStop.stop_name,
        formatted_address: `${centralStop.stop_name} (${classification.cityName})`,
        source: 'gtfs_db',
        destination_granularity: 'city',
        city_name: classification.cityName,
        resolved_stop: centralStop
      };
    }
  }

  // Layer 1b: Street-only -> Most popular stop on street + alternatives via GTFS/PostGIS
  if (!resolved && classification.granularity === 'street') {
    const streetStops = await supabaseService.findPopularStopOnStreet(
      classification.streetName || trimmed,
      classification.cityName,
      userLocation.lat,
      userLocation.lon
    );
    if (streetStops.length > 0) {
      const topStop = streetStops[0];
      resolved = {
        lat: topStop.lat,
        lon: topStop.lon,
        place_name: topStop.stop_name_he || topStop.stop_name,
        formatted_address: `${topStop.stop_name}${classification.cityName ? `, ${classification.cityName}` : ''}`,
        source: 'gtfs_db',
        destination_granularity: 'street',
        city_name: classification.cityName,
        street_name: classification.streetName,
        resolved_stop: topStop,
        alternative_street_stops: streetStops
      };
    }
  }

  // Layer 1c: Local Israel Gazetteer for known landmarks & cities (skipped for exact numbered addresses)
  if (!resolved && classification.granularity !== 'address') {
    const landmark = ISRAEL_GAZETTEER.find((item) =>
      item.patterns.some((pattern) => pattern.test(trimmed))
    );
    if (landmark) {
      resolved = {
        lat: landmark.lat,
        lon: landmark.lon,
        place_name: landmark.place_name,
        formatted_address: landmark.formatted_address,
        source: 'gazetteer'
      };
    }
  }

  // Layer 1d: Nationwide GTFS town/settlement lookup before external geocoders
  if (
    !resolved &&
    classification.granularity !== 'city' &&
    classification.granularity !== 'address' &&
    !POI_KEYWORD_REGEX.test(trimmed)
  ) {
    const townStop = await supabaseService.findCentralStopForCity(trimmed);
    if (townStop) {
      resolved = {
        lat: townStop.lat,
        lon: townStop.lon,
        place_name: townStop.stop_name_he || townStop.stop_name,
        formatted_address: `${townStop.stop_name} (${trimmed})`,
        source: 'gtfs_db',
        destination_granularity: 'city',
        city_name: trimmed,
        resolved_stop: townStop
      };
    }
  }

  // Layer 3 (Fallback Geocoder): Free OpenStreetMap Nominatim first, then optional GOOGLE_MAPS_API_KEY
  if (!resolved) {
    resolved = await queryNominatim(trimmed, userLocation);
  }

  if (!resolved && apiKey && !apiKey.startsWith('your-')) {
    resolved = await queryGooglePlacesOrGeocoding(trimmed, userLocation, apiKey);
  }

  if (!resolved) {
    const landmark = ISRAEL_GAZETTEER.find((item) =>
      item.patterns.some((pattern) => pattern.test(trimmed))
    );
    if (landmark) {
      resolved = {
        lat: landmark.lat,
        lon: landmark.lon,
        place_name: landmark.place_name,
        formatted_address: landmark.formatted_address,
        source: 'gazetteer'
      };
    }
  }

  if (!resolved) {
    resolved = {
      lat: userLocation.lat,
      lon: userLocation.lon,
      place_name: trimmed,
      formatted_address: `${trimmed}, Israel`,
      source: 'gazetteer'
    };
  }

  // Attach granularity & nearest physical stop in walking radius (~450-500m, expanding to 1500m) for address/POI/city
  let nearestStop: ResolvedStopOption | undefined = resolved.resolved_stop;
  if (!nearestStop) {
    let stopsNearby = await supabaseService.findNearestStopsToPoint(resolved.lat, resolved.lon, 480);
    if (stopsNearby.length === 0) {
      stopsNearby = await supabaseService.findNearestStopsToPoint(resolved.lat, resolved.lon, 1500);
    }
    if (stopsNearby.length > 0) {
      nearestStop = stopsNearby[0];
    }
  }

  const enriched: GeocodedDestination = {
    ...resolved,
    destination_granularity: resolved.destination_granularity ?? classification.granularity,
    ...(classification.cityName && !resolved.city_name ? { city_name: classification.cityName } : {}),
    ...(classification.streetName && !resolved.street_name ? { street_name: classification.streetName } : {}),
    ...(nearestStop ? { resolved_stop: nearestStop } : {})
  };

  await redisService.setJson(cacheKey, enriched, GEO_CACHE_TTL_SECONDS);
  return enriched;
}
