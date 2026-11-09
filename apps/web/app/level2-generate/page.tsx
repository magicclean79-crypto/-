import type { Metadata } from "next";
import MultiView from "./multi-view";

export const metadata: Metadata = {
  title: "상세페이지 생성 (다중 페이지) | AI Product Content OS",
};

export default function Level2GeneratePage() {
  return <MultiView />;
}
