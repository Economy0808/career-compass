"use client";

/* /demo -> 기본 탭(별자리 잇기)로 이동. 리포 관례상 서버 redirect()는 안 쓰고
 * 클라이언트 useRouter().replace로 통일한다(다른 라우트도 전부 이 패턴). */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DemoIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/demo/constellation");
  }, [router]);
  return null;
}
