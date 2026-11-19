# 아차차(ACHACHA) — 구현 계획서 (IMP-PLAN)

- 버전: v1.0 / 작성일: 2026-11-19
- 작업 디렉터리: `C:\mini\achacha-android`
- GitHub: https://github.com/jyeyeyej/achacha-android
- 대상: Galaxy Z Flip4 / Android 16 (API 36)
- 상위 요구사항: [SPEC.md](SPEC.md)

> **계획 문서 자체가 완료가 아니다.** 각 단계별 구현물, 자동 테스트, 빌드, Z Flip4 기기 검증 결과를 함께 관리한다.

## 0. 사전 점검 및 의사결정 게이트

1. 기존 폴더의 파일·Git 상태 확인: **사용자가 작성한 파일을 임의 삭제·덮어쓰기 금지**.
2. Windows PowerShell, Android Studio/SDK, JDK, Gradle wrapper(프로젝트에 있으면), `adb` 설치 상태 확인.
3. 서울·경기 OpenAPI 키 발급 상태와 HTTPS 통신 가능 여부 확인. **키를 로그·커밋에 노출하지 않기**.
4. 최신 공식 Android 문서로 정확한 알람 권한, FGS 서비스 유형, 백그라운드 시작 제한과 총 실행시간 확인.
5. API 키를 안전하게 보호할 방법을 결정: 로컬 개인용 실험 vs 최소 HTTPS 중계 서버. 서울 API의 공식 문서에는 HTTP 요청 예시가 있어 **HTTPS 확인이 필수**.
6. 원격 저장소 `origin` 확인; **push는 사용자 승인 후**.

**게이트 G0:** 두 지역의 실제 API 접근/권한과 Android 서비스 실행 설계가 가능한지 간단한 실험(Spike) 결과를 기록한다. 실패 시 억지로 구현 완료로 처리하지 말고 최소 대안을 제시한다.

## 1. 추천 기술 스택

| 계층 | 기술 | 선택 이유 |
|---|---|---|
| UI | Kotlin, Jetpack Compose, Material 3 | Android 네이티브 설정·알림 경험 |
| 앱 상태 | ViewModel, Coroutines/Flow | 감시 상태 반응형 표시 |
| 통신 | OkHttp, Retrofit, XML/JSON 파서 | 지역별 응답 처리 |
| 저장 | DataStore + Room(필요한 경우) | 설정, 즐겨찾기, 이력 저장 |
| 예약 | AlarmManager, BroadcastReceiver | 날짜·요일별 시작 재예약 |
| 감시 | 짧게 실행되는 정책 적합 Foreground Service 등 | 화면이 꺼져 있을 때 조회; 서비스 유형 검증 필수 |
| 알림 | NotificationManager, NotificationChannel | 상태 알림·도착 알림 분리 |
| 테스트 | JUnit, Coroutine Test, MockWebServer, Android 기기 수동 테스트 | 정책·API·OS 동작 검증 |

개발 타깃 `compileSdk/targetSdk=36`은 SDK 설치 및 라이브러리 호환성 검토 후 적용한다. `minSdk`는 현재 시점의 호환 가능한 안정 버전으로 결정해 이유를 문서화한다.

## 2. 모듈/패키지 구조 제안

```text
app/src/main/java/.../achacha/
  ui/{home,search,arrivals,alerts,schedule,favorites,settings}/
  domain/model/
  domain/usecase/{WatchBusUseCase,AlertDecisionEngine,SchedulePolicy}/
  data/{BusRepository,SeoulBusDataSource,GyeonggiBusDataSource,FakeBusDataSource}/
  data/local/{ProfileStore,AlertHistoryStore}/
  monitoring/{MonitoringCoordinator,BusWatchService}/
  scheduling/{AlarmScheduler,ScheduleReceiver,BootReceiver}/
  notification/{ArrivalNotifier,NotificationActionReceiver}/
  permissions/
app/src/test/...
docs/
```

- UI에서 직접 API를 호출하거나 Notification을 만들지 않는다.
- 서울과 경기 제공기관별 파싱 후 **공통 `ArrivalSnapshot`**으로 정규화한다.
- 순수 Kotlin `AlertDecisionEngine`은 Android 종속성을 최소화하고 단위 테스트한다.
- 로컬 DB에 프로필·예약 및 **차량별 발송 이력**을 저장, 앱 프로세스 종료 후 복원 정책 수립.
- 1차 MVP는 동시 감시 1개, 예약 프로필 여러 개.

## 3. 감시 상태 기계

