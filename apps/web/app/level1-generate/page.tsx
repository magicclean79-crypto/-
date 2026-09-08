import type { Metadata } from "next";
import OneShotView from "./one-shot-view";

export const metadata: Metadata = {
  title: "상세페이지 생성 | AI Product Content OS",
};

export default function Level1GeneratePage() {
  return <OneShotView />;
}
