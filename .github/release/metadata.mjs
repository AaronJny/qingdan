import { readFileSync, appendFileSync } from 'node:fs';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const request = read('.github/release/request.json');
const semver = /^\d+\.\d+\.\d+$/;
if (!semver.test(request.version) || !semver.test(request.androidVersion) || !Number.isSafeInteger(request.androidVersionCode) || request.androidVersionCode < 1 || !Number.isSafeInteger(request.attempt) || request.attempt < 1) throw Error('Invalid intentional release request');
for (const dir of ['application', 'desktop']) {
  const pkg = read(`${dir}/package.json`), lock = read(`${dir}/package-lock.json`);
  if (pkg.version !== request.version || lock.version !== pkg.version || lock.packages[''].version !== pkg.version) throw Error(`${dir} version/lock differs from release request`);
}
if (read('android/package.json').version !== request.androidVersion) throw Error('Independent Android client version differs from request');
const tag = `v${request.version}`;
if (process.env.GITHUB_REF?.startsWith('refs/tags/') && process.env.GITHUB_REF !== `refs/tags/${tag}`) throw Error('Tag differs from selected release version');
const result = {version:request.version, tag, androidVersion:request.androidVersion, androidVersionCode:String(request.androidVersionCode)};
if (process.env.GITHUB_OUTPUT) for (const [name,value] of Object.entries(result)) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
console.log(JSON.stringify(result));
