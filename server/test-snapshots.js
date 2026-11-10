// Backwards-compatible test entry point. The original unauthenticated test was superseded
// by test-integration.js when authentication and session isolation were introduced.
console.log('Running the current authenticated snapshot/session integration suite...');
require('./test-integration');
