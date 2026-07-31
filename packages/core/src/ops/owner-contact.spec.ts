import {
  ownerContactStatus,
  parseOwnerContacts,
  resolveOwnerRoute,
} from "./owner-contact";

describe("parseOwnerContacts (TASK-4601, 정책 4601-④)", () => {
  it("이름과 주소를 읽고 채널 기본값은 메일이다", () => {
    const book = parseOwnerContacts("김운영=ops-kim@acos.local");
    expect(book.contacts).toEqual([
      { owner: "김운영", channel: "email", address: "ops-kim@acos.local" },
    ]);
    expect(book.rejected).toEqual([]);
  });

  it("채널 접두를 읽는다", () => {
    const book = parseOwnerContacts("박서버=slack:https://hooks.example/abc");
    expect(book.contacts[0]).toEqual({
      owner: "박서버",
      channel: "slack",
      address: "https://hooks.example/abc",
    });
  });

  /**
   * `https://…`의 콜론을 채널 접두로 읽으면 주소가 통째로 망가진다.
   */
  it("주소 안의 콜론을 채널 접두로 착각하지 않는다", () => {
    const book = parseOwnerContacts("이담당=https://hooks.example/xyz");
    expect(book.contacts[0]).toMatchObject({
      channel: "email",
      address: "https://hooks.example/xyz",
    });
  });

  /**
   * 조용히 버리면 오타 하나로 담당자 한 명이 빠진 것을 아무도 모른다.
   */
  it("읽을 수 없는 선언을 버리되 돌려준다", () => {
    const book = parseOwnerContacts("김운영=a@b.c, 이름만, =주소만, 박=");
    expect(book.contacts).toHaveLength(1);
    expect(book.rejected).toEqual(["이름만", "=주소만", "박="]);
  });

  /**
   * 한 사람에게 두 번 가면 그 사람이 알림을 끈다.
   */
  it("같은 담당자를 두 번 적으면 뒤엣것 하나만 남는다", () => {
    const book = parseOwnerContacts("김운영=a@b.c, 김운영=z@b.c");
    expect(book.contacts).toHaveLength(1);
    expect(book.contacts[0].address).toBe("z@b.c");
  });

  it("비어 있으면 연락처가 없다", () => {
    expect(parseOwnerContacts(undefined).contacts).toEqual([]);
    expect(parseOwnerContacts("  ,  ").contacts).toEqual([]);
  });
});

describe("resolveOwnerRoute (TASK-4601, 정책 4601-④)", () => {
  const book = parseOwnerContacts("김운영=ops-kim@acos.local");

  it("연락처가 있으면 직접 보낸다", () => {
    const route = resolveOwnerRoute("김운영", book);
    expect(route.verdict).toBe("direct");
    expect(route.contact?.address).toBe("ops-kim@acos.local");
  });

  /**
   * 직접 경로가 생겼다고 공용 채널을 끄면, 담당자가 휴가 중일 때 그 항목은
   * 아무도 모르는 채로 지나간다.
   */
  it("직접 보내도 공용 채널을 끄지 않는다", () => {
    expect(resolveOwnerRoute("김운영", book).broadcast).toBe(true);
    expect(resolveOwnerRoute("모르는사람", book).broadcast).toBe(true);
    expect(resolveOwnerRoute("김운영", parseOwnerContacts(undefined)).broadcast).toBe(
      true,
    );
  });

  /**
   * 연락처가 없다고 알림을 안 보내면, 담당자를 적어 둔 것이 오히려 알림을
   * 없애는 셈이 된다.
   */
  it("모르는 담당자면 공용으로 보내되 그 사실을 본문에 붙인다", () => {
    const route = resolveOwnerRoute("최신입", book);
    expect(route.verdict).toBe("unknown-owner");
    expect(route.note).toContain("최신입");
    expect(route.note).toContain("공용 채널로만");
  });

  /**
   * 이름에서 주소를 유추하면, 틀린 주소로 보낸 알림이 "보냈다"로 남는다.
   */
  it("이름에서 주소를 지어내지 않는다", () => {
    const route = resolveOwnerRoute("최신입", book);
    expect(route.contact).toBeNull();
    expect(route.detail).toContain("유추하지 않습니다");
  });

  it("표 자체가 없으면 미구성이라고 말한다", () => {
    const route = resolveOwnerRoute("김운영", parseOwnerContacts(undefined));
    expect(route.verdict).toBe("not-configured");
    expect(route.note).toContain("김운영");
  });

  it("담당자가 비어 있어도 터지지 않는다", () => {
    expect(resolveOwnerRoute(null, book).verdict).toBe("unknown-owner");
    expect(resolveOwnerRoute(undefined, parseOwnerContacts(undefined)).note).toBeNull();
  });
});

describe("ownerContactStatus (TASK-4601)", () => {
  /**
   * 주소는 어떤 응답에도 담지 않는다 (1401부터의 규칙).
   */
  it("이름과 채널만 돌려주고 주소는 노출하지 않는다", () => {
    const status = ownerContactStatus(parseOwnerContacts("김운영=ops-kim@acos.local"));
    expect(status.owners).toEqual([{ owner: "김운영", channel: "email" }]);
    expect(JSON.stringify(status)).not.toContain("ops-kim@acos.local");
  });

  it("버린 선언을 화면 문장에 적는다", () => {
    const status = ownerContactStatus(parseOwnerContacts("이름만"));
    expect(status.detail).toContain("이름만");
    expect(status.detail).not.toContain("**");
  });
});
