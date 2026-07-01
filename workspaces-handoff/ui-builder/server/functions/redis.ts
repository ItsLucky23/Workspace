import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config(); 

//? here we create a Redis instance
const redis = new Redis({
  host: process.env.REDIS_HOST as string,
  port: parseInt(process.env.REDIS_PORT as string),
});

redis.on('connect', async () => {
  console.log('Connected to Redis');

  if (process.env.NODE_ENV == 'development') { return; }

  const prefix = `${process.env.PROJECT_NAME}-games:`;
  await clearKeysWithPrefix(prefix);
});

redis.on('error', (err) => {
  console.error('Error connecting to Redis:', err);
});

async function clearKeysWithPrefix(prefix: string) {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      // delete keys in bulk
      await redis.del(...keys);
      console.log(`Deleted Redis keys: ${keys.join(', ')}`);
    }
  } while (cursor !== '0');
}

export default redis;