```text
IDLE --(즉시 시작)--> STARTING --> MONITORING --> STOPPED
  |                         |            |--> ERROR / PERMISSION_REQUIRED
  +--(예약 저장)--> SCHEDULED --(예약 시각)--> STARTING
MONITORING --(종료시각 / 중지)--> STOPPING --> STOPPED
MONITORING --(권한 회수/OS 중지)--> DEGRADED (상태 안내·정리)
```

- 서비스를 무조건 무한 반복시키지 않는다.
- 시작·종료·에러가 모든 경로에서 UI 및 상태 알림에 반영되도록 한다.
- 앱을 강제 중지(force stop)한 이후 자동 복귀를 보장한다고 주장하지 않는다.
- 기기 재부팅 시 **예약만 복원**, `BOOT_COMPLETED`에서 `dataSync` FGS를 직접 실행하지 않는다(Android 15+ 제한 확인).

## 4. Android 알림 구현 설계 검증

**즉시 시작:** 앱이 전경일 때 사용자 명시 동작으로 감시 세션 시작 → 적합한 포그라운드 서비스 유형/권한으로 상시 상태 알림 → API 조회.

**예약 시작:** AlarmManager 단발 예약 → 정확한 알람 권한이 필요하다면 `SCHEDULE_EXACT_ALARM` + `canScheduleExactAlarms()` 검증 및 권한 안내 → 실제 시작 예외조건 확인 → 제한 시 실패 상태 표시와 사용자 실행 경로 제공. **`USE_EXACT_ALARM` 자동 허가를 제한된 사용 사례 검증 없이 사용하지 않는다.**

**요일 반복:** 반복 AlarmManager 자체는 정확하지 않으므로 다음 허용 날짜에 대한 **단발 예약을 재등록**한다. 날짜 경계, DST/시간대, 중복 예약 처리.

**실시간 감시:** 주기 API 조회(초기 60초 실험값), 실패 시 제한된 백오프. FGS가 적합하지 않거나 시간 제한에 걸리면 대안 설계. `dataSync`는 Android 15+에서 24시간 누적 6시간 제한, 정확한 시작이 완전히 보장되지는 않음.

**도착 알림:** API 응답값으로 `AlertDecisionEngine`이 발송 여부 판단 → 알림 채널(감시 상태/버스 도착) 구분 → '중지'와 '오늘만 종료' 액션 → 알림 이력 기록.

**중복 방지:** 임계값 알림과 반복 알림이 같은 조회주기에 겹치면 하나로 합친다. 이동/ETA 변경은 차량 식별을 기준으로 평가한다.

**절전:** 삼성 기기에서 알림 권한, 정확한 알람 접근, 배터리 최적화 영향 확인. 절전 예외는 기본 요구로 강제하지 않고 필요한 상황에 사용자 안내.

## 5. 단계별 구현 순서

### P0. 개발 환경과 API 검증 (최우선)
- [ ] Git 상태 및 폴더 파일 확인; `gradlew`, `settings.gradle.kts` 존재 여부 확인.
- [ ] Android Studio/SDK 36, JDK 설치 및 버전 확인.
- [ ] 서울 정류장·노선 실 조회, 두 차량 필드·HTTPS 지원·인증 방식 확인.
- [ ] 경기 정류장·노선 실 조회, 두 차량 필드·인증 방식 확인.
- [ ] 호출 한도, 과금/키 제한, 검색 엔드포인트 문서 기록.
- [ ] Android 16 예약→서비스 시작의 **작은 스파이크 테스트** 작성/실행.

**완료 게이트 G0:** `docs/API-INTEGRATION.md` 검증 표에 확인 사실을 기입하고, 시작/감시 기술 위험을 명시.

### P1. 앱 초기화 및 도메인 계층
- [ ] Compose 프로젝트, 라우팅, Material 3 테마, 권한 화면.
- [ ] 공통 모델과 `BusRepository` 인터페이스 정의.
- [ ] `FakeBusDataSource` fixture 및 모의 모드 명확히 표시.
- [ ] API 키/환경설정 `.gitignore`, 제공기관별 어댑터 구현.
- [ ] 정상/누락/오류/시간 역전의 파서 테스트.

**완료 게이트 G1:** 로컬 빌드 및 기본 단위 테스트 통과, 제공기관별 파싱 결과 공통 모델 통일.

### P2. 실시간 조회·검색 화면
- [ ] 서울·경기 정류장/노선 검색(방향·순번 포함).
- [ ] 실시간 이번 버스 / 다음 버스 표시, 정보 없음 구별.
- [ ] 마지막 조회 시각과 제공기관 표시.
- [ ] 새로고침, 오류 재시도, 로딩 상태.

**완료 게이트 G2:** 서울/경기 각각 실제 제공되는 노선으로 두 대 값을 확인(둘째 없을 때에도 정상 설명).

