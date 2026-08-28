/**
 * 이미지 업로드 전 클라이언트 리사이즈 - 원래 app/profile/[id]/page.tsx에
 * 있던 fileToDataUrl을 여기로 옮겨왔다(S2 스토리 업로드도 동일 로직이
 * 필요해 공용화). 긴 변 1080px, JPEG로 인코딩하고, 문서 1MiB 한도를 지키기
 * 위해 결과가 크면 품질을 단계적으로 낮춘다.
 */
export async function fileToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const MAX_EDGE = 1080;
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let quality = 0.82;
  let out = canvas.toDataURL("image/jpeg", quality);
  while (out.length > 900_000 && quality > 0.4) {
    quality -= 0.12;
    out = canvas.toDataURL("image/jpeg", quality);
  }
  return out;
}
