# AI Product Content OS - AGENTS

## 역할

- ChatGPT = CTO / Software Architect
- Claude Code = Senior Software Engineer

## 절대 원칙

1. 아키텍처를 임의로 변경하지 않는다.
2. 한 번에 하나의 TASK만 구현한다.
3. 구현 후 반드시 테스트한다.
4. TypeScript 오류 0개
5. ESLint 오류 0개
6. Build 실패 금지
7. 기존 기능을 깨뜨리지 않는다.

## 개발 순서

Task →
구현 →
테스트 →
리뷰 →
Commit

## Commit 규칙

feat:
fix:
refactor:
docs:
test:
chore:

## Definition of Done

- Build 성공
- Test 성공
- 타입 오류 0
- Lint 오류 0
- README 업데이트
- CTO_REPORT 생성/갱신

## TASK 완료 절차 (필수)

모든 TASK 완료 시 반드시 아래 순서를 따른다.

1. **Build** — `pnpm build` 성공 여부 확인
2. **Test** — `pnpm test` 성공 여부 확인
3. **TypeScript** — 타입 오류 0 확인 (빌드에 포함)
4. **ESLint** — `pnpm lint` 오류 0 확인

네 가지가 모두 성공한 뒤에만 다음을 수행한다.

- `/reports/CTO_REPORT.md` 자동 생성 또는 갱신
- `/reports/CTO_REQUEST.md` 자동 생성 또는 갱신

규칙:

- **CTO_REPORT는 프로젝트의 공식 기술 보고서이다.** 형식은 항상 동일하게
  유지한다. (형식 정의는 CTO_REPORT.md 상단 참조)
- CTO_REQUEST에는 아키텍트(CTO)의 결정이 필요한 질문·요청 사항을 기록한다.
- **모든 TASK는 CTO_REPORT가 생성/갱신되어야 완료된 것으로 간주한다.**
