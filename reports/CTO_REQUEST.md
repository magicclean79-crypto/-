# CTO_REQUEST — 아키텍트 결정 요청 사항

> 엔지니어링에서 CTO(아키텍트)의 결정·확인이 필요한 항목을 기록한다.
> 결정되면 해당 항목을 "결정됨" 섹션으로 이동한다.

## 결정 대기

### 62. TASK-2901 "Enterprise AI Provider Production Platform" 세부 해석 확인
- 현황: CTO 결정 2801-①~⑤가 이번 TASK의 범위였습니다.
  - **유지 결정 3건을 테스트로 고정**(결정 2801-①②③ — 전체 범위 Alert와
    프로젝트별 Alert 둘 다 유지, 신규 위반 표본 10건 고정). **유지 결정은 코드에
    흔적이 남지 않아서** 나중에 누가 "정리"하며 없애도 아무도 모릅니다. 표본
    상한은 환경변수로 열지 않았고(열면 "일단 늘려 두는" 우회가 생기고 경보가
    목록이 됩니다) core가 `process.env`를 읽지 않는다는 사실까지 못질했습니다
  - **작성자 직접 알림 미구현**(결정 2801-④ — 경보에 수신자 개념이 없고
    `author`·`recipient`·`assignee` 흔적이 없음을 고정)
  - **연결 순서를 값으로**(결정 2801-⑤ — `PROVIDER_ROLLOUT_ORDER`,
    `GET /ops/providers`(ADMIN) + 관리자 화면. **`unverified`를 `connected`로
    세지 않습니다**: 키 형식은 오타를 잡을 뿐이고, 그것을 연결 완료로 세면 붙지
    않은 시스템이 붙은 것처럼 보고됩니다. `connected`의 근거는 **성공한 실행
    기록**이고 기한은 최근 30일입니다 — 2년 전 성공으로 "지금도 붙어 있다"고
    말할 수 없습니다. 순서 이탈은 **말하되 막지 않습니다** — 돌아가던 것을
    끊으면 순서를 지키는 것보다 나쁩니다)
  - **OCR 운영 표준 엔진 신규**(순서의 마지막 단계 — 지금까지 운영에서 쓸 수
    있는 OCR 엔진이 **없었습니다**. `GoogleVisionOcrProvider`를 붙였고,
    **신뢰도를 지어내지 않으며**(주지 않으면 `null` — 1.0은 거짓, 0은 실패처럼
    읽힙니다) **오류를 뭉치지 않습니다**(키·할당량·Google 장애·이미지 문제는
    사람이 할 일이 전혀 다릅니다). 글자 없는 이미지는 성공이지만 형식이 다른
    응답은 실패입니다 — 빈 텍스트로 넘기면 상품이 빈 재료로 조립됩니다)
  - **자체 발견 결함 1건**: `OCR_PROVIDER`에 알 수 없는 값(오타·미구현)이 오면
    **경고 한 줄만 남기고 가짜 OCR로 운영이 돌았습니다.** 이미지에서 읽지도 않은
    텍스트로 조립된 상품이 검수를 통과하는, 이 프로젝트에서 가장 위험한 조용한
    실패입니다. 운영에서는 기동을 차단하고(Fail Fast) 개발에서는 경고 후 mock을
    유지합니다. 또한 `OCR_PROVIDER`는 **어느 화면에도 없던 설정**이었습니다 —
    환경 검증에 편입해 운영 mock·개발용 엔진·엔드포인트 변경(키가 그 주소로
    전송됨)을 모두 말하게 했습니다
  - 라이브(**실 PostgreSQL + 실 Redis + 실 S3 + Google Cloud Vision 계약
    스텁**): 기동 차단 2종 확인 · 실 HTTP 경로로 OCR 성공(신뢰도 0.94, 요청에
    base64 70바이트·TEXT_DETECTION·언어 힌트) · 오류 5종이 각각 다른 문구 ·
    키가 기록에 **0건** · `/ops/providers`가 네 상태(연결됨+근거 / 확인 안 됨 /
    미구성 / 가짜)를 실제로 구분 · 순서 이탈 표시만 하고 차단 없음
  - **확인하지 못한 것**: **실제 Google Cloud Vision과 실 OpenAI·Anthropic·
    Gemini 호출**입니다. 실 키가 없고 외부 네트워크가 차단되어 있으며 과금이
    발생합니다. 검증은 **계약 스텁**으로 했고, 확인된 것은 요청 형식·응답
    파싱·오류 분기·기록이며 **키 유효성과 인식 품질은 아닙니다.** 판정도 그
    사실을 그대로 말합니다(`unverified`)
- 하지 않은 것: 실키 발급·스테이징 스모크(권한 밖), 다른 OCR 엔진(Azure·
  Textract·CLOVA), OCR 비용 관측, 근거 기한 환경변수화
- 질문: ① **실키 확보 경로** — 순서 ①부터 실제로 붙이려면 키가 필요합니다.
  누가 어디에 넣고(운영·스테이징), 스모크는 어느 환경에서 돌립니까? 완료 판정을
  "`/ops/providers`가 `connected`"로 두어도 되겠습니까 ② **OCR 엔진 선택** —
  Google Cloud Vision을 운영 표준으로 확정하시겠습니까? 대상이 주로 한국어 상품
  라벨이라 CLOVA OCR이 더 나을 수 있는데, 그 비교는 실 키와 실측이 필요합니다
  ③ **근거 기한 30일** — 호출이 드문 운영에서는 붙어 있는데도 `unverified`로
  보입니다. 30일을 표준으로 확정할지, 다른 값으로 정할지 ④ **OCR 비용** — OCR도
  호출당 과금됩니다. LLM처럼 예산·모니터링 대상에 넣을지 ⑤ **Sprint 29 진행
  방향** 및 다음 TASK 지정 요청.


