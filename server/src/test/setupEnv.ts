// Runs before every test file. Provides a valid config; tests needing a real DB
// override MONGODB_URI via useTestDb().
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/buildflow-test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-0123456789';
process.env.BCRYPT_COST = '4';
process.env.MAX_FAILED_LOGINS = '5';
process.env.IDENTITY_RATE_LIMIT_MAX = '10000'; // tests that exercise the limiter lower it explicitly
process.env.REFRESH_REUSE_GRACE_SECONDS = '0';
process.env.DOCUMENT_MAX_BYTES = '1048576'; // 1 MB keeps the size-limit tests small
