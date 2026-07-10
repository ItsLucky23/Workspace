//? K2 — one-click SERVICE PRESETS: curated docker-compose snippets for the common third-party services, the easy
//? path on top of the K1 compose-engine (bring-your-own compose stays available). Each preset is a clean compose
//? (named volumes, healthchecks, sensible dev creds, NO published host ports — services are reached intra-network
//? by name) that passes the sanitizer unchanged. Pure data + lookups; provisioning reuses `provisionServiceStack`.

//? K3 — a preset declares the connection-string ENV VARS the app/agent needs to reach the service by its
//? intra-network name (no host ports). Provisioning upserts these as (non-secret, visible) workspace EnvVars so
//? `resolveWorkspaceEnv` injects them into the agent + preview containers; teardown removes them again.
export interface ServicePreset { key: string; label: string; description: string; compose: string; env: Record<string, string> }

const PRESETS: readonly ServicePreset[] = [
  {
    key: 'postgres', label: 'PostgreSQL', description: 'Postgres 16 with a dev database + persistent volume.',
    compose: `services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: devpassword
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 10s
volumes:
  pgdata:
`,
    env: { DATABASE_URL: 'postgresql://app:devpassword@postgres:5432/app', POSTGRES_HOST: 'postgres', POSTGRES_PORT: '5432', POSTGRES_USER: 'app', POSTGRES_PASSWORD: 'devpassword', POSTGRES_DB: 'app' },
  },
  {
    key: 'redis', label: 'Redis', description: 'Redis 7 with AOF persistence.',
    compose: `services:
  redis:
    image: redis:7
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redisdata:/data
volumes:
  redisdata:
`,
    env: { REDIS_URL: 'redis://redis:6379', REDIS_HOST: 'redis', REDIS_PORT: '6379' },
  },
  {
    key: 'kafka', label: 'Kafka (KRaft)', description: 'Apache Kafka in single-node KRaft mode (no ZooKeeper).',
    compose: `services:
  kafka:
    image: apache/kafka:3.9.0
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
    volumes:
      - kafkadata:/var/lib/kafka/data
volumes:
  kafkadata:
`,
    env: { KAFKA_BROKERS: 'kafka:9092', KAFKA_BOOTSTRAP_SERVERS: 'kafka:9092' },
  },
  {
    key: 'rabbitmq', label: 'RabbitMQ', description: 'RabbitMQ 3 with the management UI.',
    compose: `services:
  rabbitmq:
    image: rabbitmq:3-management
    environment:
      RABBITMQ_DEFAULT_USER: app
      RABBITMQ_DEFAULT_PASS: devpassword
    volumes:
      - rabbitdata:/var/lib/rabbitmq
volumes:
  rabbitdata:
`,
    env: { RABBITMQ_URL: 'amqp://app:devpassword@rabbitmq:5672', RABBITMQ_HOST: 'rabbitmq', RABBITMQ_PORT: '5672' },
  },
  {
    key: 'elasticsearch', label: 'Elasticsearch', description: 'Elasticsearch 8 single-node, security off (dev).',
    compose: `services:
  elasticsearch:
    image: elasticsearch:8.15.0
    environment:
      discovery.type: single-node
      xpack.security.enabled: "false"
      ES_JAVA_OPTS: "-Xms512m -Xmx512m"
    volumes:
      - esdata:/usr/share/elasticsearch/data
volumes:
  esdata:
`,
    env: { ELASTICSEARCH_URL: 'http://elasticsearch:9200', ELASTICSEARCH_NODE: 'http://elasticsearch:9200' },
  },
  {
    key: 'minio', label: 'MinIO (S3)', description: 'MinIO object storage (S3-compatible).',
    compose: `services:
  minio:
    image: minio/minio
    command: ["server", "/data"]
    environment:
      MINIO_ROOT_USER: app
      MINIO_ROOT_PASSWORD: devpassword
    volumes:
      - miniodata:/data
volumes:
  miniodata:
`,
    env: { S3_ENDPOINT: 'http://minio:9000', S3_ACCESS_KEY: 'app', S3_SECRET_KEY: 'devpassword', MINIO_ENDPOINT: 'minio:9000' },
  },
  {
    key: 'mailpit', label: 'Mailpit', description: 'Mailpit — a dev SMTP server + web inbox.',
    compose: `services:
  mailpit:
    image: axllent/mailpit
`,
    env: { SMTP_HOST: 'mailpit', SMTP_PORT: '1025', MAILPIT_WEB: 'http://mailpit:8025' },
  },
];

export function listServicePresets(): { key: string; label: string; description: string }[] {
  return PRESETS.map((p) => ({ key: p.key, label: p.label, description: p.description }));
}

export function presetCompose(key: string): string | null {
  return PRESETS.find((p) => p.key === key)?.compose ?? null;
}

//? K3 — the connection-string env a preset publishes (empty for a non-preset / unknown key).
export function presetEnv(key: string): Record<string, string> {
  return PRESETS.find((p) => p.key === key)?.env ?? {};
}
