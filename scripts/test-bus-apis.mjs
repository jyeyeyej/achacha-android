import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const envPath = path.join(projectRoot, ".env");

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error("프로젝트 루트에 .env 파일이 없습니다. .env.example을 복사해 인증키를 입력하세요.");
  }

  const values = {};
  const lines = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

let fileEnv;
try {
  fileEnv = loadDotEnv(envPath);
} catch (error) {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const rawServiceKey = fileEnv.DATA_GO_KR_SERVICE_KEY?.trim();
if (!rawServiceKey) {
  console.error("[FAIL] .env의 DATA_GO_KR_SERVICE_KEY 값이 비어 있습니다.");
  process.exit(1);
}

function normalizeServiceKey(value) {
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const serviceKey = normalizeServiceKey(rawServiceKey);
const encodedRawKey = encodeURIComponent(rawServiceKey);
const encodedNormalizedKey = encodeURIComponent(serviceKey);

function redact(value) {
  let result = String(value ?? "");
  for (const secret of [rawServiceKey, serviceKey, encodedRawKey, encodedNormalizedKey]) {
    if (secret) result = result.split(secret).join("[REDACTED]");
  }
  result = result.replace(/([?&](?:serviceKey|ServiceKey)=)[^&\s]+/gi, "$1[REDACTED]");
  return result;
}

function xmlDecode(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tagValue(xml, tag) {
  const match = String(xml).match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? xmlDecode(match[1]).trim() : undefined;
}

function xmlItems(xml, itemTag) {
  const matches = String(xml).matchAll(new RegExp(`<${itemTag}>([\\s\\S]*?)</${itemTag}>`, "gi"));
  return [...matches].map((match) => match[1]);
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function requestText(label, baseUrl, params) {
  const url = new URL(baseUrl);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json, application/xml, text/xml;q=0.9" },
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${label}: HTTP ${response.status}`);
    }
    return { text, status: response.status, elapsedMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timeout);
  }
}

function assertSeoulSuccess(label, xml) {
  const code = tagValue(xml, "headerCd");
  const message = tagValue(xml, "headerMsg");
  if (code !== "0") throw new Error(`${label}: 응답 코드 ${code ?? "없음"}, ${message ?? "메시지 없음"}`);
  return { code, message };
}

function parseGyeonggiResponse(label, text, listName) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const json = JSON.parse(trimmed);
    const response = json.response ?? json;
    const header = response.msgHeader ?? response.header ?? {};
    const body = response.msgBody ?? response.body ?? {};
    const code = Number(header.resultCode ?? header.resultcode);
    if (code !== 0) {
      throw new Error(`${label}: 응답 코드 ${header.resultCode ?? "없음"}, ${header.resultMessage ?? "메시지 없음"}`);
    }
    const rawItems = body[listName] ?? [];
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
    return { code, message: header.resultMessage, queryTime: header.queryTime, items };
  }

  const code = Number(tagValue(trimmed, "resultCode"));
  const message = tagValue(trimmed, "resultMessage");
  if (code !== 0) throw new Error(`${label}: 응답 코드 ${Number.isNaN(code) ? "없음" : code}, ${message ?? "메시지 없음"}`);
  const items = xmlItems(trimmed, listName).map((item) => ({
    stationId: tagValue(item, "stationId"),
    stationName: tagValue(item, "stationName"),
    mobileNo: tagValue(item, "mobileNo"),
    regionName: tagValue(item, "regionName"),
    routeId: tagValue(item, "routeId"),
    routeName: tagValue(item, "routeName"),
    staOrder: tagValue(item, "staOrder"),
    flag: tagValue(item, "flag"),
    predictTime1: tagValue(item, "predictTime1"),
    predictTime2: tagValue(item, "predictTime2"),
    predictTimeSec1: tagValue(item, "predictTimeSec1"),
    predictTimeSec2: tagValue(item, "predictTimeSec2"),
    vehId1: tagValue(item, "vehId1"),
    vehId2: tagValue(item, "vehId2"),
  }));
  return { code, message, queryTime: tagValue(trimmed, "queryTime"), items };
}

function hasUsefulText(value) {
  const text = String(value ?? "").trim();
  return Boolean(text) && !/(정보없음|운행종료|출발대기|없음)/.test(text);
}

async function testSeoul() {
  const stationQuery = fileEnv.SEOUL_TEST_STATION_QUERY?.trim() || "서울역버스환승센터";
  const stationResult = await requestText(
    "서울 정류장 검색",
    "https://ws.bus.go.kr/api/rest/stationinfo/getStationByName",
    { serviceKey, stSrch: stationQuery },
  );
  assertSeoulSuccess("서울 정류장 검색", stationResult.text);

  const stations = xmlItems(stationResult.text, "itemList").map((item) => ({
    stationId: tagValue(item, "stId"),
    arsId: tagValue(item, "arsId"),
    name: tagValue(item, "stNm"),
  })).filter((station) => station.stationId && station.arsId);
  if (stations.length === 0) throw new Error("서울 정류장 검색: 검색 결과가 없습니다.");

  let arrivalVerification;
  let routeLookupCalls = 0;
  let arrivalCalls = 0;

  for (const station of stations.slice(0, 5)) {
    const routeResult = await requestText(
      "서울 정류장 경유노선 조회",
      "https://ws.bus.go.kr/api/rest/stationinfo/getRouteByStation",
      { serviceKey, arsId: station.arsId },
    );
    routeLookupCalls += 1;
    assertSeoulSuccess("서울 정류장 경유노선 조회", routeResult.text);

    const routes = xmlItems(routeResult.text, "itemList").map((item) => ({
      routeId: tagValue(item, "busRouteId"),
      routeName: tagValue(item, "busRouteNm"),
      order: tagValue(item, "seq") ?? tagValue(item, "staOrd"),
    })).filter((route) => route.routeId && route.order);

    for (const route of routes.slice(0, 12)) {
      const arrivalResult = await requestText(
        "서울 버스 도착정보",
        "https://ws.bus.go.kr/api/rest/arrive/getArrInfoByRoute",
        {
          serviceKey,
          stId: station.stationId,
          busRouteId: route.routeId,
          ord: route.order,
        },
      );
      arrivalCalls += 1;
      assertSeoulSuccess("서울 버스 도착정보", arrivalResult.text);
      const item = xmlItems(arrivalResult.text, "itemList")[0];
      if (!item) continue;

      const candidate = {
        status: arrivalResult.status,
        elapsedMs: arrivalResult.elapsedMs,
        stationName: station.name,
        arsId: station.arsId,
        routeName: tagValue(item, "rtNm") ?? route.routeName,
        firstMessage: tagValue(item, "arrmsg1"),
        secondMessage: tagValue(item, "arrmsg2"),
        firstEtaSeconds: toNumber(tagValue(item, "traTime1")),
        secondEtaSeconds: toNumber(tagValue(item, "traTime2")),
        firstVehicleId: tagValue(item, "vehId1"),
        secondVehicleId: tagValue(item, "vehId2"),
      };

      if (!arrivalVerification) arrivalVerification = candidate;
      if (
        (candidate.firstEtaSeconds ?? 0) > 0 &&
        ((candidate.secondEtaSeconds ?? 0) > 0 || hasUsefulText(candidate.secondMessage))
      ) {
        arrivalVerification = candidate;
        break;
      }
    }
    if (arrivalVerification?.secondEtaSeconds > 0 || hasUsefulText(arrivalVerification?.secondMessage)) break;
  }

  if (!arrivalVerification) throw new Error("서울 버스 도착정보: 정상 응답에 도착 항목이 없습니다.");

  return {
    stationSearch: {
      authenticated: true,
      status: stationResult.status,
      elapsedMs: stationResult.elapsedMs,
      query: stationQuery,
      resultCount: stations.length,
      sample: stations[0],
    },
    arrival: {
      authenticated: true,
      routeLookupCalls,
      arrivalCalls,
      ...arrivalVerification,
      firstProvided: (arrivalVerification.firstEtaSeconds ?? 0) > 0 || hasUsefulText(arrivalVerification.firstMessage),
      secondProvided: (arrivalVerification.secondEtaSeconds ?? 0) > 0 || hasUsefulText(arrivalVerification.secondMessage),
    },
  };
}

async function testGyeonggi() {
  const stationQuery = fileEnv.GYEONGGI_TEST_STATION_QUERY?.trim() || "수원역";
  const stationResult = await requestText(
    "경기 정류장 검색",
    "https://apis.data.go.kr/6410000/busstationservice/v2/getBusStationListv2",
    { serviceKey, keyword: stationQuery, format: "json" },
  );
  const stationParsed = parseGyeonggiResponse("경기 정류장 검색", stationResult.text, "busStationList");
  const stations = stationParsed.items.filter((station) => station.stationId);
  if (stations.length === 0) throw new Error("경기 정류장 검색: 검색 결과가 없습니다.");

  let arrivalVerification;
  let arrivalCalls = 0;
  for (const station of stations.slice(0, 10)) {
    const arrivalResult = await requestText(
      "경기 버스 도착정보",
      "https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2",
      { serviceKey, stationId: station.stationId, format: "json" },
    );
    arrivalCalls += 1;
    const arrivalParsed = parseGyeonggiResponse("경기 버스 도착정보", arrivalResult.text, "busArrivalList");
    for (const item of arrivalParsed.items) {
      const candidate = {
        status: arrivalResult.status,
        elapsedMs: arrivalResult.elapsedMs,
        queryTime: arrivalParsed.queryTime,
        stationName: station.stationName,
        stationId: station.stationId,
        mobileNo: station.mobileNo,
        routeName: item.routeName,
        routeId: item.routeId,
        firstEtaSeconds: toNumber(item.predictTimeSec1) ?? (toNumber(item.predictTime1) ?? 0) * 60,
        secondEtaSeconds: toNumber(item.predictTimeSec2) ?? (toNumber(item.predictTime2) ?? 0) * 60,
        firstVehicleId: item.vehId1 ? String(item.vehId1) : undefined,
        secondVehicleId: item.vehId2 ? String(item.vehId2) : undefined,
        state: item.flag,
      };
      if (!arrivalVerification) arrivalVerification = candidate;
      if ((candidate.firstEtaSeconds ?? 0) > 0 && (candidate.secondEtaSeconds ?? 0) > 0) {
        arrivalVerification = candidate;
        break;
      }
    }
    if ((arrivalVerification?.firstEtaSeconds ?? 0) > 0 && (arrivalVerification?.secondEtaSeconds ?? 0) > 0) break;
  }

  if (!arrivalVerification) throw new Error("경기 버스 도착정보: 정상 응답에 도착 항목이 없습니다.");

  return {
    stationSearch: {
      authenticated: true,
      status: stationResult.status,
      elapsedMs: stationResult.elapsedMs,
      query: stationQuery,
      resultCount: stations.length,
      sample: {
        stationName: stations[0].stationName,
        stationId: stations[0].stationId,
        mobileNo: stations[0].mobileNo,
        regionName: stations[0].regionName,
      },
    },
    arrival: {
      authenticated: true,
      arrivalCalls,
      ...arrivalVerification,
      firstProvided: (arrivalVerification.firstEtaSeconds ?? 0) > 0,
      secondProvided: (arrivalVerification.secondEtaSeconds ?? 0) > 0,
    },
  };
}

function etaText(seconds, fallbackMessage) {
  if (Number.isFinite(seconds) && seconds > 0) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes}분 ${remainder}초`;
  }
  return fallbackMessage || "제공되지 않음";
}

function printResults(results) {
  console.log("아차차 버스 API 실제 연결 검증");
  console.log(`검증시각: ${results.checkedAt}`);
  console.log("인증키: .env의 DATA_GO_KR_SERVICE_KEY 사용 (값 비공개)");
  console.log("");

  const { seoul, gyeonggi } = results;
  console.log(`[PASS] 서울 정류장 검색: HTTP ${seoul.stationSearch.status}, ${seoul.stationSearch.resultCount}건, ${seoul.stationSearch.elapsedMs}ms`);
  console.log(`       표본: ${seoul.stationSearch.sample.name} (ARS ${seoul.stationSearch.sample.arsId})`);
  console.log(`[PASS] 서울 버스 도착정보: HTTP ${seoul.arrival.status}, ${seoul.arrival.elapsedMs}ms`);
  console.log(`       ${seoul.arrival.stationName} / ${seoul.arrival.routeName}`);
  console.log(`       이번 버스: ${etaText(seoul.arrival.firstEtaSeconds, seoul.arrival.firstMessage)}`);
  console.log(`       다음 버스: ${etaText(seoul.arrival.secondEtaSeconds, seoul.arrival.secondMessage)}`);
  console.log("");
  console.log(`[PASS] 경기 정류장 검색: HTTP ${gyeonggi.stationSearch.status}, ${gyeonggi.stationSearch.resultCount}건, ${gyeonggi.stationSearch.elapsedMs}ms`);
  console.log(`       표본: ${gyeonggi.stationSearch.sample.stationName} (${gyeonggi.stationSearch.sample.regionName ?? "지역정보 없음"})`);
  console.log(`[PASS] 경기 버스 도착정보: HTTP ${gyeonggi.arrival.status}, ${gyeonggi.arrival.elapsedMs}ms`);
  console.log(`       ${gyeonggi.arrival.stationName} / ${gyeonggi.arrival.routeName}`);
  console.log(`       이번 버스: ${etaText(gyeonggi.arrival.firstEtaSeconds)}`);
  console.log(`       다음 버스: ${etaText(gyeonggi.arrival.secondEtaSeconds)}`);
  console.log("");
  console.log("인증 검증: 4/4 API 성공");
  console.log(`두 대 도착정보: 서울=${seoul.arrival.firstProvided && seoul.arrival.secondProvided ? "확인" : "일부만 제공"}, 경기=${gyeonggi.arrival.firstProvided && gyeonggi.arrival.secondProvided ? "확인" : "일부만 제공"}`);
}

async function main() {
  const checkedAt = new Date().toISOString();
  const seoul = await testSeoul();
  const gyeonggi = await testGyeonggi();
  const results = { checkedAt, seoul, gyeonggi };
  printResults(results);
}

main().catch((error) => {
  const safeMessage = redact(error instanceof Error ? error.message : error);
  console.error(`[FAIL] ${safeMessage}`);
  process.exitCode = 1;
});

