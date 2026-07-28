import { PASSWORD_MIN_LENGTH } from "./auth";

/**
 * 비밀번호 복잡도 정책. (TASK-0804, Sprint 8)
 *
 * Code-first 정책: 최소 8자 + 영문자 1개 이상 + 숫자 1개 이상.
 * 생성·변경·재설정 모든 경로에서 동일하게 적용한다.
 */

/** 위반 시 사용자에게 보여줄 메시지를, 통과 시 null을 반환한다 */
export function validatePasswordComplexity(
  password: string | undefined,
): string | null {
  const value = password ?? "";
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `비밀번호는 최소 ${PASSWORD_MIN_LENGTH}자여야 합니다.`;
  }
  if (!/[a-zA-Z]/.test(value)) {
    return "비밀번호에 영문자를 1자 이상 포함해 주세요.";
  }
  if (!/[0-9]/.test(value)) {
    return "비밀번호에 숫자를 1자 이상 포함해 주세요.";
  }
  return null;
}
