'use strict';
module.exports = {
 appId:'app.qingdan.desktop', productName:'Qingdan', directories:{output:'dist',buildResources:'build'}, asar:true,npmRebuild:false,publish:null,
 // electron-builder's downloader takes an explicit cache option; its Electron
 // install helper's ELECTRON_CACHE environment variable alone is insufficient.
 electronDownload:process.env.ELECTRON_CACHE ? {cache:process.env.ELECTRON_CACHE} : undefined,
 // Only a staged, target-specific Node-API binding is allowed into the ASAR.
 files:['src/**/*','backend/**/*','build/icon.png','package.json','!**/*.map','!node_modules/classic-level/prebuilds{,/**/*}','!node_modules/classic-level/build{,/**/*}'],
 asarUnpack:['**/*.node'],beforePack:'scripts/prepare-native-recovery.cjs',afterExtract:'scripts/copy-mac-notices.cjs',afterPack:'scripts/finalize-bundle.cjs',
 electronFuses:{runAsNode:false,enableCookieEncryption:true,enableNodeOptionsEnvironmentVariable:false,enableNodeCliInspectArguments:false,enableEmbeddedAsarIntegrityValidation:true,onlyLoadAppFromAsar:true,grantFileProtocolExtraPrivileges:false,resetAdHocDarwinSignature:true},
 artifactName:'Qingdan-${version}-${os}-${arch}.${ext}',
 mac:{executableName:'青单',artifactName:'青单-${version}-${os}-${arch}.${ext}',category:'public.app-category.productivity',icon:'build/icon.icns',target:[{target:'dir',arch:['arm64','x64']}],minimumSystemVersion:'13.0',hardenedRuntime:false,identity:null,notarize:false,extendInfo:{CFBundleDisplayName:'青单',CFBundleName:'青单',CFBundleDevelopmentRegion:'en',CFBundleLocalizations:['en','zh_CN','zh'],NSHighResolutionCapable:true}},
 win:{icon:'build/icon.ico',target:[{target:'zip',arch:['x64']}],requestedExecutionLevel:'asInvoker',signAndEditExecutable:false},
 linux:{icon:'build/icon.png',category:'Office',target:[{target:'AppImage',arch:['x64']}],executableName:'qingdan',desktop:{entry:{Name:'Qingdan','Name[zh_CN]':'青单','Name[zh]':'青单'}}},
 // The legacy target defaults to --no-sandbox. Keep desktop launch sandboxed,
 // and use a checksum-pinned static runtime from the locked builder toolset.
 toolsets:{appimage:'1.0.3'},appImage:{executableArgs:[],artifactName:'Qingdan-${version}-linux-x64.${ext}'},
};
