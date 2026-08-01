import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 런북에 적힌 주소가 실제로 있는 주소인지 본다.
 *
 * ## 왜 이 검사가 존재하는가
 *
 * TASK-4901의 라이브 검증에서 `OPERATIONS_RUNBOOK.md`에 적힌 경로 **네
 * 개**가 404였습니다 — `/ops/backup`, `/ops/recovery`, `/ops/schedule`,
 * `/ops/lock`. 전부 존재한 적이 없는 주소입니다.
 *
 * 이건 오타가 아니라 **문서와 코드가 서로를 모른다**는 문제입니다. 런북은
 * 당직 중에 읽는 문서이고, 그때는 시간이 가장 비쌉니다. 장애 한가운데서
 * 붙여 넣은 명령이 404를 뱉으면 사람은 "서버가 죽었나"를 먼저 의심합니다 —
 * 없는 주소를 적어 둔 대가를 가장 나쁜 순간에 치릅니다.
 *
 * 그리고 이 결함은 **아무것도 실패시키지 않습니다.** 빌드도 테스트도
 * 통과하고, 문서는 사람이 실제로 그 명령을 칠 때까지 조용합니다. 사람의
 * 검토에 기대는 규칙은 반드시 다시 어긋납니다.
 *
 * 그래서 기계가 봅니다. 런북에서 주소를 뽑아, 컨트롤러의 `@Controller`
 * 접두사와 메서드 데코레이터로 만든 **실제 라우트 표**와 대조합니다.
 */

const API_SRC = join(__dirname, "..");
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const RUNBOOK = join(REPO_ROOT, "OPERATIONS_RUNBOOK.md");

/** `:id` 같은 자리를 하나의 자리표로 바꾼다 — 이름이 달라도 같은 라우트다 */
function normalize(path: string): string {
  return (
    "/" +
    path
      .split("/")
      .filter(Boolean)
      .map((seg) => (seg.startsWith(":") || seg.startsWith("$") ? ":p" : seg))
      .join("/")
  );
}

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...controllerFiles(full));
    } else if (name.endsWith(".controller.ts") && !name.endsWith(".spec.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** 컨트롤러 소스에서 실제 라우트 표를 만든다 */
function routeTable(): Set<string> {
  const routes = new Set<string>();
  for (const file of controllerFiles(API_SRC)) {
    const source = readFileSync(file, "utf8");
    const prefixMatch = source.match(/@Controller\(\s*(?:"([^"]*)")?\s*\)/);
    if (!prefixMatch) continue;
    const prefix = prefixMatch[1] ?? "";
    const method =
      /@(?:Get|Post|Put|Patch|Delete)\(\s*(?:"([^"]*)")?\s*\)/g;
    let hit: RegExpExecArray | null;
    while ((hit = method.exec(source)) !== null) {
      routes.add(normalize(`${prefix}/${hit[1] ?? ""}`));
    }
  }
  return routes;
}

/** 런북에서 우리 API 주소만 뽑는다 */
function runbookPaths(markdown: string): string[] {
  const found = new Set<string>();
  // `curl ... $API/ops/readiness` 형태
  for (const m of markdown.matchAll(/\$API(\/[A-Za-z0-9/_:$-]+)/g)) {
    found.add(m[1]);
  }
  // 본문에 적은 `GET /ops/lock` · `GET/POST /ops/notifications/resend` 형태
  for (const m of markdown.matchAll(
    /\b(?:GET|POST|PUT|PATCH|DELETE)(?:\/(?:GET|POST|PUT|PATCH|DELETE))*\s+(\/[A-Za-z0-9/_:$-]+)/g,
  )) {
    found.add(m[1]);
  }
  return [...found].map((p) => p.replace(/[.,)]+$/, ""));
}

describe("운영 런북의 주소 (TASK-4901 라이브 결함 4건 재발 방지)", () => {
  const routes = routeTable();
  const paths = runbookPaths(readFileSync(RUNBOOK, "utf8"));

  it("라우트 표를 실제로 만든다 — 비어 있으면 이 검사는 아무것도 안 본 것이다", () => {
    expect(routes.size).toBeGreaterThan(80);
  });

  it("런북에서 주소를 실제로 뽑는다 — 0개면 정규식이 깨진 것이다", () => {
    expect(paths.length).toBeGreaterThan(15);
  });

  it("런북에 적힌 주소가 모두 존재한다", () => {
    const missing = paths.filter((p) => !routes.has(normalize(p)));
    expect(missing).toEqual([]);
  });
});
