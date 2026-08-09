/**
 * CTO Bridge — 프로젝트 계층 (Project Registry)
 *
 * ## 왜 이 파일이 생겼나
 *
 * Bridge는 처음에 **이 저장소 하나**를 위해 만들어졌다. 작업 지시도 결과도
 * `bridge/tasks`·`bridge/results`에 그냥 쌓였다. 프로젝트가 하나뿐일 때는
 * 문제가 없지만, 다음 프로젝트가 시작되면 **같은 통에 섞인다.**
 *
 * 그래서 **공통 시스템**과 **프로젝트별 데이터**를 나눈다.
 *
 * ```
 * 공통 시스템 (이 폴더의 .mjs 파일들)   어느 프로젝트에서든 그대로 쓴다
 * 프로젝트 데이터 (projects/<id>/)      저장소 경로·문서·작업·결과
 * ```
 *
 * **코드에는 특정 프로젝트 이야기가 들어가지 않는다.** 저장소 경로도, 읽을
 * 문서도, 건드리면 안 되는 파일도 전부 등록 정보에서 온다. 새 프로젝트를
 * 시작할 때 고쳐야 할 코드는 없다 — 등록만 하면 된다.
 *
 * ## 파일 배치
 *
 *   bridge/projects/<프로젝트ID>/project.json   등록 정보
 *   bridge/projects/<프로젝트ID>/tasks/…        작업 지시
 *   bridge/projects/<프로젝트ID>/results/…      작업 결과
 *   bridge/projects/<프로젝트ID>/STATUS.md      상태 요약
 *
 * ## 기존 프로젝트는 자리를 옮기지 않는다
 *
 * 지금 돌고 있는 프로젝트(`acos`)의 작업은 `bridge/tasks`·`bridge/results`에
 * 그대로 둔다. **동작하는 것을 이유 없이 옮기지 않는다.** 대신 그 자리를
 * 기본 프로젝트의 경로로 인정한다.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);
const PROJECTS_DIR = join(HERE, "projects");

/** 이 Bridge가 처음부터 돌보던 프로젝트 */
export const DEFAULT_PROJECT_ID = "acos";

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** 기본 프로젝트의 등록 정보 — 파일이 없어도 이 값으로 동작한다 */
function defaultProject() {
  return {
    projectId: DEFAULT_PROJECT_ID,
    name: "AI Product Content OS",
    repoPath: REPO_ROOT,
    docs: [
      "docs/RECOVERY_GUIDE.md",
      "docs/MASTER_GUIDE.md",
      "AGENTS.md",
      "docs/DEVELOPMENT_ENVIRONMENT.md",
      "docs/PROJECT_STATE.md",
      "TASKS.md",
      "docs/PROJECT_MEMORY.md",
    ],
    doNotTouch: [
      "apps/web/app/benchmark/constants.ts (Benchmark 기준값. 새 ID는 보고만 한다)",
      "bridge/ 아래 전부 (작업 전달 계층 자신)",
      "원격 EC2·SSH 터널·원격 데이터",
    ],
    verifyCommands: [
      "pnpm turbo run build",
      "pnpm turbo run typecheck",
      "npx eslint .",
      "pnpm turbo run test",
    ],
    requiredChecks: ["build", "typecheck", "lint", "tests"],
    browserUrl: "http://localhost:3100/image-studio",
    scope: null,
    legacyLayout: true,
  };
}

/** 프로젝트별 파일이 어디에 있는지 — 기본 프로젝트만 옛 자리를 쓴다 */
export function projectPaths(projectId = DEFAULT_PROJECT_ID) {
  if (projectId === DEFAULT_PROJECT_ID) {
    return {
      root: HERE,
      TASKS_DIR: join(HERE, "tasks"),
      RESULTS_DIR: join(HERE, "results"),
      STATUS_FILE: join(HERE, "STATUS.md"),
      CONFIG_FILE: join(PROJECTS_DIR, `${DEFAULT_PROJECT_ID}.json`),
    };
  }
  const root = join(PROJECTS_DIR, projectId);
  return {
    root,
    TASKS_DIR: join(root, "tasks"),
    RESULTS_DIR: join(root, "results"),
    STATUS_FILE: join(root, "STATUS.md"),
    CONFIG_FILE: join(root, "project.json"),
  };
}

