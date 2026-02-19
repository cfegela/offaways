// Runs before any module is loaded — sets NODE_ENV so IS_LOCAL=true in handlers
process.env.NODE_ENV = 'local';
process.env.JWT_SECRET = 'test-secret';
process.env.COGNITO_USER_POOL_ID = 'us-east-1_test';
process.env.COGNITO_REGION = 'us-east-1';
