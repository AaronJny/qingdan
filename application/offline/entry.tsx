import React from'react';import{createRoot}from'react-dom/client';import OfflineRoot from'./root';import'../app/globals.css';
createRoot(document.getElementById('offline-root')!).render(<OfflineRoot/>);
