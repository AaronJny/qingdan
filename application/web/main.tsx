import'../app/globals.css';
import'./local-recovery.css';
import React from'react';import{createRoot}from'react-dom/client';import{App}from'./app';
import{suspendNativeOfflineSession}from'../lib/offline-session';
import{warnVolatile}from'../lib/client-storage';
// The preload bridge is already hydrated; no browser-storage copy or async draft race.
if(!suspendNativeOfflineSession())warnVolatile();
createRoot(document.getElementById('root')!).render(<App/>);
