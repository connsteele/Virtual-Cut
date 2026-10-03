import React from 'react';
import ReactDOM from 'react-dom/client';
import './global.css';
const App = React.lazy(() => import('./App').then((module) => ({ default: module.App })));
const TranscriptWindow = React.lazy(() =>
  import('./workflow/TranscriptWindow').then((module) => ({ default: module.TranscriptWindow })),
);

const transcript = window.location.hash === '#transcript';
if (transcript) {
  document.body.classList.add('transcript-window');
  document.title = 'Transcription · Virtual Cut';
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense fallback={null}>{transcript ? <TranscriptWindow /> : <App />}</React.Suspense>
  </React.StrictMode>,
);
