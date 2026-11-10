const { runNpm } = require('./process');

try {
  runNpm(['install', '--prefix', 'server', '--no-audit', '--no-fund'], 'Installing backend dependencies');
  runNpm(['install', '--prefix', 'client', '--no-audit', '--no-fund'], 'Installing frontend dependencies');
  console.log('\nDependencies installed. Run `npm start` from the project root.');
} catch (error) {
  console.error(`\nSetup failed: ${error.message}`);
  process.exitCode = 1;
}
