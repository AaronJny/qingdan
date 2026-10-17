import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** Retain the license notices of npm packages in the web build's module graph.
 * Uses the same build-time approach and output format as the Android web build.
 * @param {{ noticeDirectory?: string }} options
 * @returns {import('vite').Plugin}
 */
export function bundledLicenses({ noticeDirectory = 'assets/licenses' } = {}) {
  return {
    name: 'qingdan-bundled-license-notices',
    generateBundle() {
      const packages = new Map();
      // Rolldown can inline a package's code into its importer and omit it from
      // chunk.modules. Keep the full graph, as the Android build does, so an
      // inlined dependency's notice cannot silently disappear.
      for (const id of this.getModuleIds()) {
        const normalized = id.replaceAll('\\', '/').split('?')[0];
        const marker = '/node_modules/', at = normalized.lastIndexOf(marker);
        if (at < 0) continue;
        const parts = normalized.slice(at + marker.length).split('/');
        const name = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
        const directory = normalized.slice(0, at + marker.length) + name;
        const data = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
        const key = `${data.name || name}@${data.version}`;
        if (packages.has(key)) continue;
        const notices = readdirSync(directory, { withFileTypes: true })
          .filter(item => item.isFile() && /^(licen[cs]e|copying|notice)([.-].*)?$/i.test(item.name))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(item => ({ name: item.name, text: readFileSync(resolve(directory, item.name), 'utf8') }));
        if (!notices.length || notices.some(notice => !notice.text.trim())) {
          throw new Error(`Missing license notice for bundled package ${key}; retain its upstream license before distributing this build.`);
        }
        const sourceArchive = data.name === 'ical.js'
          ? `https://registry.npmjs.org/ical.js/-/ical.js-${encodeURIComponent(data.version)}.tgz`
          : undefined;
        packages.set(key, {
          name: data.name || name, version: data.version,
          license: data.license || 'See package notices', notices, sourceArchive,
        });
      }
      const ordered = [...packages.values()].sort((a, b) =>
        a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
      const text = 'Qingdan bundled web dependencies\n\n'
        + ordered.map(p => `======== ${p.name} ${p.version} (${p.license}) ========\n`
          + (p.sourceArchive
            ? `Unmodified ical.js Source Code Form (including lib/ical/) is available at ${p.sourceArchive}\nUpstream: https://github.com/kewisch/ical.js\n\n`
            : '')
          + p.notices.map(notice => `${notice.name}\n${notice.text}`).join('\n') + '\n').join('\n');
      this.emitFile({ type: 'asset', fileName: `${noticeDirectory}/WEB-DEPENDENCY-LICENSES.txt`, source: text });
      this.emitFile({
        type: 'asset', fileName: `${noticeDirectory}/WEB-DEPENDENCY-VERSIONS.json`,
        source: JSON.stringify(ordered.map(({ name, version, license, notices, sourceArchive }) => ({
          name, version, license, noticeFiles: notices.map(notice => notice.name),
          ...(sourceArchive ? { sourceArchive } : {}),
        })), null, 2) + '\n',
      });
    },
  };
}
