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

  constructor(ctx: DurableObjectState, env: Record<string, string>) {
    super(ctx, env);
    // Worker의 env(vars/secrets)는 컨테이너 프로세스에 자동으로 안 넘어간다 —
    // 명시적으로 envVars에 복사해줘야 파이썬 쪽 os.environ에 나타난다.
    // 이걸 빼먹어서 DATABASE_URL이 안 넘어가 앱이 config.py 기본값
    // (localhost:5432)으로 접속을 시도했고, 그게 "Connection refused"였다.
    this.envVars = {
      DATABASE_URL: env.DATABASE_URL,
      APP_ENV: env.APP_ENV,
      CORS_ALLOWED_ORIGINS: env.CORS_ALLOWED_ORIGINS,
    };
  }
}

const SINGLETON_ID = "ourcompass-backend-singleton-v4";

export default {
  async fetch(request: Request, env: { OURCOMPASS_BACKEND: DurableObjectNamespace }) {
    const instance = getContainer(env.OURCOMPASS_BACKEND, SINGLETON_ID);
    // containerFetch()가 내부적으로 이미 "안 떠있으면 startAndWaitForPorts부터
    // 호출"을 처리한다 (node_modules/@cloudflare/containers/dist/lib/container.js
    // 확인함) — 여기서 따로 먼저 켤 필요 없고, 오히려 이중 시작 경합만 만들었다.
    return instance.fetch(request);
  },
};
