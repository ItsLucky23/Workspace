//? K2 — one-click SERVICE PRESETS: curated docker-compose snippets for the common third-party services, the easy
//? path on top of the K1 compose-engine (bring-your-own compose stays available). Each preset is a clean compose
//? (named volumes, healthchecks, sensible dev creds, NO published host ports — services are reached intra-network
//? by name) that passes the sanitizer unchanged. Pure data + lookups; provisioning reuses `provisionServiceStack`.

export interface ServicePreset { key: string; label: string; description: string; compose: string }

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
  },
  {
    key: 'mailpit', label: 'Mailpit', description: 'Mailpit — a dev SMTP server + web inbox.',
    compose: `services:
  mailpit:
    image: axllent/mailpit
`,
  },
];

export function listServicePresets(): { key: string; label: string; description: string }[] {
  return PRESETS.map((p) => ({ key: p.key, label: p.label, description: p.description }));
}

export function presetCompose(key: string): string | null {
  return PRESETS.find((p) => p.key === key)?.compose ?? null;
}
