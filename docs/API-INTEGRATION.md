# 아차차(ACHACHA) — 서울·경기 버스 API 연동 설계

- 버전: v1.0 / 작성일: 2026-11-19
- 문서 상태: **공식 공개문서로 구조 일부 확인 / 실제 API 키 호출·실데이터 검증 전**
- 연결 요구사항: [SPEC.md](../SPEC.md)의 FR-01~04, FR-07, FR-10, FR-17

## 1. 원칙

1. **서울/경기는 서로 다른 API**이므로 직접 응답 구조를 UI에 노출하지 않는다.
2. 정류장 이름이나 버스 번호만으로 조회하지 않는다. **제공기관·정류장ID·노선ID·운행방향·정류장순번**을 연결한다.
3. **이번/다음 버스의 도착예정시간은 각각 현재 시점 기준**이다. `nextEta - firstEta`는 두 버스 간격을 구할 때만 쓴다.
4. 숫자가 없는 상황(운행 중 버스 없음, 만료, 서버 오류)을 '0분'으로 처리하지 않는다.
5. 인증키, 실제 요청 로그의 키, 사용자 위치값을 저장소에 포함하지 않는다.
6. 실시간 API 사용정책·출처표시·갱신주기·쿼터는 발급 후 실제 확인한다.

## 2. 서울특별시 (공식 자료 확인)

- 서울 열린데이터광장: https://data.seoul.go.kr/dataList/OA-15346/F/1/datasetView.do
- 추가 안내/활용가이드: https://data.seoul.go.kr/dataList/OA-1091/L/1/datasetView.do
- 공식 페이지의 요청 베이스 URL 예시: `http://ws.bus.go.kr/api/rest/arrive`
- 공식 페이지의 정류장·노선별 예시:

```text
http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRoute?stId={STOP_ID}&busRouteId={ROUTE_ID}&ord={STOP_ORDER}
```

- 필요한 인증키 파라미터와 인코딩 방식은 최신 활용가이드 및 실제 발급 환경에서 확인해 추가한다(임의 확정 금지).
- 확인 대상 응답 필드 후보: `arrmsg1`, `arrmsg2`, `traTime1`, `traTime2`, `vehId1`, `vehId2`, `stId`, `busRouteId`, `staOrd` 등. **정확한 필드 타입/단위/누락 규칙은 공식 다운로드 가이드와 실제 샘플로 검증 필요.**
- **중요:** 공식 예시가 HTTP이다. HTTPS 가능한 실제 호스트/경로가 검증되기 전까지 앱에서 임의로 HTTP 평문 통신 허용을 일반 해결책으로 사용하지 않는다. 필요하면 TLS를 제공하는 경량 중계 서버를 설계한다.

### 서울 API 연동 준비 체크
- [ ] 정류장 검색 API 엔드포인트/인증/응답 확인.
- [ ] 노선 검색 및 방향/정류장순번 매핑 확인.
- [ ] 실 노선에서 첫째/둘째 도착값과 차량 ID 확인.
- [ ] 단위(분/초/텍스트), '곧 도착' 문구, 운행 종료 응답 확인.
- [ ] HTTPS 지원 여부 실측 및 네트워크 보안 설계 확정.
- [ ] 쿼터·이용조건/재배포 조건 확인.

## 3. 경기도 GBIS (공식 자료 확인)

- 서비스 안내: https://www.gbis.go.kr/gbis2014/publicService.action?cmd=openApiInfo
- 버스 도착 항목조회 매뉴얼: https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBusArrival
- 실호출 테스트 화면: https://www.gbis.go.kr/gbis2014/publicService.action?cmd=tBusArrival
- 공공데이터포털: https://www.data.go.kr/data/15080346/openapi.do
- 공식 안내의 HTTPS 요청 예시:

```text
https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalItemv2?format=json&serviceKey={KEY}&stationId={STOP_ID}&routeId={ROUTE_ID}&staOrder={STOP_ORDER}
```

