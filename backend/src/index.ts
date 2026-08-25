import { Container, getContainer } from "@cloudflare/containers";

/**
 * FastAPI를 담은 컨테이너. 인스턴스 하나를 고정 id로 계속 재사용한다
 * (요청마다/세션마다 새 컨테이너를 안 띄움) — 포트폴리오 데모 트래픽 규모에서
 * 컨테이너를 여러 개 굴리는 건 Active-CPU 과금만 늘릴 뿐 의미가 없다.
 */
export class OurCompassBackend extends Container {
  defaultPort = 8000;
  // 트래픽이 뜸하면 재우고, 다음 요청이 오면 자동으로 다시 깨운다.
  sleepAfter = "10m";
}

const SINGLETON_ID = "ourcompass-backend-singleton";

export default {
  async fetch(request: Request, env: { OURCOMPASS_BACKEND: DurableObjectNamespace }) {
    const instance = getContainer(env.OURCOMPASS_BACKEND, SINGLETON_ID);
    // 이 라이브러리 버전은 fetch()가 자동으로 컨테이너를 켜주지 않는다 —
    // 잠들어 있으면(sleepAfter) 매번 먼저 깨워야 한다. 이미 떠 있으면 즉시 반환.
    await instance.startAndWaitForPorts();
    return instance.fetch(request);
  },
};
