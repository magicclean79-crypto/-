import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 화면에 실리는 문장에 마크다운 강조를 쓰지 않는다 — `reliability` 편.
 *
 * `src/ops`에는 이 검사가 있었고(별표 결함을 네 번 고친 뒤에 만들었습니다),
 * `src/reliability`에는 없었습니다. 그런데 이 디렉터리의 문장도 똑같이
 * 화면으로 나갑니다 — 작업 실패 사유, 이어하기 판정, 성능 요약 전부입니다.
 *
 * 검사가 한 디렉터리에만 있으면 **그 디렉터리 밖에서 같은 결함이 다시
 * 납니다.** 실제로 TASK-4701에서 새 파일을 쓰다 별표를 넣었고, `ops`의
 * 검사는 그것을 보지 못했습니다.
 */

const DIR = join(__dirname);

/** 주석을 지운다 — 주석의 마크다운은 문제가 아니다 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("작업 층의 사용자 문장", () => {
  const files = readdirSync(DIR).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".spec.ts"),
  );

  it("검사할 파일을 실제로 찾는다 — 0개면 이 검사는 아무것도 안 본 것이다", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(files)("%s의 문자열 리터럴에 마크다운 강조가 없다", (name) => {
    const body = stripComments(readFileSync(join(DIR, name), "utf8"));

    const offenders: string[] = [];
    const literals = body.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g);
    for (const literal of literals ?? []) {
      // `${...}` 안은 문장이 아니라 식이다 — 거듭제곱을 마크다운으로 읽으면
      // 거짓 경보가 되고, 거짓 경보를 내는 검사는 곧 꺼진다
      const text = literal.replace(/\$\{[^}]*\}/g, "");
      if (/(?<!\*)\*\*(?!\*)/.test(text)) {
        offenders.push(literal.slice(0, 120));
      }
    }

    expect(offenders).toEqual([]);
  });
});
