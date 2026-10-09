'use strict';
module.exports = {
 appId:'app.qingdan.desktop', productName:'Qingdan', directories:{output:'dist',buildResources:'build'}, asar:true,npmRebuild:false,publish:null,
 files:['src/**/*','backend/**/*','build/icon.png','package.json','!**/*.map'],afterExtract:'scripts/copy-mac-notices.cjs',afterPack:'scripts/finalize-mac-bundle.cjs',
 electronFuses:{runAsNode:false,enableCookieEncryption:true,enableNodeOptionsEnvironmentVariable:false,enableNodeCliInspectArguments:false,enableEmbeddedAsarIntegrityValidation:true,onlyLoadAppFromAsar:true,grantFileProtocolExtraPrivileges:false},
 artifactName:'Qingdan-${version}-${os}-${arch}.${ext}',
 mac:{executableName:'青单',artifactName:'青单-${version}-${os}-${arch}.${ext}',category:'public.app-category.productivity',icon:'build/icon.icns',target:[{target:'dir',arch:['arm64']}],minimumSystemVersion:'13.0',hardenedRuntime:false,identity:null,notarize:false,extendInfo:{CFBundleDisplayName:'青单',CFBundleName:'青单',NSHighResolutionCapable:true}},
 win:{icon:'build/icon.ico',target:[{target:'zip',arch:['x64']}],requestedExecutionLevel:'asInvoker',signAndEditExecutable:false},
 linux:{icon:'build/icon.png',category:'Office',target:['dir'],executableName:'qingdan'},
};
