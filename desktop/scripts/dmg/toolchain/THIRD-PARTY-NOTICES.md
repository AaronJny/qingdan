# DMG build tool source notice

`unicode-utf8.patch` modifies the `hfs/catalog.c` and `hfs/utility.c` files of [Mozilla libdmg-hfsplus at ec239599c1f234a4e01ae3fe51214d0c77e5baa3](https://github.com/mozilla/libdmg-hfsplus/tree/ec239599c1f234a4e01ae3fe51214d0c77e5baa3). The pinned upstream project is distributed under GNU GPL version 3; its unchanged license is retained in [LICENSE-libdmg-hfsplus.txt](LICENSE-libdmg-hfsplus.txt).

The Qingdan patch, first recorded on 2026-10-09, replaces lossy filename conversion with strict UTF-8/UTF-16 conversion. It is provided under the same GPLv3 terms as the upstream code it changes. This statement applies to this tool patch and the corresponding modified tool source, and does not assign a license to Qingdan's independent application code.

`provenance.json` records the exact upstream archive URL, source and patch hashes. `rebuild.sh` obtains that source, retains its LICENSE, and applies the patch. Keep the patch, this notice, the license, provenance and rebuild instructions together when sharing the modified tool source. The DMG tool is a build-time utility and is not included in the Qingdan application runtime; distributing its executable separately requires retaining its corresponding source and applicable upstream notices.