### P3. 알림 판단 엔진·즉시 감시
- [ ] 1~120분 정수 자유 입력, 복수 알림 임계값 저장/검증.
- [ ] `AlertDecisionEngine` 상태와 알림 이력 설계.
- [ ] 임계값 통과, 초기 진입, 반복 1/3/5, 중복 제거.
- [ ] 첫째→둘째 승격/차량 식별 변경 처리.
- [ ] 즉시 감시·수동 중지, 상태 알림/도착 알림 채널.
- [ ] 권한 요청 및 잠금화면·화면 꺼짐 확인.

**완료 게이트 G3:** 실시간/모의 데이터로 '6분/10분', '6분/20분' 알림을 두 버스 모두 포함해 발송, 같은 차량 중복 발송 없음.

### P4. 예약·반복·즐겨찾기
- [ ] 단일 날짜 예약, 사용자 정의 시작/종료.
- [ ] 요일별 반복 단발 재예약, 변경/일시중지/삭제.
- [ ] BootReceiver 예약 복원(실행 시점은 예약 시각에 따름).
- [ ] 즐겨찾기 집·회사·본가 등 임의 이름으로 저장.
- [ ] '오늘만 종료', 동시 세션 충돌 안내, 예약 상태 표시.

**완료 게이트 G4:** 예약된 시간에 실행이 가능한 권한 상태에서 정상 시작/종료, 예외상황 안내.

### P5. 안정화·실기기 검증·APK
- [ ] 단위/통합/UI 테스트 및 MockWebServer 응답 변형 테스트.
- [ ] Z Flip4 Android 16 실기기에서 잠금·절전·재부팅·권한 거부 테스트.
- [ ] API 호출량과 배터리 사용량 측정/기록.
- [ ] Gradle 빌드 `assembleDebug`, 가능 시 `connectedDebugAndroidTest`.
- [ ] APK 경로와 설치 방법, 실제/모의 API 모드 전환 안내.
- [ ] 문서와 실제 구현 차이 업데이트.

**완료 게이트 G5:** 성공/실패/미검증 결과를 각각 기록하고 실제 설치 가능한 Debug APK 경로 확인.

## 6. 예상 위험과 대응

| 위험 | 영향 | 우선 대응 |
|---|---|---|
| 서울 공식 예시 HTTP | 통신 보안·Android cleartext 제한 | 공식 HTTPS 지원 검증, 불가 시 HTTPS 중계 검토 |
| API 서비스키 노출 | 오용 가능성 | 앱 직접 포함 한계 공개, 필요 시 서버로 이동 |
| 예약 시작 제한 | 알림 감시 시작 실패 | 정밀 알람 권한/FGS 예외 점검, 실패 상태 알림/수동 재시작 |
| 포그라운드 서비스 시간 제한 | 장시간 감시 중지 | 종료시각·감시 시간 상한·`onTimeout` 처리 |
| API 불규칙한 ETA·차량 ID 누락 | 거짓 알림/중복 | 보수적 dedupe, 이력·상태 모델 |
| API 호출 초과 | 차단·실시간성 저하 | 호출 예산 산정, 캐시/재시도 백오프 |
| 삼성 절전 처리 | 잠금/절전 중 지연 | 실제 Z Flip4 테스트·설정 안내 |

## 7. 작업 원칙과 산출물

- [ ] 각 단계가 끝나면 **수정 파일, 기능 구현 여부, 실행한 테스트 결과**를 확인한다.
- [ ] 코드가 없는 설계만으로 완료라고 하지 않는다.
- [ ] 키·비밀번호·위치정보를 GitHub에 커밋하지 않는다.
- [ ] 코드 변경 전 사용자 기존 상태를 확인하고 보존한다.
- [ ] GitHub `push`는 사용자 승인 이후 수행한다.
- [ ] 실제 실기기에서 확인하지 못한 부분은 '코드 구현 / 실기기 미검증'으로 표기한다.
- [ ] 향후 기능(환승/지하철/AI)은 구현 범위에 포함하지 않는다.

### PowerShell 예시 (환경이 준비된 경우)

```powershell
Set-Location 'C:\mini\achacha-android'
git status --short
git remote -v
.\gradlew.bat testDebugUnitTest
.\gradlew.bat assembleDebug
```

새 프로젝트에서는 먼저 Gradle Wrapper와 Android SDK가 정상 준비돼 있어야 한다. 명령을 실행하지 않았다면 실행 성공으로 보고하지 않는다.

---
참고: [SPEC.md](SPEC.md) · [API-INTEGRATION.md](docs/API-INTEGRATION.md) · [TEST-PLAN.md](docs/TEST-PLAN.md)