| 필드 | 공식 의미 | 앱 적용 |
|---|---|---|
| `stationId` | 정류소 ID | `StopRef.stopId` |
| `routeId` | 노선 ID | `RouteRef.routeId` |
| `staOrder` | 요청 정류소의 노선상 순번 | 방향 중복 방지. **필수** |
| `predictTime1`, `predictTime2` | 첫째·둘째 차량 예측 **분** | ETA 표시/판정 입력 |
| `predictTimeSec1`, `predictTimeSec2` | 첫째·둘째 차량 예측 **초** | 제공 시 세밀한 임계값 판정 |
| `vehId1`, `vehId2` | 첫째·둘째 차량 식별값 | 동일 차량 중복 발송 방지 |
| `locationNo1`, `locationNo2` | 정류소 몇 개 전 | 부가 표시 후보 |
| `queryTime` | 서버 정보 요청시각 | 기준 시각 후보(파싱 검증 필요) |
| `resultCode`, `resultMessage` | API 처리 결과 | 오류 분류 |

- 경기도 매뉴얼은 동일 정류장에 상·하행이 모두 정차할 수 있어 `staOrder`가 필요하다고 명시한다.
- 응답 전체 JSON/XML의 중첩 구조 및 null·문자열 표기는 **실호출 후 샘플로 확정**한다.

### 경기 API 연동 준비 체크
- [ ] 공공데이터포털 인증키 발급 및 API 사용 승인 여부 확인.
- [ ] 정류소명/번호 검색·노선번호 검색·경유순번 조회 API 검증.
- [ ] 특정 경기 정류장·노선으로 첫째·둘째·차량 ID 값 실측.
- [ ] 인증 실패/운행 종료/정보 없음/두 번째 차량 없음 응답 수집.
- [ ] 일일 트래픽·요청 속도·이용조건 확인.

## 4. 공통 계약 (앱 내부 모델, **실제 API 응답 예시가 아님**)

```json
{
  "provider": "GYEONGGI",
  "stop": {"providerStopId": "200000177", "name": "예시 정류장"},
  "route": {"providerRouteId": "200000037", "number": "예시 노선", "direction": "예시 방향", "stopOrder": 19},
  "first": {"vehicleId": "vehicle-A", "etaSeconds": 360},
  "second": {"vehicleId": "vehicle-B", "etaSeconds": 1200},
  "fetchedAt": "2026-11-19T07:54:00+09:00",
  "providerObservedAt": null,
  "status": "AVAILABLE"
}
```

- 위 JSON은 테스트용 **앱 도메인 계약 샘플**이며, 업체가 그 모양으로 응답한다고 주장하지 않는다.
- 두 ETA가 있을 때 간격 계산: `(second.etaSeconds - first.etaSeconds) / 60`을 적절히 반올림하여 표시.
- `etaSeconds <= 0`, 결측/비정상 수치, 두 ETA 역전, 차량 ID 부재는 각각 별도 검증.
- 공급자에 분 단위만 있는 경우 `etaSeconds=minutes*60`으로 정규화하되 초 단위 정밀도를 가진 척하지 않는다.
- 화면의 남은 분은 반올림 정책을 통일하고, 알림 임계값은 원본 해상도에서 비교한다. '실제 도착 보장' 표현 금지.

## 5. 데이터 상태·오류 모델

| 상태 | 의미 | 표시·동작 |
|---|---|---|
| `AVAILABLE` | 현재 응답에 예측 데이터 있음 | 이번/다음 표시(없으면 null) |
| `PARTIAL` | 첫째만 제공 등 일부 누락 | 둘째 '정보 없음' 표시 |
| `NO_SERVICE` | 운행 없음 또는 조회 결과 없음 | 임의 시간 생성 금지 |
| `STALE` | 정해진 신선도 기준 초과 | 경고, 신규 버스 도착 알림 보류 |
| `RATE_LIMITED` | 호출 제한 | 백오프, 사용자에게 제한 안내 |
| `AUTH_ERROR` | 키/이용승인 문제 | 개발 설정 안내, 안전한 로그 |
| `NETWORK_ERROR` | 네트워크 실패 | 제한 재시도, 오래된 데이터 구분 |
| `PARSE_ERROR` | 스키마 불일치 | 오류 보고, 모델/필드 실측 필요 |

