import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 화면에 실리는 문장에 마크다운 강조를 쓰지 않는다.
 *
 * ## 왜 이 검사가 존재하는가
 *
 * 우리는 이 결함을 **네 번** 고쳤습니다 — TASK-3701(스모크·전환), TASK-3901
 * (임계값 설명), 그리고 TASK-4001의 라이브 검증에서 두 건이 더 나왔습니다
 * (KPI 요약의 "임계값을 **느슨하게** 바꾼", 초안 승격의 "자동으로 만든
 * **초안**입니다"). 매번 고쳤고 매번 다시 생겼습니다.
 *
 * 이유는 분명합니다: 이 파일들의 **주석**은 마크다운으로 쓰고, 그 습관이
 * 바로 아래 문자열로 흘러듭니다. 그리고 **빠뜨려도 아무것도 실패하지
 * 않습니다** — 테스트는 통과하고, 별표는 라이브 화면에서만 보입니다.
 * 사람의 기억에 기대는 규칙은 반드시 다시 어긋납니다.
 *
 * 그래서 기계가 봅니다. 이 검사는 `src/ops`의 소스를 읽어 **문자열 리터럴
 * 안의** `**`를 찾습니다. 주석은 대상이 아닙니다 — 주석은 사람이 읽는
 * 문서이고 마크다운이어야 합니다.
 */

const OPS_DIR = join(__dirname);

/** 주석을 지운다 — 주석의 마크다운은 문제가 아니다 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("사용자에게 보이는 문장 (라이브 결함 4회 재발 방지)", () => {
  const files = readdirSync(OPS_DIR).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".spec.ts"),
  );

  it("검사할 파일을 실제로 찾는다 — 0개면 이 검사는 아무것도 안 본 것이다", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)("%s의 문자열 리터럴에 마크다운 강조가 없다", (name) => {
    const body = stripComments(readFileSync(join(OPS_DIR, name), "utf8"));

    const offenders: string[] = [];
    const literals = body.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g);
    for (const literal of literals ?? []) {
      // `${...}` 안은 문장이 아니라 **식**이다 — `1024 ** 2` 같은 거듭제곱을
      // 마크다운으로 읽으면 검사가 거짓 경보를 내고, 거짓 경보를 내는 검사는
      // 곧 꺼진다
      const text = literal.replace(/\$\{[^}]*\}/g, "");
      // `***`는 값을 가린 것이다 (감사 기록의 `key=***`) — 강조가 아니다
      if (/(?<!\*)\*\*(?!\*)/.test(text)) {
        offenders.push(literal.slice(0, 120));
      }
    }

    expect(offenders).toEqual([]);
  });
});
