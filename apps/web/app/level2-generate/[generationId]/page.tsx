import type { Metadata } from "next";
import DetailPageView from "../detail-page-view";

export const metadata: Metadata = {
  title: "상세페이지 | AI Product Content OS",
};

export default async function Level2GenerationPage({
  params,
}: {
  params: Promise<{ generationId: string }>;
}) {
  const { generationId } = await params;
  return <DetailPageView generationId={generationId} />;
}