/**
 * 프로젝트 ID 검사.
 *
 * 이 값은 **폴더 이름이 된다.** `..` 같은 것이 들어오면 Bridge 바깥의
 * 파일을 건드릴 수 있다 — 공개 주소에 열린 서버이므로 반드시 막는다.
 */
export function validProjectId(projectId) {
  return typeof projectId === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(projectId);
}

/** 새 프로젝트를 등록한다 */
export function registerProject(input) {
  const { projectId, name, repoPath } = input ?? {};
  if (!validProjectId(projectId)) {
    throw new Error("projectId는 소문자·숫자·하이픈 40자 이내여야 합니다.");
  }
  if (!name) throw new Error("name 은 필수입니다.");
  if (!repoPath) throw new Error("repoPath 는 필수입니다.");

  const absolute = isAbsolute(repoPath) ? repoPath : resolve(REPO_ROOT, repoPath);
  // **없는 저장소를 등록하면 실행할 때가 아니라 지금 막는다.** 나중에
  // 실패하면 원인을 찾기 어렵다.
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    throw new Error(`저장소 경로가 없습니다: ${absolute}`);
  }

  const paths = projectPaths(projectId);
  if (existsSync(paths.CONFIG_FILE)) {
    throw new Error(`이미 등록된 프로젝트입니다: ${projectId}`);
  }

  const project = {
    projectId,
    name,
    repoPath: absolute,
    // 호출된 세션이 먼저 읽을 문서. 없으면 읽으라고 시키지 않는다.
    docs: Array.isArray(input.docs) ? input.docs : [],
    // 사람 승인 없이 고치면 안 되는 것.
    doNotTouch: Array.isArray(input.doNotTouch) ? input.doNotTouch : [],
    // 검증에 실제로 돌릴 명령. 프로젝트마다 다르다.
    verifyCommands: Array.isArray(input.verifyCommands) ? input.verifyCommands : [],
    // 사람 확인 단계로 올리려면 **반드시 기록돼야 하는 검사 이름**.
    // 빌드도 타입체크도 없는 저장소가 있으므로 프로젝트가 정한다.
    requiredChecks:
      Array.isArray(input.requiredChecks) && input.requiredChecks.length > 0
        ? input.requiredChecks
        : ["build", "typecheck", "lint", "tests"],
    // 사람이 결과를 확인할 주소.
    browserUrl: input.browserUrl ?? null,
    // **사장님이 정한 범위.** 이 밖으로 나가는 결정은 스스로 하지 않는다.
    scope: input.scope ?? null,
    createdAt: new Date().toISOString(),
  };

  ensureDir(paths.root);
  ensureDir(paths.TASKS_DIR);
  ensureDir(paths.RESULTS_DIR);
  ensureDir(dirname(paths.CONFIG_FILE));
  writeJson(paths.CONFIG_FILE, project);
  return project;
}

/** 등록 정보를 읽는다 — 기본 프로젝트는 파일이 없어도 값이 나온다 */
export function readProject(projectId = DEFAULT_PROJECT_ID) {
  if (!validProjectId(projectId)) return null;
  const paths = projectPaths(projectId);
  if (existsSync(paths.CONFIG_FILE)) {
    return { ...readProjectDefaults(projectId), ...readJson(paths.CONFIG_FILE) };
  }
  return projectId === DEFAULT_PROJECT_ID ? defaultProject() : null;
}

function readProjectDefaults(projectId) {
  return projectId === DEFAULT_PROJECT_ID ? defaultProject() : {};
}

/** 등록된 프로젝트 전부 (기본 프로젝트를 항상 포함한다) */
export function listProjects() {
  const found = new Map();
  found.set(DEFAULT_PROJECT_ID, readProject(DEFAULT_PROJECT_ID));
  if (existsSync(PROJECTS_DIR)) {
    for (const entry of readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const project = readProject(entry.name);
      if (project) found.set(entry.name, project);
    }
  }
  return [...found.values()].sort((a, b) => a.projectId.localeCompare(b.projectId));
}

/** 있는 프로젝트인지 확인하고 등록 정보를 돌려준다 — 없으면 던진다 */
export function requireProject(projectId = DEFAULT_PROJECT_ID) {
  const project = readProject(projectId);
  if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
  return project;
}

export const registryPaths = { PROJECTS_DIR, REPO_ROOT };
