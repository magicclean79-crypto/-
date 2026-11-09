import type { ProductProfileDto } from "@acos/shared";
import { imageStudioFetch } from "./api-client";

/**
 * 이 원본 사진(`sourceImageId`)이 쓰인 가장 최근 Product Profile 실행을
 * 찾는다. Image Studio는 sourceImageId 단위로 동작하고 Product Profile은
 * `imageIds` 배열로 여러 사진을 묶어 실행되므로, 둘을 잇는 별도 테이블이
 * 없다 — 기존 `GET /product-profile` 목록(최신순)에서 이 사진을 포함하는
 * 실행을 찾는다(중복 API를 새로 만들지 않는다, T1-88이 처음 만든 방식을
 * `DetailPagePanel`·`UserRequirementPanel`이 함께 재사용한다, T1-92).
 *
 * 조회 실패(네트워크 오류 포함) 시 조용히 `null`을 반환한다 — 이 함수를
 * 부르는 여러 곳(`CategoryPanel`의 `useEffect`처럼 `.catch()`가 없는
 * 호출부 포함)이 예외 전파를 전제하지 않고 "아직 Product Profile 없음"과
 * 같은 방식으로 처리하기 때문이다(T1-119, 기존 동작 유지).
 */
export async function findProfileForSourceImage(
  sourceImageId: string,
): Promise<ProductProfileDto | null> {
  try {
    const body = await imageStudioFetch<{ results: ProductProfileDto[] }>(
      "/product-profile?take=100",
    );
    return body.results.find((p) => p.imageIds.includes(sourceImageId)) ?? null;
  } catch {
    return null;
  }
}
