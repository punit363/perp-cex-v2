# Exchange integration tests

These tests create disposable accounts, a market, and simulated trades. Run them only against an isolated stack with an empty PostgreSQL database and Redis instance. The engine, backend, and database projector must be running, and migrations must already be applied.

From this directory:

```sh
E2E_ALLOW_MUTATIONS=1 \
E2E_BASE_URL=http://localhost:8000 \
E2E_REDIS_URL=redis://localhost:6379 \
E2E_ADMIN_TOKEN=your-test-admin-token \
bun test index.test.ts
```

Without all four settings the integration suite is skipped. It does not clean up created records; discard the test database and Redis instance after the run.