- 제공기관 시각을 검증하지 못하면 '마지막 앱 조회 시각'이라고 정확히 표시한다.
- 동일 차량 판단 기준이 약하면 '확인 불가'를 우선하고 중복 알림을 보수적으로 억제한다.
- 네트워크 오류 시 마지막 값을 **참고값**으로 볼 수는 있으나 **새 실시간 알림의 근거로 사용하지 않는다**.

## 6. 네트워크·보안·API 호출량

- 실시간 조회 초기 실험값: **감시 세션당 약 60초 간격**. 이는 공식 최소 권장주기라고 확정한 값이 아님.
- 예시 호출량: 40분 감시 1회 × 60초 간격이면 약 40회 + 초기/재시도 호출; 2회면 약 80회 이상. 각 API 인증키별 한도 확인 후 실제 조회 간격을 결정.
- 검색 시 연속 타이핑 호출은 debounce, 일정한 쿼리 결과는 캐시, 네트워크 오류는 exponential backoff.
- `serviceKey`가 들어간 URL을 콘솔·에러 리포트·GitHub 이슈/스크린샷에 남기지 않는다.
- HTTPS 직접 호출이 불가능하거나 공개 API 키를 보호해야 한다면 **소형 HTTPS 프록시**를 별도 설계. 서버가 필요한 경우 최소 기능, 운영비, 비밀관리, 이용약관 적합성을 문서화.
- 사용자 위치는 주변 정류장 검색을 위해 동의한 경우에만 사용; 경로 이동 이력을 서버에 적재하지 않는다.

## 7. 제공기관 라우팅

```text
정류장/노선 검색 -> provider 식별 + 제공기관별 외부ID 확보
            -> 서울(SeoulBusDataSource) 또는 경기(GyeonggiBusDataSource)
            -> 응답 검증/정규화 -> ArrivalSnapshot
            -> UI 표시 및 AlertDecisionEngine
```

- 경기도 노선이 서울 정류장에 도착하거나 반대의 경우에도 **어떤 제공기관·ID 조합이 실제 지원되는지 실데이터로 판단**한다. 지역 명칭만 보고 무조건 한 API로 보내지 않는다.
- 중복 검색 결과는 정류장 고유번호/방향/노선 소속을 보여 사용자가 선택하게 한다.
- 실제 연계 가능 범위를 확인하기 전에는 '서울·경기 전 노선 100% 제공'을 보장하지 않는다.

## 8. 검증 결과 기입란 (Codex가 실측 후 갱신)

| 항목 | 검증 날짜 | 실제 결과 | 상태 |
|---|---|---|---|
| 서울 실 API 키 발급 | - | 미실행 | 미검증 |
| 서울 1차/2차 도착 필드 | - | 미실행 | 미검증 |
| 서울 HTTPS 사용 가능 여부 | - | 미실행 | 미검증 |
| 경기 실 API 키 발급 | - | 미실행 | 미검증 |
| 경기 1차/2차 도착 필드 | - | 미실행 | 미검증 |
| 서울·경기 검색/방향 조회 | - | 미실행 | 미검증 |
| 두 제공기관 API 호출 한도 | - | 미실행 | 미검증 |

---
## 공식 근거 (2026-11-19 기준 열람)
- 서울 정류소 노선별 도착예정 목록정보: https://data.seoul.go.kr/dataList/OA-15346/F/1/datasetView.do
- 서울 버스도착정보조회 서비스 활용가이드 안내: https://data.seoul.go.kr/dataList/OA-1091/L/1/datasetView.do
- 경기 GBIS 버스도착정보 항목조회 매뉴얼: https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBusArrival
- 경기 GBIS API 소개: https://www.gbis.go.kr/gbis2014/publicService.action?cmd=openApiInfo
- 공공데이터포털 경기도 버스도착정보: https://www.data.go.kr/data/15080346/openapi.do
