import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";

/**
 * Firebase 초기화는 반드시 "지연(lazy)" 방식이어야 한다.
 *
 * Next.js App Router는 클라이언트 컴포넌트 모듈도 SSR 과정에서 Node 런타임으로
 * 한 번 로드하고, 이 프로젝트는 배포 대상이 Cloudflare Workers(@opennextjs/cloudflare)라
 * 모듈 최상단에서 initializeApp/getAuth를 호출하면 Workers 런타임(브라우저 API가
 * 일부만 존재하는 환경)에서도 즉시 실행되어 버린다. 이 시점엔 window가 없거나
 * 초기화에 필요한 조건이 갖춰지지 않아 예기치 않은 오류로 이어질 수 있다.
 * 그래서 초기화 로직을 함수 안에 가두고, 실제로 인증이 필요한 시점(클라이언트에서
 * getFirebaseAuth()가 호출되는 시점)에만 동작하도록 만든다.
 */

function getFirebaseApp(): FirebaseApp {
  const existingApps = getApps();
  if (existingApps.length > 0) {
    return existingApps[0]!;
  }
  return initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "fake-api-key",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "demo-ourlab.firebaseapp.com",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-ourlab",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:0:web:0",
  });
}

// 에뮬레이터 연결은 프로세스(모듈 인스턴스) 생애 동안 단 한 번만 이뤄져야 한다.
// connectAuthEmulator를 중복 호출하면 Firebase SDK가 경고/오류를 던진다.
let emulatorConnected = false;

/**
 * Auth 인스턴스를 지연 생성해서 반환한다.
 * - 서버(SSR/Workers)에서 호출돼도 안전하도록 실제 부작용은 함수 호출 시점에만 발생한다.
 * - 브라우저 환경(typeof window !== "undefined")이고 NEXT_PUBLIC_AUTH_EMULATOR_HOST가
 *   설정돼 있으면 로컬 Auth 에뮬레이터로 연결한다.
 */
export function getFirebaseAuth(): Auth {
  const auth = getAuth(getFirebaseApp());

  const emulatorHost = process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST;
  if (typeof window !== "undefined" && emulatorHost && !emulatorConnected) {
    connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });
    emulatorConnected = true;
  }

  return auth;
}
