import copy
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('qingdan_repair', Path(__file__).parents[1] / 'repair.py')
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


class VerifiedRecovery(unittest.TestCase):
    def setUp(self):
        source = 'a' * 40
        self.request = {'sourceCommit': source, 'runId': 42, 'attempt': 1}
        self.run = {'id': 42, 'head_sha': source, 'path': '.github/workflows/release.yml', 'status': 'completed'}
        names = ['发布版本与明确请求', '完整检查 / 源码与运行包检查',
                 '完整检查 / 内置后端原生系统检查 (windows)',
                 '完整检查 / 内置后端原生系统检查 (macos-arm64)', '完整检查 / 内置后端原生系统检查 (macos-x64)',
                 'Android 可安装发布 APK', 'Windows x64', 'macOS arm64', 'macOS x64',
                 'Linux x64 客户端 AppImage', '独立服务端 Linux 与 macOS 运行时',
                 'Ubuntu 24 安装与沙箱验收 / 已安装 Debian 包']
        self.jobs = [{'name': name, 'conclusion': 'success'} for name in names]
        self.jobs.append({'name': '汇总成品并发布（缺 APK 时仅草稿）', 'conclusion': 'failure'})
        self.artifacts = [{'name': name + '-' + source, 'expired': False, 'workflow_run': {'head_sha': source}}
                          for name in ('android', 'windows', 'macos-arm64', 'macos-x64', 'linux', 'linux-deb', 'server')]
        self.comparison = {'status': 'ahead', 'total_commits': 1, 'files': [{'filename': '.github/release/publish.py'}, {'filename': '.github/workflows/release-repair.yml'}]}

    def verify(self):
        return repair.verify_request(self.request, self.run, self.jobs, self.artifacts, self.comparison)

    def test_exact_original_artifacts_allow_publication_only_repair(self):
        self.assertEqual(self.verify(), ('a' * 40, 42))

    def test_both_mac_targets_and_native_gates_are_mandatory(self):
        for name in ('macOS x64', 'macOS arm64',
                     '完整检查 / 内置后端原生系统检查 (macos-x64)',
                     '完整检查 / 内置后端原生系统检查 (macos-arm64)'):
            with self.subTest(name=name):
                jobs = [job for job in self.jobs if job['name'] != name]
                with self.assertRaisesRegex(ValueError, 'All original'):
                    repair.verify_request(self.request, self.run, jobs, self.artifacts, self.comparison)

    def test_seven_artifact_set_cannot_substitute_generic_or_cross_arch_mac(self):
        self.assertEqual(len(self.artifacts), 7)
        for name in ('macos', 'macos-arm64'):
            artifacts = copy.deepcopy(self.artifacts)
            next(a for a in artifacts if a['name'].startswith('macos-x64-'))['name'] = name + '-' + self.request['sourceCommit']
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'Exact seven'):
                repair.verify_request(self.request, self.run, self.jobs, artifacts, self.comparison)

    def test_debian_installed_gate_is_mandatory_and_must_succeed(self):
        for conclusion in (None, 'failure', 'cancelled', 'skipped', 'timed_out'):
            jobs = copy.deepcopy(self.jobs)
            next(job for job in jobs if job['name'] == repair.LINUX_DEB_JOB)['conclusion'] = conclusion
            with self.subTest(conclusion=conclusion), self.assertRaisesRegex(ValueError, 'All original'):
                repair.verify_request(self.request, self.run, jobs, self.artifacts, self.comparison)
        self.jobs = [job for job in self.jobs if job['name'] != repair.LINUX_DEB_JOB]
        with self.assertRaisesRegex(ValueError, 'All original'):
            self.verify()

    def test_debian_artifact_cannot_be_missing_expired_or_replaced_by_appimage(self):
        for change in ('missing', 'expired', 'appimage'):
            artifacts = copy.deepcopy(self.artifacts)
            debian = next(item for item in artifacts if item['name'].startswith('linux-deb-'))
            if change == 'missing':
                artifacts.remove(debian)
            elif change == 'expired':
                debian['expired'] = True
            else:
                debian['name'] = 'linux-' + self.request['sourceCommit']
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'Exact seven'):
                repair.verify_request(self.request, self.run, self.jobs, artifacts, self.comparison)

    def test_six_target_legacy_inventory_cannot_weaken_current_release_gate(self):
        self.jobs = [job for job in self.jobs if job['name'] != repair.LINUX_DEB_JOB]
        self.artifacts = [item for item in self.artifacts if not item['name'].startswith('linux-deb-')]
        with self.assertRaisesRegex(ValueError, 'All original'):
            self.verify()

    def test_reusable_job_names_match_repair_gate(self):
        workflows = Path(__file__).parents[2] / 'workflows'
        caller = (workflows / 'release.yml').read_text()
        callee = (workflows / 'linux-ubuntu24.yml').read_text()
        self.assertIn('    name: Ubuntu 24 安装与沙箱验收\n', caller)
        self.assertIn('    name: 已安装 Debian 包\n', callee)
        self.assertEqual(repair.LINUX_DEB_JOB, 'Ubuntu 24 安装与沙箱验收 / 已安装 Debian 包')

    def test_invalid_source_or_request_rejected(self):
        for value in (None, 'main', 'b' * 39, 'x' * 40):
            self.request['sourceCommit'] = value
            with self.assertRaisesRegex(ValueError, 'Invalid original'):
                self.verify()

    def test_running_or_wrong_original_workflow_rejected(self):
        self.run['status'] = 'in_progress'
        with self.assertRaisesRegex(ValueError, 'completed release'):
            self.verify()
        self.run['status'] = 'completed'
        self.run['path'] = '.github/workflows/check.yml'
        with self.assertRaisesRegex(ValueError, 'completed release'):
            self.verify()

    def test_source_identity_mismatch_rejected(self):
        self.run['head_sha'] = 'b' * 40
        with self.assertRaisesRegex(ValueError, 'exact source'):
            self.verify()

    def test_failed_native_gate_or_missing_android_cannot_recover(self):
        self.jobs[2]['conclusion'] = 'failure'
        with self.assertRaisesRegex(ValueError, 'All original'):
            self.verify()
        self.jobs[2]['conclusion'] = 'success'
        self.jobs = [job for job in self.jobs if job['name'] != 'Android 可安装发布 APK']
        with self.assertRaisesRegex(ValueError, 'All original'):
            self.verify()

    def test_duplicate_or_unrelated_failed_job_rejected(self):
        self.jobs.append(copy.deepcopy(self.jobs[0]))
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            self.verify()
        self.jobs[-1] = {'name': 'unrelated failed gate', 'conclusion': 'failure'}
        with self.assertRaisesRegex(ValueError, 'Only the original'):
            self.verify()

    def test_missing_expired_duplicate_artifacts_rejected(self):
        self.artifacts[0]['expired'] = True
        with self.assertRaisesRegex(ValueError, 'Exact seven'):
            self.verify()
        self.artifacts[0]['expired'] = False
        self.artifacts.append(copy.deepcopy(self.artifacts[0]))
        with self.assertRaisesRegex(ValueError, 'Exact seven'):
            self.verify()

    def test_artifact_source_mismatch_rejected(self):
        self.artifacts[0]['workflow_run']['head_sha'] = 'b' * 40
        with self.assertRaisesRegex(ValueError, 'Artifact source'):
            self.verify()

    def test_application_or_build_workflow_changes_require_rebuild(self):
        for name in ('application/src/main.ts', 'desktop/scripts/package.cjs', 'android/package.json',
                     '.github/workflows/release.yml', '.github/workflows/linux-ubuntu24.yml'):
            self.comparison['files'] = [{'filename': name}]
            with self.assertRaisesRegex(ValueError, 'Application/build workflow changed'):
                self.verify()

    def test_diverged_or_unbounded_comparison_rejected(self):
        self.comparison['status'] = 'diverged'
        with self.assertRaisesRegex(ValueError, 'descend'):
            self.verify()
        self.comparison['status'] = 'ahead'
        self.comparison['files'] *= 151
        with self.assertRaisesRegex(ValueError, 'rebuild'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
