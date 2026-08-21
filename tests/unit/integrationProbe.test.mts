//? The integration connection probe (ADR 0320).
//?
//? What makes this worth testing rather than eyeballing: the probe's whole value is that its verdict is
//? TRUE. A parser that mis-reads a connection string reports `failed` for a working integration and
//? sends the user hunting a problem that is not there; a verdict that says `ok` when it only opened a
//? socket sends them into a pipeline run with a wrong password. Both are worse than no button.
//?
//? The TCP cases use a real listener on an ephemeral port — a mocked socket would test the mock.

import { createServer } from 'node:net';

import { hostPort, redact, tcpReachable, probeIntegration } from '../../server/integrations/probe.ts';
import { assert, eq, report } from '../_helpers.mts';

/* ------------------------------------------------------------ host/port parsing */

eq(JSON.stringify(hostPort('mongodb://user:pw@db.example.com:27017/app', 'mongodb')), '{"host":"db.example.com","port":27017}', 'a full URL yields its own host and port');
eq(JSON.stringify(hostPort('mongodb://db.example.com/app', 'mongodb')), '{"host":"db.example.com","port":27017}', 'a URL without a port falls back to the type default');
eq(JSON.stringify(hostPort('db.example.com:5432', 'postgres')), '{"host":"db.example.com","port":5432}', 'a bare host:port parses');
eq(JSON.stringify(hostPort('db.example.com', 'postgres')), '{"host":"db.example.com","port":5432}', 'a bare host takes the type default');
//? Kafka is configured as a broker LIST; reaching the first broker answers "is the cluster there".
eq(JSON.stringify(hostPort('a.example.com:9092,b.example.com:9092', 'kafka')), '{"host":"a.example.com","port":9092}', 'a broker list probes its first entry');
eq(hostPort('', 'mongodb'), null, 'an empty value has nothing to dial');
eq(hostPort('   ', 'mongodb'), null, 'neither does whitespace');
//? An unknown type with a bare host has no default port — guessing one would produce a confident
//? `failed` about a port the user never configured.
eq(hostPort('example.com', 'something-custom'), null, 'a bare host with no known default port is not guessed at');

/* ------------------------------------------------------------ redaction */

eq(redact('connect ECONNREFUSED mongodb://alice:hunter2@db:27017'), 'connect ECONNREFUSED mongodb://***@db:27017', 'a password in an error message is redacted');
eq(redact('no answer from db.example.com:27017 within 6s'), 'no answer from db.example.com:27017 within 6s', 'a message with no credential is untouched');

/* ------------------------------------------------------------ a real TCP dial */

const server = createServer();
await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve(); }); });
const address = server.address();
const port = typeof address === 'object' && address !== null ? address.port : 0;
assert(port > 0, 'the test listener bound an ephemeral port');

const open = await tcpReachable('127.0.0.1', port, 3000);
assert(open.ok, 'an open port is reported reachable');

//? probeIntegration must NOT upgrade a TCP handshake to `ok` — the distinction is the feature.
const dialed = await probeIntegration('mongodb', [`mongodb://127.0.0.1:${String(port)}/app`], 3000);
eq(dialed.status, 'reachable', 'a successful dial is reachable, never ok — credentials were not checked');

server.close();
//? Give the listener a moment to actually stop before asserting on a refused connection.
await new Promise<void>((resolve) => { setTimeout(resolve, 50); });

const closed = await tcpReachable('127.0.0.1', port, 2000);
assert(!closed.ok, 'a closed port is reported unreachable');
const refused = await probeIntegration('postgres', [`postgres://127.0.0.1:${String(port)}/app`], 2000);
eq(refused.status, 'failed', 'a refused connection is a failure, not "reachable"');

/* ------------------------------------------------------------ nothing to test */

eq((await probeIntegration('mongodb', [''])).status, 'unsupported', 'an integration with no configured value is not testable');
eq((await probeIntegration('mongodb', [])).status, 'unsupported', '…nor one with no fields at all');
eq((await probeIntegration('custom-thing', ['not a host'])).status, 'unsupported', 'an unparseable value is unsupported rather than a false failure');

report('integrationProbe');