### 6. 실제 Provider 연결 시점
- 현황: OCR/Analysis/Vision 전부 mock 기본. 실제 모델 연결 가이드는
  docs/architecture/*.md에 준비되어 있다.
- 요청: 어느 계층부터, 어떤 모델로 연결할지 스펙 요청 (API 키 확보 포함).

## 결정됨

### 61. TASK-2801 해석 확인 → 승인 + 전체·프로젝트별 Alert 유지·표본 10건 고정·작성자 알림 미구현·실 Provider 연결 순서 확정 + Sprint 28 종료 (2026-07-30)
- CTO 결정: ① **전체 범위 Alert 유지** ② **프로젝트별 Alert도 유지**
  ③ **신규 위반 표본은 최대 10건으로 고정** ④ **작성자 직접 알림은 구현하지
  않는다** ⑤ **실제 Provider 연결은 OpenAI → Anthropic → Gemini → Vision →
  OCR 순서로 진행** · Sprint 28 종료, Sprint 29 시작, TASK-2901 "Enterprise AI
  Provider Production Platform" 지시
- 반영: TASK-2901에서 ①~⑤ 전부 반영. ①②③④는 **코드를 바꾸지 않는 대신 그
  사실을 테스트로 고정**했다(전체·프로젝트별 경보 키가 모두 남아 있음, 표본
  상한이 10이고 core가 환경을 읽지 않음, 작성자 알림 흔적이 없음). ⑤는 순서를
  **값으로** 두고(`PROVIDER_ROLLOUT_ORDER`) 단계별 상태·다음 단계를
  `GET /ops/providers`로 노출했으며, 순서의 마지막 단계인 **OCR 운영 표준
  엔진**(Google Cloud Vision)을 새로 붙였다. 그 과정에서 **알 수 없는
  `OCR_PROVIDER`가 조용히 mock으로 대체되던 결함**을 찾아 운영 기동 차단으로
  고쳤다. 실 키 호출은 이 저장소에서 검증할 수 없어 `unverified`로 남긴다

#### 제출 당시 기록 (TASK-2801)
- 현황: CTO 결정 2701-①~⑤가 이번 TASK의 범위였습니다. TASK-2701이 **"늘었으면
  부른다"**를 만들었고, 이번에는 그 부름이 **어느 프로젝트에서, 무엇이 새로
  위반됐는지**까지 담게 만들었습니다:
  - **되살리기 권한은 EDITOR 유지**(결정 2701-① — 코드는 바꾸지 않고 **바꾸지
    않았다는 사실을 고정**했습니다: 전이 경로가 `EDITOR`이고 그 파일에 `ADMIN`이
    없음, 되살리기 **전용 경로(`revive`·`unarchive`)도 없음**을 소스 검사로
    남겼습니다. 별도 경로를 만들면 권한·감사 이력이 두 갈래가 됩니다. ADMIN으로
    올리면 콘텐츠를 고치는 사람이 내린 것을 되살릴 수 없고, 그러면 사람들은 새
    콘텐츠를 만들어 우회해 **왜 내렸는지가 끊깁니다**)
  - **마지막 발행 시각**(결정 2701-② — `publishedAt`은 **최초**로 그대로 두고
    `lastPublishedAt` 신설. 판정은 core 순수 함수 하나에서만 합니다(두 곳에서
    정하면 한쪽이 최초 시각을 덮어쓰는 순간을 아무도 모릅니다). **`null`은
    모르는 것**이라 화면이 "재발행 없음"이 아니라 "미기록"이라고 말합니다.
    백필은 복사가 아니라 **감사 이력에서 실제 마지막 발행 전이를 되살립니다** —
    복사하면 이미 재발행된 콘텐츠가 "한 번만 발행"으로 보이고, **라이브 DB에
    실제로 그런 행이 있었습니다**)
  - **프로젝트별 예약 스캔**(결정 2701-③ — 프로젝트를 하나씩 훑고 **전체는 그
    합**으로 만듭니다. 따로 한 번 더 훑으면 콘텐츠를 두 번 읽고 **읽은 시점이
    달라 전체와 프로젝트별이 어긋날 수 있습니다.** 프로젝트가 없어도 전체 실행은
    남깁니다 — 기록이 없으면 "돌지 않았다"와 구분되지 않습니다)
  - **프로젝트별 Alert와 독립 Cooldown**(결정 2701-④ — 범위마다 기준선·경보
    키가 따로입니다. 뭉치면 ⓐ 한 곳이 나아지고 다른 곳이 나빠질 때 **총량이
    그대로라 아무 경보도 오지 않고** ⓑ 프로젝트 A의 스캔이 **B의 경보를 해소해
    버립니다.** 재알림 간격은 이미 키 단위였고, `resolvableKeys`를 더해
    **해소 범위도 이번에 판정한 범위로** 좁혔습니다)
  - **경보에 증가 수 + 새로 위반된 콘텐츠 최대 10건**(결정 2701-⑤ —
    **증가 수와 새로 위반된 수는 다를 수 있어**(2건 생기고 1건 해소되면 총량은
    1건) 둘을 따로 말합니다. 10건이 넘으면 생략 건수를 밝히고, 저장은 표본
    10건이지만 **건수는 전체**입니다. `newlyCount`의 **`null`은 "가릴 수
    없었다"**이고 0과 다릅니다 — `NOT NULL DEFAULT 0`으로 두었다면
    **마이그레이션 직후 첫 실행이 기존 위반 전부를 "새로 생겼다"로
    알렸을 것입니다**)
  - 라이브(**실 PostgreSQL + 실 Redis + 실 S3**): 예약 1회로 프로젝트 6개 +
    전체가 기록되고 **합이 정확히 일치**(2+9=11) · 같은 결과 재실행은 경보 0 ·
    **총량 11 그대로인데 한 프로젝트만 악화 → 그 프로젝트만 경보**(TASK-2701
    설계로는 **아무 경보도 오지 않았을 상황**)이고 문구에 증가 수 + 새로
    위반된 콘텐츠 이름 포함 · 그 위반을 고치자 **해당 키만 RESOLVED, 전체
    범위의 기존 CRITICAL은 ACTIVE 유지**(거짓 해소 없음) · 12건 동시 위반에서
    표본 10건 + "나머지 2건" 명시 · 재발행에서 `publishedAt` 유지·
    `lastPublishedAt` 갱신 · **실제 EDITOR 계정으로 보관→되살림→검토→재발행
    전 과정 200** · 백필이 실제 재발행 시각(02:43 발행 → 03:34 재발행)을 되살림
  - **자체 발견 결함은 없습니다.** 대신 **결함이 될 수 있었던 지점 넷**을
    설계에서 막았습니다: 위 `newlyCount` nullable · 이력 기반 백필 ·
    스텁 3건(프로젝트 목록이 비면 프로젝트별 스캔이 아무것도 안 하는데 통과 /
    커서를 무시하면 큰 스캔의 무한 루프가 감춰짐 / 규칙이 비면 경보 경로가
    검증 안 됨)
- 하지 않은 것: 전체 범위 경보 폐지, 변경된 프로젝트만 훑는 최적화, 표본 상한
  환경변수화, 재발행 횟수 집계, 콘텐츠 작성자 직접 알림
- 질문: ① **전체 범위 경보의 존치** — 프로젝트별 경보가 생긴 뒤에도 전체 범위
  경보를 남겼습니다("어디인가"와 "얼마나 큰가"는 다른 질문이라고 판단했습니다).
  그 결과 여러 프로젝트가 동시에 나빠지면 **전체 + 프로젝트별로 여러 건**이
  갑니다. 전체를 남길지, 프로젝트별만 둘지 ② **프로젝트 수 증가** — 콘텐츠는
  한 번씩 읽지만 프로젝트마다 별도 질의입니다(실측 6개·32건에서 156ms).
  수백 개가 되면 **변경된 프로젝트만 훑는 방식**이 필요한지, 아니면 전량 유지
  ③ **표본 10건** — 환경변수로 열지 않았습니다(열면 "일단 늘려 두는" 우회가
  생기고 경보가 목록이 됩니다). 10건을 표준으로 확정할지 ④ **경보 대상** —
  지금은 운영 채널로만 갑니다. 새로 위반된 콘텐츠의 **작성자에게 직접** 알릴지
  ⑤ **Sprint 28 진행 방향** 및 다음 TASK 지정 요청.


### 60. TASK-2701 해석 확인 → 승인 + 되살리기 권한 EDITOR 유지·`lastPublishedAt` 신설·프로젝트별 예약 스캔·프로젝트별 Alert와 독립 Cooldown·경보에 증가 수와 신규 위반 목록 + Sprint 27 종료 (2026-07-30)
- CTO 결정: ① **되살리기 권한은 EDITOR 이상으로 유지** — ADMIN 승격은 하지
  않음 ② **`publishedAt`은 최초 발행 시각을 유지**하고 **`lastPublishedAt`을
  신규 추가** ③ **Sprint 28에서 프로젝트별 예약 스캔 구현** ④ **프로젝트별
  Alert와 독립 Cooldown 구현** ⑤ **경보에는 증가 수와 새로 위반된 콘텐츠(최대
  10건)를 포함** · Sprint 27 종료, Sprint 28 시작, TASK-2801 "Enterprise
  Governance Intelligence Platform" 지시
- 반영: TASK-2801에서 ①~⑤ 전부 구현. ①은 **코드 변경 없이 현재 구현이 표준**이
  되었고 ADMIN·되살리기 전용 경로가 **없다는 사실**을 소스 검사로 고정했다.
  ②는 `resolvePublishTimestamps`(core 순수 함수 하나) + `lastPublishedAt` 컬럼,
  백필은 **감사 이력에서 실제 마지막 발행 전이를 되살렸다**(복사하면 이미
  재발행된 콘텐츠가 "한 번만 발행"으로 보이고, 라이브 DB에 그런 행이 있었다).
  ③은 `runScheduled`가 프로젝트를 하나씩 훑고 **전체는 합으로** 만든다(따로
  훑으면 읽은 시점이 달라 숫자가 어긋난다). ④는 범위별 키에 더해
  `reconcileAlerts(resolvableKeys)`로 **해소 범위까지** 좁혔다 —
  라이브에서 한 프로젝트 해소가 다른 프로젝트·전체 경보를 지우지 않음을 확인.
  ⑤는 `diffViolations` + 표본 10건(건수는 전체), `newlyCount`의 `null`로
  **"가릴 수 없음"과 0을 구분**했다

#### 제출 당시 기록 (TASK-2701)
- 현황: CTO 결정 2601-①~⑤가 이번 TASK의 범위였습니다. TASK-2601이 스캔
  **도구**를 만들었고, 이번에는 그것을 **예약으로 돌리고 늘었을 때만 부르고
  큰 프로젝트에서도 정확하게** 만들었습니다:
  - **이미 나간 위반의 공식 절차**(결정 2601-① — `PUBLISHED → ARCHIVED → 수정 →
    재발행`. **그런데 그 절차를 코드가 막고 있었습니다**: `ARCHIVED`는
    Sprint 1부터 종결 상태여서 되살릴 길이 없었습니다. 절차를 정해 두고 코드가
    막으면 사람은 새 콘텐츠를 만들어 우회하고, 그러면 **왜 내렸는지가 새
    콘텐츠에 남지 않습니다.** `ARCHIVED → DRAFT` 되살리기를 열었고,
    **`ARCHIVED → PUBLISHED` 직행은 열지 않았습니다** — 되살린 것은 `REVIEW`를
    거쳐야 하고 그래야 게이트가 다시 돕니다. 별도 상태(`SUSPENDED`)는 만들지
    않았고, 상태 목록 자체를 테스트로 고정했습니다)
  - **예약 스캔**(결정 2601-② — `governance-scan`, 매일 03:50 로컬. 보관
    정리(04:00)보다 **앞에** 둡니다: 스캔이 남긴 기록을 보관이 곧바로 치우면
    방금 만든 것을 못 봅니다. 위반이 있는 것은 시스템 장애가 아니므로 점검
    자체는 `ok: true`입니다)
  - **늘었을 때만 부른다**(결정 2601-③ — 첫 스캔은 **기준선**(규칙을 처음 켠
    직후 전량을 경보로 만들면 아무 뜻이 없습니다) · 늘면 경보 · 같으면 조용 ·
    줄면 조용(기존 경보 유지) · 0이 되면 해소. 이미 나간 위반이 섞이면 심각.
    비교 기준은 **범위별**이고, **경보를 만들지 않은 실행도 기록**합니다 —
    "돌았지만 조용했다"와 "돌지 않았다"는 다릅니다)
  - **페이지**(결정 2601-④ — `?offset`·`?limit`은 목록만 자르고 **`summary`는
    항상 전체 기준**입니다. 판정은 전량을 하되 내부에서 **커서**로 나눠
    읽습니다(`skip`은 읽는 도중 새 콘텐츠가 생기면 한 건을 두 번 세거나
    건너뜁니다). 잘못된 `offset`은 400 — 조용히 0으로 되돌리면 **다른 페이지를
    보고 있는 줄도 모릅니다**)
  - **규칙 캐시는 Request Scope만**(결정 2601-⑤ — 스캔 한 번에 한 번만 읽습니다.
    **전역 캐시는 두지 않았습니다**: 규칙을 고친 운영자가 언제 반영되는지 알 수
    없게 되면 규칙을 신뢰할 수 없습니다. 없다는 사실을 소스 검사로 고정)
  - 라이브(**실 PostgreSQL + 실 Redis + 실 S3**): 기준선(알림 0·경보 테이블
    0건) → 같음(알림 0·**경보 여전히 0건**) → 늘림(알림 1·CRITICAL 생성) →
    줄임(알림 0·경보 ACTIVE 유지, 거짓 해소 없음) · 페이지 4구간에서 `summary`가
    모두 동일하고 6구간을 이어 붙여 **11건 수집·중복 0건** · 잘못된 offset 3종
    400 · 공식 절차 6단계(내림 → **발행 직행 400+경로 안내** → 되살림 → 수정 →
    검토 → **재발행 200**) 전부 확인
  - **자체 발견 결함 1건 수정**: 경보 저장소 동기화를 매 실행마다 불러
    **늘지 않은 실행에서 경보가 새로 생겼습니다** — 결정 ③ 정면 위반이고
    라이브 2단계에서 드러났습니다. `shouldSyncScanAlerts`로 **늘었을 때와 0이
    됐을 때만** 동기화하도록 고쳤습니다(그 사이에는 저장소를 건드리지 않으므로
    거짓 해소도 나지 않습니다). 회귀 테스트 3건 + 라이브 재검증
- 하지 않은 것: 되살리기 권한 상향, 마지막 발행 시각 별도 보관, 프로젝트별
  예약 스캔, 경보 문구에 변화 목록 포함, 보관 기록 목록 UI
- 질문: ① **되살리기 권한** — 지금은 발행과 같은 `EDITOR` 이상이면 보관된
  콘텐츠를 되살릴 수 있습니다. 내린 것을 되살리는 일이 더 높은 권한(ADMIN)을
  요구해야 하는지 ② **재발행 시각의 의미** — `publishedAt`은 최초 발행 시각을
  보존합니다(TASK-0703 승인 ②). 그래서 내렸다 다시 올린 콘텐츠는 목록 화면에서
  **옛 날짜**를 보여주고, "언제부터 나가 있는가"를 이 값으로 알 수 없습니다.
  최초 발행을 유지할지, 마지막 발행 시각을 따로 둘지 ③ **예약 스캔 범위** —
  지금은 전체 범위만 돕니다. 프로젝트별 기준선은 사람이 한 번 호출해야 생기고,
  프로젝트가 많아지면 전체 숫자 하나로는 어디가 나빠졌는지 알기 어렵습니다.
  프로젝트별 예약을 돌릴지(그러면 경보 수가 프로젝트 수만큼 늘어납니다)
  ④ **경보에 변화 목록** — 지금은 총량만 말하고 어떤 콘텐츠가 새로 위반이
  됐는지는 기록에만 남습니다. 경보 문구에 담을지 ⑤ **Sprint 27 진행 방향** 및
  다음 TASK 지정 요청.


### 59. TASK-2601 해석 확인 → 승인 + 공식 절차 확정(ARCHIVED 경유)·예약 스캔 지시·증가 시에만 Alert·Pagination·Request Scope 캐시 + Sprint 26 종료 (2026-07-30)
- CTO 결정: ① **이미 발행된 위반의 공식 절차는 `PUBLISHED → ARCHIVED → 수정 →
  재발행`으로 확정** — 별도 상태(`SUSPENDED`)는 만들지 않음 ② **Sprint 27에서
  Scheduled Governance Scan 구현** ③ **위반 증가(Change Detection) 시에만 Alert
  발생** — 동일 결과 반복 Alert 금지 ④ **Scan Pagination 구현** — Summary는
  항상 전체 기준 ⑤ **규칙 조회 캐시는 Request Scope만 허용** — Global Cache는
  구현하지 않음 · Sprint 26 종료, Sprint 27 시작, TASK-2701 "Enterprise
  Governance Automation Platform" 지시
- 반영: TASK-2701에서 ①~⑤ 전부 구현. ①은 **코드가 그 절차를 막고 있던 것을
  발견해** `ARCHIVED → DRAFT`를 열었다(발행 직행은 열지 않음 — 게이트를 다시
  거쳐야 한다). ③은 구현 중 **늘지 않은 실행에서 경보가 생기는 결함**이
  라이브 검증에서 드러나 `shouldSyncScanAlerts`로 고쳤다. ④는 커서 기반 전량
  판정 + 목록 페이지, ⑤는 `snapshot()` 요청 1회 읽기(전역 캐시 없음을 소스
  검사로 고정)

#### 제출 당시 기록 (TASK-2601)
- 현황: CTO 결정 2501-①~⑤가 이번 TASK의 범위였습니다. TASK-2501이 발행 게이트를
  **켰고**, 이번에는 그것을 **켜기 전에 세어 보고 켠 뒤에 정리하는** 도구를
  붙였습니다 — 규칙을 만드는 것과 규칙을 운영하는 것은 다른 일입니다:
  - **Governance Preflight Scan**(결정 2501-① — 규칙을 처음 켜면 이미 `REVIEW`에
    있던 콘텐츠들이 위반을 담고 있을 수 있고 그러면 발행이 줄줄이 막힙니다.
    **상태를 바꾸지 않고, 자동으로 고치지 않고, 판정 기록도 남기지 않습니다** —
    훑어본 것을 발행 시도로 기록하면 이력이 사실과 어긋납니다. 자동 수정을
    만들지 않는 이유는 원격 사본 자동 복구를 만들지 않은 것(결정 2201-②)과
    같습니다: 금지어를 기계가 지우면 문장이 무슨 뜻이 되는지 아무도 확인하지
    않은 채 발행됩니다. **쓰기 함수를 아예 부르지 않음을 테스트로 고정**했고,
    화면에도 버튼을 두지 않았습니다)
  - **이미 나간 위반을 따로 셉니다**(`blocked`(발행 시 막힐 것)와
    `publishedViolations`(**이미 발행됨**)를 나눕니다 — 발행 게이트는 나가는
    것을 막지만 **이미 나간 것에는 아무 힘이 없습니다.** 문구도 목록도 이미
    나간 것을 먼저 말합니다)
  - **조용히 자르지 않습니다**(`?limit`은 목록만 자르고 요약의 숫자는 자르기 전
    전체입니다. 잘랐다는 사실·생략 건수를 문구에 적고, 판정 대상 상한(500건)을
    넘으면 "나머지는 검사하지 않았습니다"까지 밝힙니다. 잘못된 값은 400 —
    조용히 기본값으로 되돌리면 운영자는 자기가 준 값이 적용됐다고 믿습니다)
  - **판정 기록 90일 보관**(결정 2501-⑤ — 경보·Dead Letter와 같은 정책이고
    **삭제하지 않습니다.** 기준은 **작성 시각**입니다(판정 기록에는 해소가
    없습니다). 그래서 작업 문구도 "해소 후"와 "작성 후"를 나누어 적습니다.
    예약 정리 작업(`alert-archive`)에 **편입**했습니다 — 새 작업을 만들면 같은
    성격의 정리가 서로 다른 시각에 돌아 무엇이 남았는지 흐려집니다.
    보관된 것도 `?includeArchived=1`로 볼 수 있습니다 — **볼 길이 없으면 보관이
    사실상 삭제입니다**)
  - **하지 않기로 한 것을 테스트로 고정**(결정 2501-②③④ —
    `content-governance-boundary.spec.ts`: 금지어 부분 일치 유지(`최고`가
    `최고급`에도 걸리는 것을 **정상 동작으로** 고정, 예외 목록·정규식이 코드에
    없음을 소스 검사) · READY 판정 모듈에 `throw`·`publishable`·`blocking`이
    없음(**강제 차단은 `PUBLISHED`뿐**) · 판정 입력에 규칙 스코프가 없음)
  - 라이브(**실 PostgreSQL + 실 Redis + 실 S3**): 실제 3건 스캔에서
    `blocked 1`·`publishedViolations 1`·`clean 1`이 나오고 **스캔 후 상태·판정
    기록이 모두 그대로** · `?limit=1`에서 요약은 전체이고 목록만 1건 ·
    잘못된 입력 400 · 전체 범위 무인증 401 후 ADMIN으로 32건 · 100일 전 기록
    1건이 예약 작업으로 **보관되고 행은 5건 그대로**(삭제 아님) · 재실행 0건 ·
    현황 이력 4건 / `includeArchived=1` 5건
  - **자체 발견 보완 1건 + 검증 구조 개선 2건**: ⓐ `history()`가
    `includeArchived`를 지원하는데 **API로 도달할 길이 없었습니다** — 보관된
    기록을 볼 방법이 없으면 보관이 사실상 삭제입니다. 질의를 추가했습니다
    ⓑ `content.findMany` 스텁이 `status`·`take`를 무시해 **Preflight 범위·상태
    필터가 검증될 수 없었습니다** ⓒ `governanceCheck.findMany` 스텁이
    `archivedAt`를 무시해 **보관 분리가 검증될 수 없었습니다**
- 하지 않은 것: 이미 나간 위반을 내리는 공식 절차, 예약 스캔·위반 증가 경보,
  스캔 페이지네이션, 규칙 조회 캐시, 보관 기록 목록 UI
- 질문: ① **이미 나간 위반의 처리 절차** — 스캔이 "내려야 합니다"라고 말하지만
  **내리는 수단을 정하지 않았습니다.** `ARCHIVED` 전이가 사실상 그 역할이지만
  그것이 공식 절차인지, 별도 상태(예: `SUSPENDED`)가 필요한지 ② **스캔 자동화** —
  지금은 사람이 눌러야 하고, 규칙이 바뀐 뒤 위반이 늘어도 아무도 알려주지
  않습니다. 예약 스캔 + 위반 증가 경보를 둘지. 다만 **부를 일이 아닌데 부르면
  정작 불러야 할 때 오지 않으므로**(결정 1301-① 계열) 임계 기준이 필요합니다
  ③ **스캔 상한** — 한 번에 500건이고 페이지네이션이 없습니다. 큰 프로젝트를
  어떻게 다룰지 ④ **규칙 조회 캐시** — 500건 스캔이면 규칙 조회가 500회입니다.
  스캔 한 번 안에서 규칙은 바뀌지 않으므로 캐시할 수 있지만, 판정의 단일 원천을
  흐리지 않도록 범위를 정해야 합니다 ⑤ **Sprint 26 진행 방향** 및 다음 TASK
  지정 요청.


### 58. TASK-2501 해석 확인 → 승인 + Preflight Scan 지시·금지어 부분 일치 유지·READY Advisory 유지·규칙 스코프 GLOBAL·판정 기록 90일 보관 + Sprint 25 종료 (2026-07-30)
- CTO 결정: ① **Governance Preflight Scan을 Sprint 26에서 구현** — 상태 변경이나
  자동 수정 없이 **위반 목록만** 생성 ② **금지어는 부분 일치를 유지** — 단어
  경계와 예외 목록은 도입하지 않음 ③ **READY는 Advisory Mode를 유지** —
  `PUBLISHED`만 강제 차단 ④ **규칙 스코프는 GLOBAL만 유지**
  ⑤ **Governance 판정 기록은 삭제하지 않고 90일 이후 Archive 정책 적용** ·
  Sprint 25 종료, Sprint 26 시작, TASK-2601 "Enterprise Governance Operations
  Platform" 지시
- 반영: TASK-2601에서 ①⑤를 구현하고 ②③④를 **테스트로 고정**했다 —
  `GovernancePreflightService`(쓰기 없음·기록 없음·자동 수정 없음, 이미 나간
  위반을 따로 셈) · `ContentGovernanceService.archive`(작성 후 90일,
  `alert-archive` 작업에 편입, 삭제 아님, `includeArchived`로 조회 가능) ·
  `content-governance-boundary.spec.ts`(부분 일치·Advisory·GLOBAL 스코프가
  **없다는 사실**을 소스 검사로 고정 — 하지 않기로 한 일은 코드에 흔적이 없어서
  나중에 누가 되살려도 아무도 모른다)

#### 제출 당시 기록 (TASK-2501)
- 현황: Sprint 16~24는 **인프라·운영 거버넌스**였고, 이번에는 같은 원칙을
  **제품이 세상에 내보내는 것**으로 가져왔습니다. **여기서 큰 공백을
  발견했습니다**: 금지어·규칙 검사는 Sprint 4(TASK-0404)부터 있었지만
  **Product Object의 READY 전환에만** 걸려 있었고, 세상에 나가는 것은 Product
  Object가 아니라 **Content의 제목과 본문**인데 그 경로의 발행 조건은
  `isPublishable`(REVIEW 상태 + 제목·본문 비어 있지 않음)뿐이었습니다 —
  **금지어가 든 본문도, 필수 고지가 빠진 본문도 아무 판정 없이 발행됐습니다.**
  게다가 READY 판정 자체가 코드 주석 그대로 "검증 결과 미강제"였습니다.
  상품을 검사하고 콘텐츠를 검사하지 않는 것은 **재료를 검사하고 완성품은
  안 보는 것**과 같습니다:
  - **발행 게이트**(`PUBLISHED` 전이에만 걸립니다 — 검토를 요청하는 것과 세상에
    내보내는 것은 다르므로 `REVIEW`·`ARCHIVED`는 막지 않습니다. 판정은 **읽어 둔
    레코드로** 합니다(다시 읽으면 판정한 내용과 발행되는 내용이 다를 수 있습니다).
    발행 형식 검증이 거버넌스보다 먼저라, 빈 본문은 판정 기록조차 만들지
    않습니다. 막는 항목은 `blocking` 필드로 밝힙니다 — 화면이 "주의인데 왜
    막혔지"를 추측하지 않아야 합니다)
  - **금지어는 제목과 본문 모두**(READY 판정은 상품의 제목·브랜드·OCR만 봤습니다.
    스캔 규칙은 `scanBannedWords`를 **재사용**합니다 — 상품에서는 걸리는 말이
    콘텐츠에서는 안 걸리면 어느 쪽 판정도 믿을 수 없습니다. 메시지에 **어디에
    몇 건**인지 적습니다)
  - **필수 고지**(#7의 "필수 고지"를 여기서 구현했습니다 — `whenCategory`로
    분류별 적용. 모든 상품에 모든 고지를 요구하면 본문이 고지문으로 덮이고
    아무도 읽지 않습니다. 공백·줄바꿈 차이는 무시하고, 분류를 모르면 전체 적용
    규칙만 검사하며 **그 사실을 말합니다**. `reason`을 함께 남깁니다 — 문구만
    있으면 나중에 아무도 못 지우고 왜 있는지도 설명할 수 없습니다)
  - **판정 기록**(`content_governance_checks` 신규 테이블, 삭제하지 않습니다.
    **그때의 기준**(금지어 수·적용 고지 id)을 함께 남깁니다 — 규칙은 나중에
    바뀌므로 "왜 이게 발행됐지"에 답하려면 판정 당시 기준이 있어야 합니다.
    **막힌 기록도** 남깁니다 — 없으면 "왜 이렇게 늦게 발행됐지"에 답할 수
    없습니다)
  - **규칙을 읽는 곳도 하나**(`GovernanceRulesService` — READY 판정과 발행
    게이트가 같은 곳에서 읽습니다. 미리보기와 게이트도 **같은 판정 함수**를
    부릅니다 — 화면이 "발행 가능"이라 했는데 누르면 막히는 상태를 구조적으로
    없앴습니다. 결정 2301-①과 같은 이유)
  - 라이브(**실 PostgreSQL + 실 Redis + 실 S3**): 실제 Memory에 금지어·고지
    규칙을 등록하고 금지어 든 본문의 발행이 **400으로 차단**되며 상태가 `REVIEW`
    그대로 유지됨 · 금지어만 지우면 고지 누락으로 **여전히 차단** · 고지까지
    넣으면 발행 성공 · **판정 기록 3건**(막힘 2 + 통과 1)이 시간순으로 남아
    지연을 설명 · 같은 금지어를 READY 판정과 발행 판정이 **함께** 잡음 ·
    규칙 미설정에서는 `주의`로만 남고 발행되며 기준이 `0`이 아니라 `null`로 기록
  - **자체 발견 결함 1건 + 검증 구조 개선 1건**: ⓐ 형식이 틀린 규칙에 "설정되지
    않았습니다"라고 안내했습니다 — 등록은 되어 있는데 그렇게 말하면 운영자는
    등록하러 갔다가 이미 있는 것을 발견합니다(**상태와 설명이 모순되는** 결함
    계열). `RuleSource`로 안내를 분리했습니다 ⓑ Prisma 목업이 연결 상품을
    `{version}`만 돌려줘 **분류별 고지 판정이 구조적으로 검증될 수 없었습니다**
- 하지 않은 것: 규칙을 처음 켤 때 막히는 콘텐츠를 미리 훑는 일괄 판정, 금지어의
  단어 경계·예외 목록, READY 판정 강제, 프로젝트·분류별 규칙 스코프,
  판정 기록 보관 정책
- 질문: ① **전환 시점의 일괄 판정** — 규칙이 등록된 환경에서 이미 REVIEW에 있던
  콘텐츠가 위반을 담고 있으면 다음 발행 시도가 막힙니다. 의도된 동작이지만,
  켠 뒤에 하나씩 발견하면 발행이 줄줄이 멈춥니다. **미리 훑는 조회**를 만들지
  ② **금지어 정밀도** — 부분 일치이므로 "최고"가 "최고급"에도 걸립니다. 단어
  경계나 예외 목록이 필요한지, 아니면 **넓게 걸고 사람이 판단**하는 현재 방식을
  유지할지 ③ **READY 판정 강제 여부** — 발행은 막지만 상품의 READY 전환은
  여전히 판정과 무관하게 됩니다. 두 게이트의 강도를 맞출지, 발행만 막는 현재
  구조를 유지할지 ④ **규칙 스코프** — 지금은 GLOBAL Memory에만 있습니다.
  프로젝트·분류별로 다른 금지어가 필요한지 ⑤ **판정 기록 보관** — 경보처럼
  90일 후 보관(결정 1302-④)을 적용할지 ⑥ **Sprint 25 진행 방향** 및 다음 TASK
  지정 요청.


### 57. TASK-2401 해석 확인 → 승인 + 7일 승격 표준 확정·Amazon S3만 표준 유지·Alert 정책 그대로·복구 판정 캐시 미도입 + Sprint 24 종료 (2026-07-30)
- CTO 결정: ① **Unknown Migration 7일 승격 기준을 공식 표준으로 확정** —
  환경변수화는 하지 않음 ② **Amazon S3만 운영 표준으로 유지** — S3 호환 저장소는
  별도 검토 대상 ③ **`migration-governance` Alert는 기존 Alert 정책을 그대로
  사용** ④ **Recovery 판정 캐시는 도입하지 않음** ⑤ **tesseract Provider는
  개발용 선택 엔진으로 유지** ⑥ **Product CRUD 및 Foundation 구현은 유지** ·
  Sprint 24 종료, Sprint 25 시작, TASK-2501 "Enterprise Content Governance
  Platform" 지시
- 반영: ①~④는 **코드 변경 없이 현재 구현이 그대로 표준**이 됨 (7일은 상수
  `UNKNOWN_MIGRATION_ESCALATE_MS`로 고정 · 전환 판정은 `*.amazonaws.com`
  호스트 검사 유지 · 경보 쿨다운·채널은 기존 정책 · 판정 캐시 없음).
  ⑤⑥은 대기 항목 #2·#4를 종결시킴(아래)

#### 제출 당시 기록 (TASK-2401)
- 현황: CTO 결정 2301-①~④가 이번 TASK의 범위였습니다. 주제는 **같은 사실을 두
  곳이 따로 판정하지 않게 하는 것**입니다. Sprint 16부터 판정을 늘려 왔고,
  판정이 늘면 필연적으로 같은 것을 두 곳에서 재는 일이 생깁니다 —
  **답이 두 개면 어느 쪽도 신뢰할 수 없습니다**:
  - **복구 판정의 단일 원천**(결정 2301-① — `RecoveryEvaluationService`를
    신설해 재해 복구 체크리스트 **조립 전체**를 내렸고, `/ops/readiness`와
    `/health/ready`가 **같은 함수를 부릅니다**. 이전에는 배포 체크리스트가
    순환 의존을 피하려고 **백업·복원 이력 개수**(`backups ≥ 1 && restores ≥ 1`)
    로 대신 판정했습니다 — 즉 이력이 있으면 배포 체크리스트는 "복구 가능"이라
    말하는데 `/ops/readiness`는 같은 순간 "복구 불가"라고 말할 수 있었습니다.
    순환은 **모듈 방향**으로 풀었습니다(Health → Ops, 역방향 없음). 확인하지
    못하면 `null`이고 `직접 확인`입니다. 스키마 적용 상태도 같은 이유로
    `MigrationGovernanceService` 한 곳에서만 읽습니다)
  - **스키마가 코드보다 앞선 상태는 경보로**(결정 2301-② — 최초 `주의`,
    **7일 초과 `심각`**. 되돌린 배포는 흔하고 직후에 사람을 부를 일은 아니지만
    **일주일이 지나도 그대로라면 되돌린 것이 아니라 잊은 것**입니다.
    **배포는 막지 않습니다** — 막으면 되돌린 배포를 다시 되돌릴 수 없고,
    경보 문구에 그 사실을 적었습니다. 경과는 **경보의 `firstRaisedAt`**으로
    셉니다 — 경보를 삭제하지 않기로 한 결정(1302-④) 때문에 그 값이 곧 최초
    관측 시각이라, **관측 기록용 테이블을 새로 만들지 않았습니다**)
  - **S3 전환 후 Versioning 조회 실패는 Fail**(결정 2301-③ —
    `unknownIsFailure = production && storageStandard`. 전환 전에는
    `직접 확인`(개발 저장소는 조회를 지원하지 않습니다), 전환 후에는
    **실패·배포 차단**입니다. S3는 조회를 지원하므로 못 읽는 것은 저장소의
    한계가 아니라 **`s3:GetBucketVersioning` 권한 누락**이고 문구가 그렇게
    말합니다. 같은 상태에 같은 판정을 주면 전환의 의미 절반이 사라집니다)
  - **`pendingMigrations`는 실제 미적용 개수**(결정 2301-④ — 공식 의미를 코드와
    운영 문서에 못 박았습니다. 확인 불가는 `0`이 아니라 `null`이고 화면에는
    `확인 불가`입니다. 여기서 **결함 하나를 더 발견했습니다**: `judgeMigrations`가
    실패 행이 있으면 `pending: []`로 **비워서** 돌려줘, 반쯤 적용된 스키마에서
    `pendingMigrations`가 0으로 보고됐습니다 — TASK-2301에서 고친 거짓 통과가
    **다른 경로로 되살아나 있었습니다**. 무엇을 먼저 알릴지와 무엇이 사실인지는
    다르므로, 대조를 먼저 하고 알릴 때만 실패를 앞세우도록 바꿨습니다)
  - 라이브(**실 PostgreSQL + 실 Redis + 실 S3 + 실 pg_dump/pg_restore**):
    실제 복원 성공(32개 테이블) 후 백업 4,406건·복원 7건이 남은 상태 =
    **옛 대리 판정이라면 "복구 가능"**인데 두 화면이 **함께 복구 불가** ·
    코드에 없는 마이그레이션 삽입 → `WARNING` → `firstRaisedAt`을 8일 전으로
    되돌리자 **`CRITICAL`·"8일째"**로 승격하되 `migrations`는 `주의`로 남아
    **차단하지 않음** · `s3:GetBucketVersioning`만 403으로 거부하는 프록시를
    `*.amazonaws.com` 호스트로 붙이자 `versioning` **실패·차단**, **같은 거부**를
    비-S3 호스트로 붙이면 `직접 확인` · 미적용 1건 + 실패 행 1건에서
    `pendingMigrations` **1로 유지**(고치기 전에는 0)
  - **자체 발견 결함 1건 + 검증 구조 개선 1건**: ⓐ 위의 미적용 목록 비움
    ⓑ `ops.spec` Prisma 스텁이 **무엇을 물어도 같은 값**을 돌려주고
    `alert.findFirst`가 없어 **경보 승격이 구조적으로 검증될 수 없었습니다** —
    템플릿을 읽어 답하도록 고치고 실제 마이그레이션 디렉터리와 대조합니다
- 하지 않은 것: 7일 임계값의 환경변수화, `*.amazonaws.com` 외 S3 호환 저장소의
  표준 인정, `migration-governance` 경보의 전달 채널 별도 정책, 복구 판정 캐시,
  Amazon S3 실제 전환
- 질문: ① **승격 임계값 7일의 근거** — 되돌린 배포를 얼마나 두고 볼지에 실측
  근거는 없고 판단입니다. 환경변수로 열지 않았습니다(열면 "일단 늘려 두는"
  우회가 생깁니다). 7일을 유지할지, 다른 값으로 고정할지 ② **전환 판정 기준** —
  지금은 엔드포인트 호스트가 `*.amazonaws.com`으로 끝나는지로 판단합니다.
  S3 호환 상용 저장소(R2·Wasabi 등)는 조회를 지원해도 승격되지 않습니다.
  이대로 Amazon S3만 표준으로 둘지, 조회 가능성으로 판단을 바꿀지
  ③ **`migration-governance` 경보의 전달** — 기본 최소 수준(warning은 웹훅,
  critical은 메일)을 그대로 씁니다. 이 종류만 다르게 둘 필요가 있는지
  ④ **복구 판정 응답 시간** — 배포 게이트 경로(`/health/ready`)가 이제
  `/ops/readiness` 전체 조립(12개 병렬 조회)에 의존합니다. 실측은 1초 미만이지만
  짧은 캐시를 둘지 ⑤ **Sprint 24 진행 방향** 및 다음 TASK 지정 요청.


### 2. tesseract Provider 유지 여부 → 개발용 선택 엔진으로 유지 (2026-07-30, CTO 결정 2401-⑤)
- CTO 결정: **tesseract Provider는 개발용 선택 엔진으로 유지한다.**
- 반영: 코드 변경 없음. `OCR_PROVIDER=tesseract`로 선택 가능한 로컬 오프라인
  엔진으로 남으며, 기본값은 mock 그대로다.

### 4. 구(자체정의) TASK 산출물 처리 → 유지 (2026-07-30, CTO 결정 2401-⑥)
- CTO 결정: **Product CRUD 및 Foundation 구현은 유지한다.**
- 반영: 코드 변경 없음. Product CRUD(`d842338`)와 AI 분석 Foundation
  (`d49157a`)이 브랜치에 그대로 남는다.

### 7. READY 전환 조건 확장 여부 → 필수 고지·금지어를 발행 게이트로 구현 (2026-07-30, TASK-2501)
- 경위: 이 항목의 "Company Brain 검증(금지어·필수 고지)"을 TASK-2501에서
  구현했다. 다만 **READY 전환이 아니라 발행(`PUBLISHED`) 게이트에** 걸었다 —
  세상에 나가는 것은 Product Object가 아니라 Content의 제목·본문이고,
  READY 판정은 본문을 보지 않기 때문이다.
- 반영: `evaluateContentGovernance`의 `banned-words`·`disclosures` 검사.
  **READY 전환 조건 자체는 확장하지 않았다**(여전히 판정만 하고 강제하지
  않는다) — 두 게이트의 강도를 맞출지는 **#58 ③**으로 다시 묻는다.

### 56. TASK-2301 해석 확인 → 승인 + 복구 판정 단일 원천·Unknown Migration 7일 승격·S3 전환 후 Versioning Fail 승격·`pendingMigrations` 의미 확정 + Sprint 23 종료 (2026-07-29)
- CTO 결정: ① **Recovery 판정은 `/ops/readiness`의 `recoverable`을 Single
  Source of Truth로 사용** — 공통 Recovery Evaluation 계층을 만들어 동일한
  판정 로직을 공유 ② **Unknown Migration은 최초 Warning · 7일 초과 Critical
  Alert** — **자동 배포 차단은 하지 않음** ③ **Amazon S3 운영 전환 완료 이후
  Versioning 조회 실패는 Fail로 승격하여 배포 차단** — 전환 전에는 Manual 정책
  유지 ④ **`pendingMigrations`는 "실제 미적용 Migration 개수"를 공식 의미로
  유지** — 운영 문서도 함께 갱신 · Sprint 23 종료, Sprint 24 시작,
  TASK-2401 "Enterprise Operational Compliance Platform" 지시
- 반영: TASK-2401에서 ①~④ 전부 구현 — `RecoveryEvaluationService`(단일 원천,
  Health → Ops 단방향 의존) · `detectUnknownMigrationAlert`(7일 승격, 차단 없음,
  경과는 `alerts.firstRaisedAt`) · `unknownIsFailure = production &&
  storageStandard`(전환 후에만 승격) · `pendingMigrations` 공식 의미를 코드·문서에
  확정(실패 행이 있어도 실제 미적용 개수 유지 — 이 과정에서 결함 1건 발견·수정)

#### 제출 당시 기록 (TASK-2301)
- 현황: CTO 결정 2201-①~④가 이번 TASK의 범위였습니다. 주제는 **경계를 문서가
  아니라 판정으로 만드는 것**입니다. "운영 담당자가 한다"고 적어 두는 것과,
  하지 않았을 때 **배포가 막히는** 것은 다릅니다:
  - **스키마도 운영 담당자가**(결정 2201-① — 저장소·IAM에 이어 DB 스키마까지
    같은 경계입니다. `mayApplyMigrations`는 **어느 환경에서도 false**입니다 —
    개발에서도 기동이 스키마를 바꾸면 브랜치를 옮길 때마다 데이터가 조용히
    달라집니다. 여기서 **기존 결함을 발견했습니다**: `pendingMigrations`가
    `_prisma_migrations`의 **실패 행만** 세고 있어서, 적용하지 않은
    마이그레이션은 실패 행조차 남기지 않으므로 **"미적용 없음"이라는 거짓
    통과**가 나왔습니다. 결정이 요구하는 "검증"이 정확히 이 경우를 잡아야
    하는데 잡지 못하고 있었습니다. 디렉터리와 적용 기록을 **대조**하도록
    바꿨고, 적용됐는데 코드에 없는 것은 `주의`로 알립니다)
  - **자동 복구를 만들지 않습니다**(결정 2201-② — Critical Alert만 냅니다.
    자동으로 다시 올리면 ⓐ 로컬 덤프가 온전한지 확인하지 않은 채 원격을
    덮어써 **틀린 사본을 더 확실하게** 만들 수 있고 ⓑ 사라진 이유를 모르는 채
    올리면 같은 일이 반복됩니다. **경보 문구에 수동 복구임과 절차 위치를
    적었습니다** — 무엇을 해야 하는지 적지 않은 경보는 읽어도 할 일이 없습니다.
    대조 경로가 업로드를 부르지 않음을 소스 검사로 고정했습니다)
  - **우회 플래그를 두지 않습니다**(결정 2201-③ — `STORAGE_PROVISIONING`을
    추가하지 않고 정책은 `NODE_ENV`만 봅니다. **설정해도 무시됨**을 테스트로
    고정했습니다 — 하지 않기로 한 일은 코드에 흔적이 없어서, 나중에 누가
    "편의를 위해" 되살려도 아무도 모릅니다)
  - **운영 표준 배포 체크리스트**(결정 2201-④ — `bucket`·`iam`·`versioning`·
    `backup-bucket`·`readiness` 다섯 항목을 승격했습니다. 운영에서 버킷·백업
    버킷·복구 판정은 **배포 차단**이고, `versioning`은 **꺼져 있을 때만**
    차단합니다(조회 불가는 `직접 확인` — 모르는 것을 실패로 단정하지 않습니다).
    `iam`은 차단하지 않습니다 — 보호 상태를 읽지 못해도 지금 서비스는 돕니다.
    **복구 리허설은 게이트에 들어오지 않습니다**(결정 1801-②, 회귀 테스트로
    고정). `docs/operations/deployment-checklist.md`를 운영 표준 문서로
    신설했습니다)
  - 라이브(**실 PostgreSQL + 실 Redis + 실 S3**): 임시 마이그레이션을 만들어
    적용하지 않자 `pendingMigrations: 1` · **배포 차단** · `migrate deploy` 후
    통과로 전환 · 디렉터리를 지우자 `주의`로 전환하며 이름 노출 ·
    `STORAGE_PROVISIONING=managed`를 줘도 버킷이 생기지 않음 · 승격 다섯 항목
    실측(s3rver의 Versioning 꺼짐이 운영에서 **실제로 배포를 차단**)
  - **자체 발견 결함 1건 + 문구 다듬기 2건**: ⓐ 위의 마이그레이션 거짓 통과
    ⓑ 프로비저닝 정책 문구의 마크다운 `**` (로그에 그대로 나가는 문자열 —
    같은 결함 계열 네 번째) ⓒ 미적용 안내의 줄표 중복
- 하지 않은 것: `readiness` 항목을 `/ops/readiness`의 실제 `recoverable`로
  연결(순환 의존 회피), 되돌린 배포의 허용 기간 규칙, 조회 불가 Versioning의
  차단, Amazon S3 실제 전환
- 질문: ① **복구 판정 근거** — 배포 체크리스트가 `/ops/readiness`를 직접
  부르면 순환 의존이 되고 한쪽이 느려지면 다른 쪽이 함께 멈춥니다. 그래서
  지금은 **백업·복원 이력 존재 여부**로 대신 판정하는데, 실제 `recoverable`보다
  느슨합니다. 이대로 둘지, 판정을 공유할 구조를 만들지 ② **되돌린 배포 처리** —
  스키마가 코드보다 앞선 상태를 `주의`로만 두고 있어 계속 운영할 수 있습니다.
  허용 기간이나 해소 절차를 정할지 ③ **조회 불가 Versioning** — 통과로 세지
  않지만 막지도 않습니다. S3 전환 전에는 이 상태가 계속되는데, 전환 기한을
  정하고 그 이후에는 막을지 ④ **`pendingMigrations` 의미 변경** — 실패 행 수에서
  실제 미적용 건수로 바뀌었습니다. 외부 모니터링이 이 값을 읽고 있다면 임계값
  확인이 필요한지 ⑤ **Sprint 23 진행 방향** 및 다음 TASK 지정 요청.


### 55. TASK-2201 해석 확인 → 승인 + 스키마까지 운영 담당자 수행·자동 복구 금지·우회 플래그 없음·배포 체크리스트 운영 표준 확정 + Sprint 22 종료 (2026-07-29)
- CTO 결정: ① **운영에서 Storage · IAM · Database Migration(`prisma migrate
  deploy`) 모두 운영 담당자가 수행** — 애플리케이션은 생성·수정하지 않고
  **검증만** 수행 ② **원격 대조 실패 시 자동 재업로드와 자동 복구는 구현하지
  않음** — Critical Alert만 발생시키고 운영자가 수동 복구 ③ **`STORAGE_PROVISIONING`
  플래그는 추가하지 않음** — production은 외부 프로비저닝 정책 유지
  ④ **Production Deployment Checklist를 운영 표준으로 승격** — Bucket · IAM ·
  Versioning · Backup Bucket · Readiness 확인 절차 포함 ⑤ **Sprint 22 종료**
  ⑥ Sprint 23 시작 — TASK-2301(Enterprise Deployment Governance) 지시됨.
- 반영(TASK-2301): ① `mayApplyMigrations`를 어느 환경에서도 false로 두고,
  검증을 **디렉터리 ↔ 적용 기록 대조**로 바꿨습니다 — 기존 방식(실패 행만
  세기)은 `migrate deploy`를 잊었을 때 **거짓 통과**를 냈습니다. ② 경보만 내고
  자동 경로를 만들지 않았으며, **경보 문구에 수동 복구임과 절차 위치를**
  적었습니다. 대조 경로가 업로드를 부르지 않음을 소스 검사로 고정했습니다.
  ③ 플래그를 추가하지 않고, **설정해도 무시됨**을 테스트로 고정했습니다.
  ④ 다섯 항목을 체크리스트로 승격해 운영에서 배포를 막고,
  `docs/operations/deployment-checklist.md`를 운영 표준 문서로 신설했습니다.
  복구 리허설은 게이트에 넣지 않았습니다(결정 1801-② 유지).

### 54. TASK-2101 해석 확인 → 승인 + 수동 대조 3건·창 상향 Warning·CI 위치 유지·버킷 운영 담당자 준비 확정 + Sprint 21 종료 (2026-07-29)
- CTO 결정: ① **자동 원격 검증은 최근 백업 1건만 유지** — **수동 검증에서는
  최근 3건까지 선택하여 검증**할 수 있도록 구현 ② **관측 창 자동 상향은 유지** —
  Readiness에는 **Warning을 표시하되 서버 기동은 차단하지 않음**
  ③ **Major Migration CI 게이트는 현재 위치(Build 이후) 유지**
  ④ **Amazon S3 운영 전환은 운영 담당자가 버킷과 IAM을 준비**하고,
  **애플리케이션은 환경변수만 사용**하도록 유지 ⑤ **Sprint 21 공식 종료**
  ⑥ Sprint 22 시작 — TASK-2201(Enterprise Production Readiness) 지시됨.
- 반영(TASK-2201): ① 예약은 `AUTO_REMOTE_VERIFY_COUNT=1` 그대로 두고
  `?count=1~3`을 열었습니다. 상한 초과는 조이고 숫자가 아니면 400입니다.
  **하나라도 실패하면 실패**로 요약하고 건마다 결과를 남깁니다. ② 체크리스트
  항목 `chain-window`로 승격해 `warn`으로 드러내되 `critical: false`입니다.
  이 과정에서 **환경 검증이 해석 불가 값에 Fail Fast를 걸고 있던 결함**을
  발견해 경고로 낮췄습니다 — 결정과 정반대로 동작하고 있었습니다.
  ③ 위치를 유지하고 **순서를 테스트로 고정**했습니다(앞으로 옮기면 조용히
  exit 2가 됩니다). ④ `resolveProvisioningPolicy`로 운영에서는 버킷 생성·정책
  적용을 하지 않고, 없으면 **누가 무엇을 해야 하는지**까지 안내합니다.
  실제 전환(버킷·IAM 준비)은 운영 담당자 몫으로 남겼습니다.

### 53. TASK-2001 해석 확인 → 승인 + 관측 창 환경변수화·원격 대조 주 1회 자동·`_major_` 규칙 병행·기동 시 1회 유지·S3 전환 목표 확정 + Sprint 20 종료 (2026-07-29)
- CTO 결정: ① **백업 사슬 관측 창을 `BACKUP_CHAIN_WINDOW_HOURS`로 설정 가능하게**
  — 기본 24시간, **최소는 백업 간격 × 4** ② **원격 사본 검증은 운영에서 주 1회
  자동 수행** — **마지막 백업 1건만** 다운로드하여 SHA-256 검증 ③ **Major
  Migration은 매니페스트 방식 유지** — 추가로 **`_major_` 파일명 규칙을 지원하고
  CI에서 매니페스트와 교차 검증** ④ **자동 등록은 기동 시 1회 정책 유지** —
  운영 Runbook에 **재기동 후 자동 등록 확인 절차** 추가 ⑤ **Sprint 21에서
  Amazon S3 운영 전환을 완료 목표로** 진행 ⑥ **Sprint 20 공식 종료**
  ⑦ Sprint 21 시작 — TASK-2101(Enterprise Operational Automation) 지시됨.
- 반영(TASK-2101): ① `resolveChainWindowMs`로 구현했고, 최소에 못 미치면
  **거절하지 않고 올려서 쓰되 올렸다고 화면에 적습니다** — 조용히 다른 값으로
  도는 것이 가장 나쁩니다. 기본값 24시간조차 최소에 못 미치는 경우(일 1회
  백업)도 함께 올립니다. ② 예약 점검 `remote-verify`를 신설하고
  `PRODUCTION_ONLY_JOBS`로 운영에서만 기본 켜지게 했습니다. **결과를
  `backup_runs`에 남겨** 화면·경보가 재다운로드 없이 읽습니다. 주기의 2배를
  넘긴 성공은 통과로 두지 않고, 실패는 낡아도 실패로 둡니다. ③ 매니페스트를
  유지하면서 `_major_` 규칙을 더해 **합집합**을 쓰고,
  `pnpm check:major-migrations`(exit 0/1/**2**)와 `.github/workflows/ci.yml`을
  만들었습니다. ④ 기동 시 1회 정책을 그대로 두고
  `enterprise.drill.autoRegistration`을 노출했습니다 — **`null`은 "확인하지
  못한 것"**이고 "등록할 것이 없었다"와 구분됩니다. Runbook에 3단계 절차를
  넣었습니다. ⑤ `docs/operations/s3-migration.md`로 절차·IAM 최소 권한·완료
  판정을 제출했습니다. 실제 전환(버킷 생성·IAM 발급)은 코드가 할 수 없어
  하지 않았습니다.

### 52. TASK-1901 해석 확인 → 승인 + Major Migration 한정 자동 등록·요구 취소 전용·S3 운영 표준·성능 기준 유지·중복 등록 금지 확정 + Sprint 19 종료 (2026-07-29)
- CTO 결정: ① **`db-major-change`는 Major Migration으로 지정된 경우에만 자동
  등록** — `dr-change`와 `pitr-adoption`은 운영자가 직접 등록 ② **Requirement
  삭제 금지** — `cancelledAt`·`cancelledBy`·`cancelReason`을 추가해 **취소만
  허용** ③ **Sprint 20부터 운영 저장소 표준은 Amazon S3** — MinIO·s3rver는
  개발 전용 ④ **백업 성능 기준 유지** — 운영 DB가 10GB·50GB·100GB 규모가 되면
  **실측하여 재평가** ⑤ **같은 Trigger가 미해소 상태이면 중복 등록 금지**
  ⑥ **Sprint 19 공식 종료** ⑦ Sprint 20 시작 —
  TASK-2001(Enterprise Backup Integrity Platform) 지시됨.
- 반영(TASK-2001): ① `apps/api/prisma/major-migrations.json` 매니페스트를 두고
  기동 시 `_prisma_migrations`와 대조해 **지정된 것만** 등록합니다. 나머지 두
  Trigger는 자동 등록 경로를 만들지 않았습니다 — 코드가 알 수 없는 사건입니다.
  ② 세 컬럼을 추가하고 `cancelledBy`·`reason`을 **필수**로 두었습니다. 삭제
  API는 만들지 않았고, 취소된 요구는 화면에서도 **사유와 함께 남습니다.**
  ③ 기동 시 경고였던 것을 체크리스트 항목 `storage-standard`로 승격해 운영에서
  비-S3는 **실패**입니다. **개발에서는 개발 저장소가 정상**이라고 명시했습니다.
  ④ 기준값은 그대로 두고, `pg_database_size` 실측으로 세 임계 도달을 알립니다.
  **기준을 자동으로 바꾸는 코드는 넣지 않았습니다** — 재평가는 사람이 합니다.
  ⑤ `hasPendingTrigger`로 막고 `409`를 반환합니다. 취소·해소된 요구는 막지
  않으므로 재등록이 가능합니다.

### 51. TASK-1801 해석 확인 → 승인 + 백업 소요 기준·Drill 경보 유지·백업 버킷 보호·S3 표준·변경 Drill 확정 + Sprint 18 종료 (2026-07-29)
- CTO 결정: ① **`backup_runs.durationMs` 기준** — 2초 미만 정상 / 2~10초
  Warning / 10초 초과 **3회 연속** Alert / 30초 초과 Critical, **자동 간격 변경
  없음** ② **Recovery Drill은 경보만** — 배포 게이트 미포함 ③ **Backup Bucket도
  Image Bucket과 동일하게 Protection Checklist에 포함** ④ **운영 저장소 표준은
  Amazon S3** — MinIO·s3rver는 개발 전용 ⑤ **Recovery Drill 기본 90일 유지**,
  단 **DR 변경 · DB 대규모 변경 · PITR 도입 시 즉시 추가 Drill**을 운영 규칙으로
  추가 ⑥ **Sprint 18 공식 종료** ⑦ Sprint 19 시작 —
  TASK-1901(Enterprise Recovery Assurance) 지시됨.
- 반영(TASK-1901): ① `judgeBackupPerformance`로 기준을 그대로 구현했고, 주의
  단계는 **경보하지 않습니다**(화면에만 드러냅니다). 자동 간격 변경 코드는 넣지
  않았고 심각 문구에 "자동으로 바꾸지 않습니다"라고 적었습니다. ② 배포
  체크리스트에 리허설·백업 성능 항목이 **없음을 회귀 테스트로 고정**했습니다.
  ③ 같은 판정 함수를 라벨만 달리해 두 버킷에 적용했습니다. ④ 운영에서
  `S3_ENDPOINT`가 `*.amazonaws.com`이 아니면 경고하고, 문구에 "MinIO·s3rver는
  개발 전용"임을 명시했습니다. ⑤ `drill_requirements`와
  `POST /ops/drills/require`를 만들어 **변경 사건이 주기를 앞지르도록** 했고,
  **성공한 리허설만 요구를 해소**합니다.

### 50. TASK-1701 해석 확인 → 승인 + 백업 주기 1시간·버킷 분리·Versioning 필수·Drill 표준 확정 + Sprint 17 종료 (2026-07-29)
- CTO 결정: ① **기본 백업 주기를 1시간으로 변경** ② **Offsite Backup은 이미지
  버킷과 분리된 Backup Bucket을 기본 구조로 변경** ③ **Versioning은 운영 필수,
  Replication은 운영 권장** — 조회가 불가능한 저장소는 manual 정책 유지
  ④ **원격 사본 자동 다운로드 검증은 Sprint 18 이후 검토** ⑤ **분기 1회
  Recovery Drill을 운영 표준으로 채택** ⑥ **Sprint 17 공식 종료** ⑦ Sprint 18
  시작 — TASK-1801(Enterprise Operations Platform) 지시됨.
- 반영(TASK-1801): ① `backup`을 시각 기반에서 간격 기반으로 바꾸고 기본 1시간을
  적용했습니다. **손실 한도 목표를 간격에서 파생**시켜(간격 × 2) 설정과 판정이
  어긋날 수 없게 했고, 구 `OPS_CHECK_BACKUP_AT`이 남아 있으면 경고합니다.
  ② `BACKUP_BUCKET`으로 분리하고 **백업 버킷에는 공개 읽기 정책을 걸지
  않습니다**. 라이브에서 `acos-backups`가 따로 생성되는 것을 확인했습니다.
  ③ `judgeStorageProtection`에 운영 여부를 넘겨 Versioning 꺼짐은 운영에서
  `fail`, Replication은 `warn`으로 두고, **조회 불가는 운영에서도 `manual`을
  유지**했습니다. ④ 구현하지 않았습니다. ⑤ `recovery_drills` 테이블과
  `POST /ops/drills`를 만들고 체크리스트·경보에 편입했습니다. **리허설 자체는
  자동화하지 않았습니다** — 사람이 하고 시스템은 기록과 노출만 합니다.

### 49. TASK-1601 해석 확인 → 승인 + BACKUP_DIR 필수·복원 DB 분리·백업 방식 검토·저장소 보호·신선도 확정 + Sprint 16 종료 (2026-07-29)
- CTO 결정: ① **운영에서 BACKUP_DIR을 필수 설정으로 승격** — 미설정 시 Fail
  Fast로 기동 차단 ② **Restore Verification은 운영 DB가 아닌 별도 Restore DB
  에서만 수행** ③ **현재는 전체 백업 유지** — Sprint 17에서 WAL Archive · PITR ·
  Incremental Backup 도입 여부 검토 ④ **이미지 저장소의 Versioning·Replication
  상태를 Disaster Recovery Checklist에 포함** — 애플리케이션이 직접 이미지
  백업은 수행하지 않음 ⑤ **백업 신선도 기본값 유지** — Backup 2일 / Restore
  Verification 8일 ⑥ **Sprint 16 공식 종료** ⑦ Sprint 17 시작 —
  TASK-1701(Enterprise Backup & Disaster Recovery) 지시됨.
- 반영(TASK-1701): ① `BACKUP_DIR`을 `requiredInProduction`으로 올렸고, 라이브에서
  미설정 운영 기동이 `환경 오류 [BACKUP_DIR]`로 차단되는 것을 확인했습니다.
  ② 호스트·포트·DB 이름을 비교하는 교차 검사를 환경 검증에 넣어 **기동 자체를
  막고**(개발 환경에서도), 실행 직전에도 한 번 더 봅니다 — 자격 증명만 다른 같은
  DB도 같은 DB로 봅니다. ③ 구현하지 않고 `docs/operations/backup-strategy.md`로
  검토 결과를 제출했습니다 — **백업 주기 단축을 먼저 권고**하며, PITR은 복구를
  더 어렵게 만들어 리허설 절차가 정착한 뒤에 도입해야 한다고 판단했습니다.
  ④ `StorageService.describeProtection()`으로 버킷 상태를 읽어 체크리스트 항목을
  추가했고, 저장소가 알려 주지 않으면 `직접 확인`으로 남깁니다. 앱은 이미지를
  백업하지 않는다는 점을 화면 문구에 명시했습니다. ⑤ 2일·8일을 기본값으로 두고
  `BACKUP_MAX_AGE_HOURS`·`RESTORE_MAX_AGE_HOURS`로 조정 가능하게 하되, **기본값을
  회귀 테스트로 고정**했습니다.

### 48. TASK-1501 해석 확인 → 승인 + 로컬 시간대·Redis 장애 범위·DLQ 보관·Job별 여유 배수 확정 + Sprint 15 종료 (2026-07-29)
- CTO 결정: ① **Archive Scheduler는 매일 04:00 운영 서버 Local Time Zone** —
  기본은 `TZ` 환경변수를 따름 ② **Redis 장애 시 LLM 호출은 계속 허용** —
  Scheduler만 중단하고, **30분 이상 지속되면 Critical Alert를 반복 발생**
  ③ **Dead Letter는 삭제하지 않고 90일 후 Archive** ④ **Scheduler Grace Factor
  기본 3배 유지** — 환경변수로 **Job별 조정 가능**하게 유지 ⑤ **Sprint 15 공식
  종료** ⑥ Sprint 16 시작 — TASK-1601(Production Verification & Operational
  Readiness) 지시됨.
- 반영(TASK-1601): ① 일 1회 점검 4종(`alert-archive`·`backup`·`restore-verify`·
  `provider-smoke`)의 판정을 UTC 자정에서 **로컬 자정 기준**으로 바꿨습니다.
  기동 로그·화면이 여전히 "UTC"라고 표시하던 것을 라이브 검증에서 발견해
  시간대까지 표기하도록 고쳤습니다(상태와 설명이 어긋나면 안 됩니다).
  ② `detectLockOutageAlert`와 `OPS_LOCK_OUTAGE_THRESHOLD_MS`(기본 30분)를
  추가하고, 라이브에서 **Redis를 내린 채 LLM 호출이 HTTP 200으로 성공**하며
  예약 점검만 멈추고 Critical 경보가 발생함을 확인했습니다. 문구는 "비용은
  나가는데 비용 점검은 멈춘 상태"라고 사실대로 적습니다. ③
  `NotificationQueueStatus.ARCHIVED`를 추가하고 `alert-archive` 점검이 경보와
  Dead Letter를 **함께** 보관하도록 했습니다(둘 다 삭제하지 않습니다).
  ④ `resolveGraceFactor`가 **종류별(`OPS_SCHEDULER_GRACE_<JOB>`) ?? 전체 ?? 3**
  순으로 결정합니다.

### 47. TASK-1401 해석 확인 → 승인 + 폴백 금지·큐·보관 예약화·채널 정책 확정 + Sprint 14 종료 (2026-07-29)
- CTO 결정: ① **Redis 장애 시 단일 모드로 자동 폴백하지 않음** — 대신
  Scheduler Stopped Alert 구현 ② **Persistent Notification Queue 구현** —
  Retry Worker와 Dead Letter Queue 포함 ③ **Archive는 Scheduler에 편입** —
  기본 하루 1회 새벽 실행 ④ **운영 기본 채널 정책** — Slack Warning 이상 /
  Email Critical 이상 / Webhook Warning 이상 / Resolve 알림 포함, 환경변수로
  변경 가능하게 유지 ⑤ **Sprint 14 공식 종료** ⑥ Sprint 15 시작 —
  TASK-1501(High Availability & Operations Reliability) 지시됨.
- 반영(TASK-1501): ① 폴백 코드를 넣지 않고 `lockHealthy`를 감시자에 넘겨 원인까지
  적는 critical 경보를 만들었습니다. 감시자는 **잠금 없이** 돕니다(잠금이 죽어도
  알려야 하므로). ② `notification_queue` 테이블과 리더 전용 워커 — 라이브에서
  **재시작 생존**을 확인했습니다. ③ `alert-archive` 점검으로 편입, 기본
  04:00 **UTC**(시간대는 위 질문 ①에서 확인 요청). 시각 기반을 표현하려고
  스케줄러를 단일 티커로 재구성했습니다. ④ core `DEFAULT_CHANNEL_POLICY`로
  선언하고 환경변수가 우선하게 했습니다. ⑥ 4개 결정 전부 구현 완료 (#48 참고).

### 46. TASK-1302 해석 확인 → 승인 + Alert 정책·다중 인스턴스·게이트·보관 확정 + Sprint 13 종료 (2026-07-29)
- CTO 결정: ① **Alert 정책(Cooldown 30분 / Resolve 알림 / Severity 상승 즉시
  알림 / unknown 경보 제외)을 공식 표준으로 유지** — 종류별 Cooldown은 환경변수
  확장을 허용 ② **다중 인스턴스는 현재 중복 실행 구조 유지**, Redis Distributed
  Lock은 다음 Sprint에서 구현 ③ **운영 환경에서는 `GATE_STRICT=ON`·
  `GATE_ALERTS=ON`을 기본값으로** 사용 ④ **Alert는 삭제하지 않음** — Resolve 후
  90일 보관 후 Archive 정책을 다음 Sprint에서 구현 ⑤ **Sprint 13 공식 종료**
  ⑥ Sprint 14 시작 — TASK-1401(Production Operations Platform) 지시됨 —
  Distributed Scheduler / Redis Leader Election / Distributed Lock /
  Notification Center / Alert History / Alert Archive / Slack / Email /
  Webhook Retry.
- 반영(TASK-1401): ① 4개 정책 그대로 유지하고 종류별 환경변수만 추가
  (`종류별 ?? 전체 기본 ?? 30분`). ② Redis 임차 기반 리더 선출 구현 —
  `REDIS_URL` 미설정 시 기존 동작(단일 모드) 그대로라 회귀가 없습니다.
  ③ `NODE_ENV=production`(또는 `GATE_ENV`)이면 두 옵션 기본 ON, 끄려면 명시적
  `=0`. ④ `ARCHIVED` 상태·`archivedAt` 추가, 활성 경보는 절대 보관하지 않음.
  자동 실행 주기는 지시되지 않아 수동 트리거로 두고 확인 항목으로 올립니다.
  ⑥ 9항목 구현 완료 (#47 참고).

### 45. TASK-1301 해석 확인 → 승인 + Live Check·모니터링 기준·진단 분리 확정 (2026-07-29)
- CTO 결정: ① **Live Check는 기본 실행하지 않고** 운영자가 명시적으로 실행하도록
  유지 ② **모니터링 기본값(Healthy 95% / Degraded 50% / 최소 표본 5 / p95 20초)
  유지** — 향후 환경변수로 조정 가능하도록 설계 ③ **Health Check와 Live Check는
  운영 통계에서 분리** — **Feature를 추가하지 말고 Execution 메타데이터 기반으로**
  구현 ④ **Cost Verification은 현재 수동 실행 유지** — 다음 Sprint에서 Scheduler
  추가 ⑤ **Unpriced 모델은 Alert 대상으로 유지**하고 호출 차단은 하지 않음
  ⑥ TASK-1302(Production Automation & Alerting) 지시됨 — Scheduled Cost
  Verification / Provider Validation / Health Check · Budget · Provider Failure ·
  Unpriced Model · Configuration Alert · CI/CD Deployment Gate.
- 반영(TASK-1302): ① 현행 유지 확정 + **예약 점검도 Live Check를 하지 않도록**
  명시적으로 구현(자동 과금 방지). ② `LLM_MONITOR_*` 4종으로 조정 가능하게 하고
  확정 기본값을 미설정 시 그대로 사용. 순서가 뒤집힌 기준은 기본값으로 되돌림.
  ③ `executions.diagnostic` 메타데이터 한 칸으로 구분(마이그레이션 26) —
  **feature 4종은 그대로**. 모니터링에서 제외하되 `diagnosticCalls`로 표시해
  숨기지 않음. ④ 수동 실행 경로를 그대로 두고 예약 실행을 얹음. ⑤ 그대로
  구현하고 경보 문구에 "차단하지 않습니다"를 명시. ⑥ 8항목 구현 완료 (#46 참고).

### 44. TASK-1202 해석 확인 → 승인 + Fail Fast·운영 필수 항목 확정 + Sprint 12 종료 (2026-07-28)
- CTO 결정: ① **운영 환경에서 필수 설정 오류가 있으면 서버는 기동하지 않는다
  (Fail Fast)** ② **운영 필수 항목은 `WEB_URL` / `DATABASE_URL` / Storage(S3) /
  `AUTH_ADMIN_EMAIL` / `AUTH_ADMIN_PASSWORD`** 를 공식 표준으로 유지하되,
  **실제 AI Provider 연결 시 Provider API Key를 추가** ③ **실 Provider Smoke
  Test와 Backup 확인은 Manual Check 유지** ④ **다음 Sprint에서 CI/CD가
  `/health/ready`를 호출해 배포 가능 여부를 자동 판정** ⑤ **Sprint 12 공식
  종료** ⑥ Sprint 13 시작 — TASK-1301(Real AI Provider Production Integration)
  지시됨 — OpenAI / Anthropic / Gemini / Vision Production · API Key Validation ·
  Provider Smoke Test · Cost Verification · Production Monitoring.
- 반영(TASK-1301): ①③ 현행 유지 — 변경 없이 확정. ②의 Provider API Key 추가는
  **조건부 필수**(`requiredWhen`)로 구현했습니다 — 설정에서 참조하는 Provider의
  키만 운영 필수가 되고, 쓰지 않는 Provider의 키는 계속 불필요합니다. 형식
  검사도 함께 걸어 플레이스홀더·잘못된 접두사를 기동 전에 막습니다.
  ④는 이번 Sprint 범위가 아니므로 착수하지 않았습니다(다음 지시 대기).
  ⑥ 8항목 구현 완료 (#45 참고).

### 43. TASK-1201 해석 확인 → 승인 + 설정 우선순위·전파·권한 확정 (2026-07-28)
- CTO 결정: ① **설정 우선순위는 DB Override → Environment Variable → Default**를
  공식 표준으로 확정 — **Code-first 원칙 유지** ② **다중 인스턴스 전파는 현재
  TTL 기반 구조 유지** — Redis Pub/Sub는 후속 Sprint에서 검토
  ③ **Routing 규칙(`LLM_ROUTE_*`)은 현재 Sprint 범위에 포함하지 않음**
  ④ **배포 시 Override는 자동 삭제하지 않고** 운영자가 명시적으로 해제
  ⑤ **`/admin/*`(Console·Audit)의 모든 조회와 변경은 ADMIN 인증 요구**
  ⑥ TASK-1202(Production Readiness & Deployment) 지시됨 — Environment
  Validation / Startup Validation / Deployment Checklist / Configuration
  Verification / Health Dashboard / Production Runbook / Recovery Guide.
- 반영(TASK-1202): ①③④⑤ 현행 유지 — 변경 없이 확정. ②의 `ADMIN_SETTINGS_TTL_MS`를
  환경 선언에 등록해 대시보드·런북에서 보이게 함. ④는 복구 가이드의 "설정이
  반영되지 않을 때" 절차로 명시. ⑤와 같은 기준을 `/health/ready`에도 적용.
  ⑥ 7항목 구현 완료 (#44 참고).

### 42. TASK-1102 해석 확인 → 승인 + 분석 표준 확정 + Sprint 11 종료 (2026-07-28)
- CTO 결정: ① **최소 표본은 기본 30회 유지** — 향후 환경변수로 조정 가능하도록
  설계 ② **추천 우선순위는 성공률 → 호출당 비용 → 평균 지연**을 공식 표준으로
  확정 ③ **관측 기간은 START/STOP에서는 유지하고 Definition Signature 변경
  시에만 초기화** ④ **다중 비교 보정은 현재 도입하지 않음**
  ⑤ **Sprint 11 공식 종료** ⑥ Sprint 12 시작 — TASK-1201(Provider
  Administration Console) 지시됨 — Provider Enable/Disable / Model
  Management / Budget Management / Experiment Management / Audit Log.
- 반영(TASK-1201): ① `LLM_EXPERIMENT_MIN_SAMPLES`로 조정 가능(미설정 시 30).
  ② ④ 현행 유지 — 변경 없이 확정. ③ `experiment_states`에 `signature`·
  `signatureChangedAt`를 두고 정의가 바뀔 때만 초기화하도록 변경(마이그레이션
  24) — 지난 보고에서 올린 운영상 불편이 해소됨. ⑥ 5항목 구현 완료 (#43 참고).

### 41. TASK-1101 해석 확인 → 승인 + 기본 상태·배정 주체·권한·Audit 확정 (2026-07-28)
- CTO 결정: ① **상태 레코드가 없으면 RUNNING을 기본 상태로 유지**
  ② **Sticky Assignment는 Project 기반을 공식 표준으로 확정**
  ③ **Winner Promotion은 운영자 수동 절차 유지** ④ **권한 변경** —
  Start/Stop은 EDITOR 이상, **Promote/Rollback은 ADMIN 전용**
  ⑤ **정의 변경으로 재배정이 발생하면 Audit 이력을 남길 것**
  ⑥ TASK-1102(Experiment Analytics & Recommendation) 지시됨 — Variant
  Performance Summary / Success Rate·Latency·Cost Comparison / Winner
  Recommendation / Confidence Score / Analytics Dashboard.
- 반영(TASK-1102): ①②③ 현행 유지 — 변경 없이 확정(승격은 수동이므로 분석은
  근거 제공에 집중). ④ `@RequireRole("ADMIN")`으로 승격·되돌리기를 분리하고
  4개 명시 라우트로 구성. ⑤ `experiment_assignment_events` 신설(마이그레이션
  23) — 사유·이전/이후 변형·서명 기록, 대시보드 표시. ⑥ 7항목 구현 완료
  (#42 참고).

### 40. TASK-1003 해석 확인 → 승인 + 실험 표준 확정 + Sprint 10 종료 (2026-07-28)
- CTO 결정: ① **`unknown` 오류는 Failover 대상이 아님** — 현재 정책을 공식
  표준으로 확정 ② **실험 표기법은 `이름|종류|변형=가중치` 단일 형식 유지**
  ③ **종류(kind)는 운영 메타데이터이며 Routing 알고리즘에 영향을 주지 않음**
  ④ **배정과 실제 실행은 분리** — Assignment는 실험 결과, Execution은 실제
  수행 결과이며 Dashboard에 두 정보를 모두 유지 ⑤ **Sprint 10 공식 종료**
  ⑥ Sprint 11 시작 — TASK-1101(Sticky Assignment & Experiment Lifecycle)
  지시됨 — Project 기반 Sticky Assignment / Experiment Start·Stop /
  Winner Promotion / Rollback / Assignment Dashboard.
- 반영(TASK-1101): ①② 현행 유지 — 변경 없이 확정. ③ 배정 서명에서 kind·이름을
  제외해 "표시용"임을 코드로 못박음. ④ 배정을 `experiment_assignments`에
  따로 저장하고 실행 지표(`byVariant`)와 나란히 표시. ⑥ 5항목 구현 완료
  (#41 참고).

### 39. TASK-1002 해석 확인 → 승인 + 오류 분류·모델 승계·Health 표준 확정 (2026-07-28)
- CTO 결정: ① **Failover 대상 오류 확정** — Timeout · Provider 5xx ·
  Provider Rate Limit · 일시적 네트워크 오류. **제외** — Budget 초과 ·
  Validation 오류 · 인증 오류(401/403) · 잘못된 API Key · 잘못된 요청
  ② **Failover 시 전환된 Provider의 기본 모델 사용** — 현재 정책 유지
  ③ **Health 기본값 공식 표준 확정** — 연속 실패 3회 · Cooldown 60초 ·
  Half-open ④ **`GET /llm/health` 호출을 Failover 운영 계측(attempts,
  failovers, exhausted)에서 분리** ⑤ TASK-1003(Routing Experiment & Traffic
  Control) 지시됨 — Percentage / A·B / Canary / Weighted Routing +
  Experiment Dashboard.
- 반영(TASK-1003): ① `classifyFailoverError()`로 분류 규칙을 명시화하고
  대상 4종만 전환하도록 좁힘(미분류는 안전 측 제외 — #40 ①에 확인 요청).
  ② ③ 현행 구현과 일치 — 변경 없이 확정. ④ 진단 호출을 운영 계측에서 분리하고
  `metrics.healthChecks`로 별도 집계(건강 상태 반영은 유지). ⑤ 5항목 구현
  완료 (#40 참고).

### 38. TASK-1001 해석 확인 → 승인 + Routing 단위·Fallback·이력 Provider 확정 (2026-07-28)
- CTO 결정: ① **Routing 단위는 Feature 3종(Content / Analysis / Vision)을
  공식 표준으로 확정** — 프로젝트별·사용자별 Routing은 후속 Sprint
  ② **Fallback 정책은 설정 해석 시 기본 Provider 자동 전환을 유지** —
  실행 중 오류는 Failover 대상이며 Fallback 범위에 포함하지 않음
  ③ **이력 Provider 필드(`AnalysisRun.provider` 등)는 실제 Routing된
  Provider를 기록하도록 변경** — Execution과 동일한 의미로 통일
  ④ TASK-1002(Provider Failover Engine) 지시됨 — Provider Priority /
  Retry Policy / Timeout Policy / Health Check Integration / Failover
  Metrics, **Budget 초과와 Validation 오류는 Failover 대상 아님**.
- 반영(TASK-1002): ①② 현행 구현과 일치 — 변경 없이 확정하고, 실행 중 전환은
  Failover 계층으로 분리 구현. ③ `AnalysisRecognition.providerName` 신설로
  실제 호출 Provider를 이력에 기록(과거 이력 소급 변경 없음). ④ 5항목 구현
  완료 (#39 참고).

### 37. TASK-0903 해석 확인 → 승인 + JSON 방식·가격표 확정 + Sprint 9 종료 (2026-07-28)
- CTO 결정: ① **Anthropic JSON은 System Prompt + JSON Parsing + Retry
  방식을 공식 표준으로 확정** — Structured Output API는 추후 별도 Sprint
  에서 검토 ② **가격표는 공식 운영 모델만 등록** — Preview 모델은 제외
  ③ **Sprint 9 공식 종료** ④ Sprint 10 시작 — TASK-1001(Cross-Provider
  Routing Engine) 지시됨 (Provider Failover는 범위 제외).
- 반영(`03dca0f`): ①② 현행 구현과 일치 — 변경 없이 확정. Cross-Provider
  Routing Engine 구현 (#38 참고).

### 36. TASK-0902 해석 확인 → 승인 + 예산 표준·라우팅 범위 확정 (2026-07-28)
- CTO 결정: ① **예산 정책 공식 표준 확정** — 80% = Alert, 100% 초과 = 429
  차단 (현재 정책 유지) ② **Model Routing은 현재 Provider 내부 모델 선택만
  지원** — Cross-Provider Routing은 Anthropic/Gemini 공식 연결 이후 구현
  ③ **Budget은 환경변수(Code-first) 유지** — ADMIN 화면 관리 기능은 후속
  Sprint ④ TASK-0903(Anthropic & Gemini Provider Integration) 지시됨.
- 반영(`f9cbda5`): ①③ 현행 확정, ②의 전제인 3사 공식 연결 완료 —
  Cross-Provider Routing은 다음 지시 대기 (#37 참고).

### 35. TASK-0901 해석 확인 → 승인 + 운영 표준·스모크 정책 확정 (2026-07-28)
- CTO 결정: ① **출력 상한 공식 표준 확정** — Content Generation 4096 ·
  Product Analysis 2048 · Vision Analysis 2048 (환경변수 기반 조정 구조
  유지) ② **JSON 출력은 finish_reason=length 시 FAILED 처리, Text 출력은
  부분 결과 허용** ③ **실 Provider Smoke 정책 확정** — 운영/스테이징 배포
  직후 1회 필수 · 모델 변경 시 재실행 · 인증/쿠키 변경 시 재실행, 현재
  런북·스크립트를 공식 운영 절차로 사용 ④ TASK-0902(Cost Governance &
  Multi-Provider Foundation) 지시됨.
- 반영(`5b39867`): 전 항목 현행 구현과 일치 — 변경 없이 확정. 비용
  거버넌스·Provider Registry 구현 (#36 참고).

### 34. TASK-0804 해석 확인 → 승인 + 보안 표준 확정 + Sprint 8 종료 (2026-07-28)
- CTO 결정: ① **기본 로그인 보안 정책 공식 표준 확정** — Rate Limit
  30회/60초 · Lockout 5회 실패→15분 · Password 최소 8자+영문+숫자
  (환경변수 기반 조정 구조 유지) ② **Rate Limit 인메모리 유지** — 다중
  인스턴스 운영 시 Redis 기반 확장 ③ **별도 Unlock 버튼 미구현** —
  ADMIN Password Reset이 잠금 해제 절차 ④ **Idle Timeout 미구현** —
  Absolute Session TTL만 유지 ⑤ **Sprint 8 공식 종료** ⑥ Sprint 9 시작 —
  TASK-0901(Real Provider Integration — OpenAI Production) 지시됨.
- 반영(`8d095e3`): 전 항목 현행 구현과 일치 — 변경 없이 확정. OpenAI
  Production 구현 (#35 참고).

### 33. TASK-0803 해석 확인 → 승인 + 쿠키/재설정 정책 확정 (2026-07-28)
- CTO 결정: ① **개발 환경은 본문 토큰 + httpOnly 쿠키 병행 발급 유지,
  운영 환경은 쿠키 전용으로 전환** ② **Password Reset은 현재 ADMIN 직접
  지정 방식 유지** — 메일 기반 재설정은 메일 인프라 도입 이후 구현
  ③ TASK-0804(Login Protection & Security Hardening) 지시됨.
- 반영(`5ce8a20`): ① 쿠키 전용 운영 모드(AUTH_COOKIE_ONLY — 운영/스테이징
  기본 켜짐, 본문 토큰 제외) 구현, 웹 credentials 대응 (#34 참고).

### 32. TASK-0802 해석 확인 → 승인 + 보호 정책 확정 (2026-07-28)
- CTO 결정: ① **@Public 예외는 Login · Company Brain Query · READY
  Validation 3개만 유지** — 새로운 Write API는 기본적으로 보호
  ② **기본 권한 정책 유지** — Write=EDITOR 이상 · User Management=ADMIN ·
  Logout=VIEWER 이상 · GET=현재 정책 유지 ③ **/llm/health는 운영/스테이징
  에서 EDITOR 이상 인증 요구** — 개발 환경은 비보호 유지 가능
  ④ TASK-0803(Password Management & Operational Security) 지시됨.
