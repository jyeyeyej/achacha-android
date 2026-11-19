# 아차차 Android 디렉터리 구조

> 상태: 구조만 생성됨. Kotlin 소스와 Android/Gradle 프로젝트 파일은 아직 구현되지 않았다.

## 설계 원칙

- Gradle 모듈은 초기 MVP에서 `app` 하나만 사용한다.
- 화면 코드는 `feature`, 순수 업무 규칙은 `domain`, 외부 데이터 구현은 `data`에 둔다.
- Android 운영체제에 의존하는 서비스·알람·알림·권한은 `platform`에 둔다.
- `domain`은 Retrofit, Room, Android SDK에 의존하지 않는다.
- Repository 인터페이스는 `domain/repository`, 구현체는 `data`에 둔다.
- 서울·경기 구현은 공통 `BusDataSource` 및 `BusRepository` 뒤에서 교체할 수 있게 한다.
- 공용 Compose 요소만 `ui`에 두고 화면·ViewModel·UiState는 해당 `feature`에 둔다.

## 주요 구조

```text
app/src/main/java/com/jyeyeyej/achacha/
├── feature/
│   ├── home/
│   ├── search/
│   ├── watch/
│   ├── schedule/
│   ├── favorites/
│   └── settings/
├── domain/
│   ├── model/
│   ├── repository/
│   ├── policy/
│   └── usecase/
├── data/
│   ├── bus/
│   │   ├── common/
│   │   ├── seoul/
│   │   └── gyeonggi/
│   └── local/
│       ├── database/dao/
│       ├── database/entity/
│       ├── mapper/
│       ├── preferences/
│       └── repository/
├── platform/
│   ├── monitoring/
│   ├── scheduling/
│   ├── notification/
│   └── permissions/
├── di/
└── ui/
    ├── navigation/
    ├── components/
    └── theme/
```

## 소스셋

- `src/main`: 앱 공통 코드와 실제 기능
- `src/debug`: 개발 전용 `FakeBusDataSource`, 모의 데이터 fixture와 Debug 전용 의존성 연결
- `src/test`: Android 기기 없이 실행하는 정책·Mapper·Coordinator 단위 테스트
- `src/androidTest`: Room, Compose UI, 알림 등 Android 기기 테스트

## 보안 경계

- 루트 `.env`는 PC API 검증 전용이며 Android 빌드에 포함하지 않는다.
- `local.properties`는 SDK 경로 등 로컬 설정 전용이며 Git에 포함하지 않는다.
- APK에 공공데이터 인증키를 넣지 않는 구성을 우선한다.
- 서울 API의 HTTP 통신 문제 때문에 운영 앱은 HTTPS 중계 서버 사용을 우선 검토한다.
- `network_security_config.xml`에서 전체 cleartext 통신을 허용하지 않는다.

## Placeholder 정책

빈 디렉터리를 Git에서도 유지하기 위해 현재 `.gitkeep` 파일을 사용한다. 실제 Kotlin, XML 또는 리소스 파일이 추가되면 같은 디렉터리의 `.gitkeep`을 제거한다. 개발 전용 모의 데이터는 `src/debug`에만 두며 `src/main`에 중복된 fake 구현을 만들지 않는다.

