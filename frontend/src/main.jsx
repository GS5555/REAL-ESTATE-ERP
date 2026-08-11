import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { StoreProvider } from './store';
import { ToastProvider } from './components/ui';
import { registerSw, showOfflineToast, isOnline } from './offline';
import './styles.css';

registerSw();
if (!isOnline()) showOfflineToast();
window.addEventListener('offline', () => showOfflineToast());
window.addEventListener('online', () => showOfflineToast());

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </StoreProvider>
    </BrowserRouter>
  </React.StrictMode>
);