- 반영(`40bd4d7`): ③ health 보호 가드 구현(NODE_ENV/AUTH_PROTECT_HEALTH
  판정), ①②는 현행 유지 확정 — 비밀번호/쿠키 구현 (#33 참고).

### 31. TASK-0801 해석 확인 → 승인 + 인증 정책 확정 (2026-07-28)
- CTO 결정: ① **인증 적용 범위 현재 구조 유지** — Foundation 단계는 발행
  전이·사용자 관리만 강제, 조회 API·생성 파이프라인은 유지 (→ 전면 확대는
  TASK-0802로 지시됨) ② **역할 ADMIN/EDITOR/VIEWER 3종 공식 표준**
  ③ **토큰: 개발은 localStorage 유지, 운영 전환 시 httpOnly Cookie ·
  Secure Cookie · SameSite 적용** ④ TASK-0802(User Management UI & Full
  Write Protection) 지시됨.
- 반영(`3383e12`): 전면 쓰기 보호 + 사용자 관리 구현 (#32 참고). 운영 쿠키
  전환은 배포 도메인 확정 시 구현 항목으로 백로그 유지.

### 30. TASK-0704 해석 확인 → 승인 + Audit 표준 확정 + Sprint 7 종료 (2026-07-28)
- CTO 결정: ① **Audit History는 From/To/Timestamp만 기록하는 현 구조를
  공식 표준으로 유지 — Actor는 인증 시스템 도입 이후 추가**
  ② **Publishing UI는 프로젝트 상세 화면에 유지** ③ **Sprint 7 공식 종료**
  ④ Sprint 8 시작 — TASK-0801(Authentication & Authorization Foundation)
  지시됨.
- 반영(`400b4ae`): 인증 도입과 함께 Actor Audit 이행 (#31 참고).

### 29. TASK-0703 해석 확인 → 승인 + 발행 표준 확정 (2026-07-28)
- CTO 결정: ① **발행 상태 전이를 공식 표준으로 유지** — DRAFT→REVIEW,
  REVIEW→DRAFT, REVIEW→PUBLISHED, DRAFT/REVIEW/PUBLISHED→ARCHIVED,
  ARCHIVED는 종결 ② **publishedAt은 최초 발행 시점 보존** — ARCHIVED
  이후에도 유지 ③ **실키 스모크는 운영/스테이징 전용** — 개발 환경은
  mock 리허설만 ④ TASK-0704(Publishing Web UI & Audit History) 지시됨.
- 반영(`dcc4817`): publishedAt 최초 시점 보존 코드 반영, 발행 UI·감사
  이력 구현 (#30 참고).

### 28. TASK-0702 해석 확인 → 승인 + 게이트/정책 확정 (2026-07-28)
- CTO 결정: ① **stats의 feature/provider/model 필터를 공식 API로 유지**
  ② **hour 정책 확정** — 최근 31일 기본 창 + 31일 초과 400 ③ **Provider/
  Model 자유 입력 유지** — 자동완성은 후속 Sprint ④ **Playwright는 공식
  품질 게이트 — 모든 Web 기능은 Playwright를 통과해야 함**
  ⑤ TASK-0703(Real Provider Smoke & Publishing Pipeline) 지시됨.
- 반영(`1c28a52`): 현행 구현 확정 (#29 참고).

### 27. TASK-0701 해석 확인 → 승인 + Dashboard 확장 지시 (2026-07-28)
- CTO 결정: ① **CSS 기반 차트 구조 유지 — 외부 차트 라이브러리 미도입**
  ② **Dashboard Filter 추가** (Feature/Provider/Model/From/To)
  ③ **hour 조회 최대 31일 제한** ④ **Playwright를 CI 품질 게이트에 포함** —
  Dashboard/Empty/Error 스모크 ⑤ TASK-0702(Dashboard Filter & Web Testing)
  지시됨.
- 반영(`1f9ab8b`): ②③④ 전부 구현 (#28 참고).

### 26. TASK-0605 해석 확인 → 승인 + Timeline 표준 확정 + Sprint 6 종료 (2026-07-28)
- CTO 결정: ① **UTC · ISO Week · hour/day/week 구조를 공식 표준으로 유지**
  ② **빈 버킷은 API가 생성하지 않음 — UI에서 보간** ③ **hour 조회 기간
  제한은 다음 Sprint 추가** ④ **Sprint 6 공식 종료** ⑤ Sprint 7 시작 —
  TASK-0701(Execution Dashboard Web UI) 지시됨.
- 반영(`eb202c6`): 대시보드 화면 구현 — % 변환·빈 버킷 보간을 UI에서 수행
  (#27 참고).

### 25. TASK-0604 해석 확인 → 승인 + 정책 확정 (2026-07-28)
- CTO 결정: ① **Image Guard 기본 정책 유지** — 원본 20MB · 최대 변 1024px ·
  출력 5MB · JPEG q82 ② **위반 이미지는 스킵 후 계속 진행 유지**
  ③ **업로드 원본 무변경 — 전처리는 호출 시점에만 수행**
  ④ TASK-0605(Execution Timeline) 지시됨.
- 반영(`7dbb42c`): 현행 구현 확정, Timeline 구현 (#26 참고).

### 24. TASK-0603 해석 확인 → 승인 + 실키 검증 환경 확정 (2026-07-28)
- CTO 결정: ① **가격표 Code-first 유지** — gpt-4o/gpt-4o-mini 단가·접두사
  매칭·cost=null 정책 확정 ② **responseFormat json_object 매핑 공식 구현
  유지** ③ **Health Check(실 ping 호출 + Execution 기록) 구조 유지**
  ④ **실키 검증은 운영/스테이징 환경에서 수행** — 개발 환경 egress 제한은
  구현 문제 아님 ⑤ TASK-0604(Image Guard & Preprocessing) 지시됨.
- 반영(`6c00dfb`): 현행 구현 확정, 이미지 가드 구현 (#25 참고).

### 23. TASK-0602 해석 확인 → 승인 + Dashboard 로드맵 확정 (2026-07-28)
- CTO 결정: ① **지표 구성 현행 유지** ② **성공률/실패율은 API에서 0~1 값
  반환, %는 UI에서 표시** ③ **from/to 기간 필터 공식 API 채택**
  ④ **Dashboard 화면은 다음 Sprint 구현** ⑤ **일별 시계열은 Sprint 6 후반
  추가** ⑥ TASK-0603(Provider Integration — OpenAI 우선) 지시됨.
- 반영: 현행 구현과 일치 — 변경 없이 확정. 화면·시계열은 백로그 기록.

### 22. TASK-0601 해석 확인 → 승인 + 6항 결정 확정 (2026-07-28)
- CTO 결정: ① **feature 4종 유지**(content-generation/product-analysis/
  vision-analysis/dev) ② **400 Validation Error는 Execution 비생성**
  ③ **Prompt/Response 본문 비저장 — 운영 지표만 기록** ④ **LLM 가격표
  Code-first 중앙 정의 유지, 미등록 모델 cost=null 유지** ⑤ **FK 없는
  독립 도메인 유지** ⑥ TASK-0602(Execution Dashboard) 지시됨.
- 반영: 전 항목 현행 구현과 일치 — 변경 없이 확정. 실모델 공식 단가
  스펙은 확정 시 가격표(DEFAULT_LLM_PRICING) 1곳에 추가하면 됨 (요청 유지).

### 21. TASK-0506 해석 확인 → 승인 + Sprint 5 공식 종료 (2026-07-28)
- CTO 결정: ① **EngineContentGenerator의 apps/api Wrapper 구조 유지**
  ② **CONTENT_GENERATOR 환경변수 제거 상태 유지** — LLM_PROVIDER 하나만 사용
  ③ **Deprecated Generator는 Sprint 6 이후 제거 검토 대상** — 현재는 Wrapper만
  유지 ④ **Sprint 5 공식 종료** ⑤ Sprint 6 시작 — TASK-0601(Execution
  Domain) 지시됨.
- 반영(`fcbf6ce`): TASKS.md에 Sprint 5 종료 기록, Execution Domain 구현
  (#22 참고).

### 20. TASK-0505 해석 확인 → 승인 + 상한 환경변수화 지시 (2026-07-28)
- CTO 결정: ① **최대 이미지 수 제한 유지 + 환경변수로 관리 가능하게 개선**
  ② Mock JSON Echo 전략을 **Vision에도 공식 적용** ③ **VISION_PROVIDER 제거
  상태 유지** — LLM_PROVIDER 하나만 사용 ④ **이미지 용량 제한·리사이즈는
  실제 Provider 연결 전에 구현** ⑤ 구 Generator 통합은 TASK-0506으로 지시됨.
- 반영(`574523a`): `VISION_MAX_IMAGES` 환경 변수화(기본 5장), ④는 실연결 전
  구현 항목으로 백로그 기록.

### 19. TASK-0504 해석 확인 → 승인 + Mock 전략 확정 (2026-07-28)
- CTO 결정: ① **Mock JSON Echo(초안 반환)를 공식 Mock 전략으로 유지**
  ② **responseFormat(text/json) 유지** — 실제 Provider 연결 시 Provider별
  구조화 출력으로 매핑 ③ **ANALYSIS_PROVIDER 제거 상태 유지** —
  LLM_PROVIDER 하나만 사용 ④ Vision(이미지) 입력은 TASK-0505(Vision
  Multimodal Integration)로 지시됨.
- 반영(`d63a975`): 결정 사항 docs/architecture/llm.md에 명문화, Vision에
  동일 Mock 전략 적용 (#20 참고).

### 18. TASK-0503 해석 확인 → 승인 + Code-first 확정 (2026-07-28)
- CTO 결정: ① Prompt Template은 **Code-first 유지** — DB 관리 기능 미구현
  ② Template Version은 이번 Sprint 미구현 ③ **다음 확장 대상은 Analysis**
  → TASK-0504(Analysis Engine Integration)로 지시됨.
- 반영(`74e9fbb`): `product-analysis` 템플릿 추가로 공용 설계 실증 (#19 참고).

### 17. TASK-0502 해석 확인 → 승인 + 공식 엔진 확정 (2026-07-27)
- CTO 결정: ① Content Generation Engine이 **공식 생성 엔진**
  ② 구 Mock Generator는 **Deprecated** — 다음 Sprint에서 내부적으로
  새 엔진을 호출하도록 통합 ③ **웹 상세페이지 생성 버튼은 새 엔진 사용**
  ④ Company Brain 검색은 상품 제목 기준 유지 — 향후 브랜드/카테고리/
  OCR/Vision으로 확장.
- 반영(`9f44b87`): 웹 버튼 `/contents/generate` 전환(브라우저 클릭 검증),
  구 경로·Port에 @deprecated 표시 및 문서 갱신.

### 16. TASK-0501 해석 확인 → 승인 (2026-07-27)
- CTO 결정: ① 기본 모델은 **환경변수로만 관리** ② `/llm/complete`는
  **개발용 API로 유지** — 운영에서는 내부 서비스만 사용 ③ LLM 호출
  이력·비용은 이번 Sprint 미구현, **별도 Execution 도메인으로 분리**
  ④ Content 생성의 LLM Gateway 전환은 TASK-0502로 지시됨.

### 15. TASK-0404 해석 확인 → 승인 (2026-07-27)
- CTO 결정: ① 검사 6종 유지 ② READY Validation은 **Advisory Mode 유지** —
  FAIL이어도 전이를 차단하지 않음 ③ 검증 결과는 저장하지 않음.
- Sprint 4 공식 종료.

### 14. TASK-0403 해석 확인 → 승인 (2026-07-27)
- CTO 결정: ① **통합 조회 방식 유지** (fallback 아님)
  ② Memory value(Json) 검색은 **다음 Sprint에서 확장**
  ③ **SopRun은 Company Brain이 아님** — Query 대상 제외 확정.

### 8. 잔여 TASK 상세 스펙 전달 → Sprint 4 완료로 해소 (2026-07-27)
- 0404까지 지시 수신·구현 완료. 다음 Sprint 계획 시 TASK별 필드·범위
  스펙을 함께 받으면 재작업을 줄일 수 있다 (요청 유지 취지만 기록).

### 13. TASK-0402 세부 해석 → 승인 + scope Enum·규칙 확정 (2026-07-27)
- CTO 결정: ① scope Enum 4종 **GLOBAL/COMPANY/PROJECT/PRODUCT**
  ② 규칙 — GLOBAL→scopeId=NULL, PROJECT→Project 실존 검증, PRODUCT→Product
  실존 검증 ③ value는 Json 유지 ④ ProjectMemory는 폐기하지 않고
  **사람용 메모·작업기록 저장소**로 유지 (Memory = AI용 구조화 설정 저장소).
- 반영(`2afd089`): DB enum + 데이터 보존 마이그레이션, 도메인 검증, 실존
  검증 400. **COMPANY는 GLOBAL과 동일하게 scopeId=NULL로 해석**
  (별도 Company 엔티티가 없으므로 — 다르면 지시 요청).

### 11. TASK-0307 해석 확인 → 승인 후 TASK-0402에서 재정의로 해소 (2026-07-27)
- 메모형 Memory는 ProjectMemory(사람용 메모·작업기록)로 보존, 표준 Memory는
  구조화 저장소로 재정의 (#13 결정에 포함).

### 12. TASK-0401 해석 확인 → 승인 + 전역 확정 + category Enum 8종 (2026-07-27)
- CTO 결정: Knowledge는 회사 전역(Global)만 관리. category는
  RULE/POLICY/GUIDE/BRAND/LEGAL/QUALITY/FAQ/OTHER Enum으로 고정.
- 반영(`d8e24d0`): DB enum + 데이터 보존 마이그레이션, 공유 타입,
  도메인 검증 3중 강제.

### 10. decisionType 유형 → Enum 8종 고정 (2026-07-27)
- CTO 결정: ARCHITECTURE / PROCESS / PRODUCT / BUSINESS / TECHNICAL /
  QUALITY / SECURITY / OTHER.
- 반영(`7864c91`): DB enum + 데이터 보존 마이그레이션(대문자 매칭, 미매칭
  OTHER), 공유 타입, 도메인 검증 3중 강제.

### 9. TASK-0305 해석 확인 → 조건부 승인, 아키텍처 수정 반영 완료 (2026-07-27)
- CTO 리뷰: SOP는 실행 엔진이 아니라 **표준 업무 절차 정의 도메인(Company
  Brain)**, 실행은 **Workflow Engine(Execution Layer)** 으로 분리.
- 반영(`f929977`): SopEngine → WorkflowEngine 명칭·역할 변경(core/workflow),
  SOP 정의는 core/sop 유지, 문서 2계층 구조 반영. 로직 변경 없음.

### 3. ProductObjectStatus 전이 규칙 → TASK-0302로 구현 (2026-07-27)
- Sprint 3 지시에 따라 DRAFT⇄READY, →ARCHIVED(종결) + READY 최소 검증으로 구현.
  조건 확장은 #7로 이관.

### 1. Project 엔티티 분리 → 도입 결정, TASK-0301로 구현 (2026-07-27)
- Sprint 2 CTO 리뷰 승인에 따라 Project를 최상위 루트 엔티티로 도입.
- 데이터 보존 마이그레이션(기존 상품별 동일 id 프로젝트 백필),
  ProductObject.projectId → projects.id 재지정, Projects CRUD API 추가.

### 5. Vision Foundation TASK 스펙 요청 → TASK-0205로 진행 (2026-07-27)
- CTO "다음" 지시에 따라 제안 최상단 항목으로 진행. VisionProvider 교체 구조
  구현 완료(`4fb0cf4`), 실제 Vision 모델은 미연결(mock 기본) — 실연결은 #6으로 이관.
