// Runs before build/test. Plain CommonJS so it works on old Node versions too.
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`\nPluset needs Node 22 or newer, but this is Node ${process.versions.node}.`);
  console.error('Run "nvm use" in the project folder (or "nvm alias default 22"), then try again.\n');
  process.exit(1);
}
