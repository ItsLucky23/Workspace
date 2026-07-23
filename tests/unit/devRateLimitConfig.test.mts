//? Development test traffic shares one loopback IP across HTTP and Socket.io. Keep the
//? cross-route IP bucket disabled only in dev while preserving every per-route limit.

import config, { dev, resolveDev } from '../../config';
import { assert, eq, report } from '../_helpers.mts';

assert(config.rateLimiting.skipLoopbackInDev, 'the framework HTTP loopback bypass remains explicit');
eq(resolveDev({ viteProduction: true }), false, 'a Vite production browser bundle never enables development mode');
eq(resolveDev({ viteProduction: false, runtimeEnvironment: 'production' }), false, 'the production server never enables development mode');
eq(resolveDev({ viteProduction: false, runtimeEnvironment: 'development' }), true, 'the development server keeps development mode');
eq(config.rateLimiting.defaultIpLimit, dev ? false : 100, 'the global IP bucket is disabled only in development');
eq(config.rateLimiting.defaultApiLimit, 60, 'per-route API limiting remains active');

report('tests/unit/devRateLimitConfig.test.mts');
